import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  SubscriptionAccountInput,
  SubscriptionCancelLoginInput,
  SubscriptionEnabledInput,
  SubscriptionLogin,
  SubscriptionOptionsInput,
  SubscriptionPackageInput,
  SubscriptionPreferencesInput,
  SubscriptionProvider,
  SubscriptionRefreshInput,
  SubscriptionStartLoginInput,
  SubscriptionState,
  SubscriptionSubmitLoginInput,
  SubscriptionUsage,
} from "@openbot/contracts/ipc-subscriptions";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import {
  isSubscriptionPackageName,
  SUBSCRIPTION_PLUGIN_CATALOG,
  type SubscriptionPluginListing,
} from "@openbot/contracts/subscription-catalog";
import { sourceText } from "@openbot/i18n/source";
import { Schema } from "effect";
import { causeHelpers, runCauseEffect } from "../backend/effect-boundary";
import { type SubscriptionAuthEvent, type SubscriptionFetchInput, SubscriptionHost } from "./subscription-host";
import { type PluginJsonObject, pluginRecord as record } from "./subscription-json";
import { SubscriptionPluginMarket } from "./subscription-market";
import type { SubscriptionModelTransport, SubscriptionNativeProvider } from "./subscription-model-bridge";

class SubscriptionFailure extends Schema.TaggedError<SubscriptionFailure>()("SubscriptionFailure", {
  cause: Schema.Defect(),
}) {}
const { io } = causeHelpers(SubscriptionFailure);
const text = (value: unknown): string => (typeof value === "string" ? value.slice(0, 2000) : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown): string[] => list(value).filter((item): item is string => typeof item === "string");
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
interface SavedConfig {
  plugins: Record<string, { version: string; enabled: boolean }>;
  options: Record<string, Record<string, string | number | boolean>>;
  domesticMirror: boolean;
}
interface LoginDraft {
  public: SubscriptionLogin;
  inputs: Record<string, string>;
  account?: string;
  apiKey?: string;
  session?: string;
  promptKey?: string;
  cancelled: boolean;
  awaitingApiKey?: boolean;
}
export interface SubscriptionRuntimeOptions {
  stateDirectory: string;
  resourcesDirectory: string;
  bunExecutable: () => string | null;
  onChanged?: () => void;
  /** Tests isolate plugin homes without changing the application's environment. */
  environment?: NodeJS.ProcessEnv;
}

/** Owns isolated provider plugins, credentials and authorization. Only safe status reaches IPC. */
export class SubscriptionPluginRuntime implements SubscriptionModelTransport {
  readonly #options: SubscriptionRuntimeOptions;
  #config: SavedConfig = { plugins: {}, options: {}, domesticMirror: false };
  #state: SubscriptionState = {
    runtimeAvailable: false,
    plugins: [],
    providers: [],
    logins: [],
    domesticMirror: false,
  };
  #native: SubscriptionNativeProvider[] = [];
  #host: SubscriptionHost | null = null;
  #ready: Promise<void> | null = null;
  #starting: Promise<SubscriptionHost> | null = null;
  #mutating: Promise<void> = Promise.resolve();
  #stopped = false;
  #failedExecutable: string | null = null;
  #refreshing = false;
  #authRefreshQueued = false;
  readonly #expiredAccounts = new Set<string>();
  readonly #retiringHosts = new Set<Promise<void>>();
  readonly #catalog = new Map(SUBSCRIPTION_PLUGIN_CATALOG.map((entry) => [entry.packageName, entry]));
  readonly #market: SubscriptionPluginMarket;
  readonly #logins = new Map<string, LoginDraft>();
  readonly #usage = new Map<string, SubscriptionUsage>();
  readonly #latest = new Map<string, string>();
  readonly #pluginErrors = new Set<string>();
  readonly #keylessMethods = new Set<string>();
  constructor(options: SubscriptionRuntimeOptions) {
    this.#options = options;
    this.#market = new SubscriptionPluginMarket({ domesticMirror: () => this.#config.domesticMirror });
  }

  #initialize(): Promise<void> {
    if (this.#ready) return this.#ready;
    this.#ready = runCauseEffect(
      io(async () => {
        await mkdir(this.#options.stateDirectory, { recursive: true, mode: 0o700 });
        try {
          const value = record(JSON.parse(await readFile(join(this.#options.stateDirectory, "plugins.json"), "utf8")));
          for (const [packageName, savedValue] of Object.entries(record(value.plugins))) {
            if (!isSubscriptionPackageName(packageName)) continue;
            const saved = record(savedValue);
            if (!this.#catalog.has(packageName)) {
              const listing = list(value.listings)
                .map(record)
                .find((item) => item.packageName === packageName);
              this.#catalog.set(
                packageName,
                this.#externalListing(packageName, text(listing?.name), text(record(listing?.description).en)),
              );
            }
            if (text(saved.version))
              this.#config.plugins[packageName] = {
                version: text(saved.version),
                enabled: saved.enabled === true,
              };
          }
          this.#config.domesticMirror = value.domesticMirror === true;
          for (const [provider, options] of Object.entries(record(value.options))) {
            this.#config.options[provider] = {};
            for (const [key, option] of Object.entries(record(options)))
              if (typeof option === "boolean" || typeof option === "string" || typeof option === "number")
                this.#config.options[provider][key] = option;
          }
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            throw new Error(sourceText("error.app.subscription.configUnreadable"));
        }
      }),
    );
    return this.#ready;
  }
  async #save(): Promise<void> {
    await runCauseEffect(
      io(async () => {
        const path = join(this.#options.stateDirectory, "plugins.json");
        const temporary = `${path}.${randomUUID()}.tmp`;
        const listings = [...this.#catalog.values()].filter((entry) => this.#config.plugins[entry.packageName]);
        await writeFile(temporary, JSON.stringify({ ...this.#config, listings }), { mode: 0o600 });
        await rename(temporary, path);
      }),
    );
  }
  #publish(error?: string): SubscriptionState {
    this.#pruneLogins();
    const executable = this.#options.bunExecutable();
    this.#state = {
      ...this.#state,
      runtimeAvailable:
        !this.#stopped &&
        Boolean(
          executable &&
            executable !== this.#failedExecutable &&
            existsSync(executable) &&
            existsSync(join(this.#options.resourcesDirectory, "host.js")) &&
            (!this.#host || this.#host.running),
        ),
      ...(error ? { runtimeError: error } : { runtimeError: undefined }),
      domesticMirror: this.#config.domesticMirror,
      catalog: [...this.#catalog.values()],
      plugins: [...this.#catalog.values()].map((item) => ({
        packageName: item.packageName,
        installedVersion: this.#config.plugins[item.packageName]?.version ?? null,
        enabled: this.#config.plugins[item.packageName]?.enabled ?? false,
        latestVersion: this.#latest.get(item.packageName) ?? null,
        ...(this.#pluginErrors.has(item.packageName) ? { error: sourceText("error.app.subscription.loadFailed") } : {}),
      })),
      logins: [...this.#logins.values()].map((item) => item.public),
    };
    return this.#state;
  }
  #releaseLogin(draft: LoginDraft): void {
    draft.inputs = {};
    draft.apiKey = undefined;
    draft.account = undefined;
    draft.session = undefined;
    draft.promptKey = undefined;
    draft.awaitingApiKey = false;
    draft.public = {
      id: draft.public.id,
      providerId: draft.public.providerId,
      methodIndex: draft.public.methodIndex,
      status: draft.public.status,
      ...(draft.public.error ? { error: draft.public.error } : {}),
    };
  }
  #pruneLogins(): void {
    const terminal = [...this.#logins.values()].filter(
      (draft) => draft.public.status !== "input" && draft.public.status !== "waiting",
    );
    for (const draft of terminal) this.#releaseLogin(draft);
    for (const draft of terminal.slice(0, Math.max(0, terminal.length - 16))) this.#logins.delete(draft.public.id);
  }
  async #runLogin(draft: LoginDraft, operation: () => Promise<SubscriptionState>): Promise<SubscriptionState> {
    try {
      return await operation();
    } catch (error) {
      const session = draft.session;
      if (!draft.cancelled)
        draft.public = {
          ...draft.public,
          status: "error",
          error: sourceText("error.app.subscription.authorizationFailed"),
        };
      this.#releaseLogin(draft);
      this.#publish();
      if (session && this.#host) await this.#host.call("cancelAuth", { session }).catch(() => undefined);
      throw error;
    }
  }
  #package(packageName: string) {
    const entry = this.#catalog.get(packageName);
    if (!entry) throw new Error(sourceText("error.app.subscription.unknownPlugin"));
    return entry;
  }
  #externalListing(packageName: string, name = packageName, description = ""): SubscriptionPluginListing {
    return {
      id: `npm-${createHash("sha256").update(packageName).digest("hex").slice(0, 20)}`,
      packageName,
      name: name || packageName,
      description: { en: description, zh: description },
      icon: "generic",
      providerIds: [],
      community: false,
    };
  }
  #directory(packageName: string): string {
    return join(this.#options.stateDirectory, "packages", this.#package(packageName).id);
  }
  async #getHost(): Promise<SubscriptionHost> {
    await this.#initialize();
    if (this.#stopped) throw new Error(sourceText("error.app.subscription.stopped"));
    if (this.#host?.running) return this.#host;
    this.#host = null;
    if (this.#starting) return this.#starting;
    this.#starting = (async () => {
      const executable = this.#options.bunExecutable();
      if (!executable) throw new Error(sourceText("error.app.subscription.bunMissing"));
      const host = new SubscriptionHost(
        executable,
        join(this.#options.resourcesDirectory, "host.js"),
        this.#options.stateDirectory,
        (event) => this.#authChanged(event),
        this.#options.environment,
      );
      try {
        const plugins = Object.entries(this.#config.plugins)
          .filter(([, entry]) => entry.enabled)
          .map(([spec]) => ({ spec, target: join(this.#directory(spec), "node_modules", ...spec.split("/")) }));
        const result = record(
          await host.call("init", {
            authPath: join(this.#options.stateDirectory, "plugin-auth.json"),
            directory: this.#options.stateDirectory,
            plugins,
            options: this.#config.options,
          }),
        );
        this.#pluginErrors.clear();
        for (const item of list(result.plugins).map(record)) if (item.error) this.#pluginErrors.add(text(item.spec));
        const failed = this.#pluginErrors.size > 0;
        if (failed) this.#state = { ...this.#state, runtimeError: sourceText("error.app.subscription.someLoadFailed") };
        this.#host = host;
        this.#failedExecutable = null;
        return host;
      } catch {
        this.#failedExecutable = executable;
        await host.stop();
        throw new Error(sourceText("error.app.subscription.startFailed"));
      }
    })();
    try {
      return await this.#starting;
    } finally {
      this.#starting = null;
    }
  }
  async getState(): Promise<SubscriptionState> {
    await this.#initialize();
    return this.#publish(this.#state.runtimeError);
  }
  async refresh(input: SubscriptionRefreshInput = {}): Promise<SubscriptionState> {
    this.#refreshing = true;
    let marketError: string | undefined;
    try {
      await this.#initialize();
      if (input.discover) {
        try {
          const snapshot = await runCauseEffect(this.#market.catalog());
          if (snapshot.error) marketError = sourceText("error.app.subscription.marketUnavailable");
          for (const entry of snapshot.entries) {
            const stable = this.#catalog.get(entry.packageName);
            this.#catalog.set(
              entry.packageName,
              stable ? { ...entry, id: stable.id } : { ...entry, id: this.#externalListing(entry.packageName).id },
            );
          }
          if (input.query?.trim())
            for (const entry of await runCauseEffect(this.#market.search(input.query))) {
              const stable = this.#catalog.get(entry.packageName);
              this.#catalog.set(
                entry.packageName,
                stable ? { ...entry, id: stable.id } : { ...entry, id: this.#externalListing(entry.packageName).id },
              );
            }
        } catch {
          marketError = sourceText("error.app.subscription.marketUnavailable");
        }
      }
      if (input.checkUpdates) await this.#checkVersions();
      const host = await this.#getHost();
      const providers = list(await host.call("providers"));
      this.#state = { ...this.#state, providers: providers.map((item) => this.#provider(record(item))) };
      const next = providers.map((item) => this.#nativeProvider(record(item)));
      const changed = JSON.stringify(next) !== JSON.stringify(this.#native);
      this.#native = next;
      if (changed) this.#options.onChanged?.();
      return this.#publish(marketError);
    } catch {
      const hadModels = this.#native.length > 0;
      this.#native = [];
      this.#state = { ...this.#state, providers: [] };
      if (hadModels) this.#options.onChanged?.();
      return this.#publish(sourceText("error.app.subscription.statusFailed"));
    } finally {
      this.#refreshing = false;
    }
  }
  #authChanged(event: SubscriptionAuthEvent): void {
    if (event.account) {
      if (event.said === "expired") this.#expiredAccounts.add(event.account);
      else this.#expiredAccounts.delete(event.account);
      this.#usage.delete(`${event.provider}:${event.account}`);
    }
    // A listing already in progress observes its own auth updates. Never recursively list from it.
    if (this.#refreshing || this.#starting || this.#authRefreshQueued || this.#stopped) return;
    this.#authRefreshQueued = true;
    queueMicrotask(() => {
      this.#authRefreshQueued = false;
      if (!this.#stopped) void this.refresh().catch(() => undefined);
    });
  }
  #provider(value: PluginJsonObject): SubscriptionProvider {
    const id = text(value.id);
    const packageName = text(value.spec);
    const signedIn =
      value.signedIn === true &&
      list(value.accounts).some((account) => !this.#expiredAccounts.has(text(record(account).key)));
    return {
      id,
      packageName,
      name: text(value.name) || id,
      signedIn,
      enabled: this.#config.plugins[packageName]?.enabled === true,
      methods: list(value.methods).map((item, index) => {
        const method = record(item);
        const methodId = `${id}:${index}`;
        if (method.keyless === true) this.#keylessMethods.add(methodId);
        else this.#keylessMethods.delete(methodId);
        return { index, type: method.type === "api" ? "api" : "oauth", label: text(method.label) };
      }),
      accounts: list(value.accounts).map((item) => {
        const account = record(item);
        const key = text(account.key);
        return {
          id: key,
          label: text(account.accountId) || text(account.hint) || id,
          models:
            value.signedIn === true && !this.#expiredAccounts.has(key)
              ? Array.isArray(account.models)
                ? strings(account.models)
                : list(value.models).map((model) => text(record(model).id))
              : [],
          usage: this.#usage.get(`${id}:${key}`),
          ...(this.#expiredAccounts.has(key)
            ? { error: sourceText("error.app.subscription.accountDisconnected") }
            : account.fellBack
              ? { error: sourceText("error.app.subscription.modelsRefreshFailed") }
              : {}),
        };
      }),
      models: signedIn
        ? list(value.models).map((item) => {
            const model = record(item);
            return {
              id: text(model.id),
              name: text(model.name) || text(model.id),
              contextWindow: number(model.context),
              maxOutputTokens: number(model.output),
              reasoning: model.reasoning === true,
              image: model.image === true,
              creditRate: number(model.rate),
            };
          })
        : [],
      options: list(value.options).map((item) => {
        const option = record(item);
        const key = text(option.key);
        return {
          key,
          label: text(option.label),
          description: text(option.description),
          type: "boolean",
          value: this.#config.options[id]?.[key] ?? option.default === true,
        };
      }),
      supportsUsage: value.usage === true,
      supportsCheckIn: value.checkin === true,
      singleAccount: value.single === true,
      ...(value.fellBack ? { error: sourceText("error.app.subscription.cachedModels") } : {}),
    };
  }
  #nativeProvider(value: PluginJsonObject): SubscriptionNativeProvider {
    const safe = this.#provider(value);
    return {
      id: safe.id,
      name: safe.name,
      enabled: safe.enabled,
      signedIn: safe.signedIn,
      baseURL: text(value.api),
      accounts: safe.accounts.map((account) => ({ id: account.id, label: account.label, models: account.models })),
      models: safe.signedIn
        ? list(value.models).map((item) => {
            const model = record(item);
            return {
              id: text(model.id),
              name: text(model.name),
              npm: text(model.npm),
              url: text(model.url),
              apiId: text(model.apiId),
            };
          })
        : [],
    };
  }
  providerDescriptors(): readonly SubscriptionNativeProvider[] {
    return this.#native;
  }
  async loadProvider(
    provider: string,
    account?: string,
  ): Promise<{ baseURL: string; apiKey?: string; headers?: Record<string, string> }> {
    this.#assertAccount({ providerId: provider, accountId: account });
    const loaded = record(await (await this.#getHost()).call("load", { provider, account }));
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(record(loaded.headers)))
      if (typeof value === "string") headers[key] = value;
    return {
      baseURL: text(loaded.baseURL),
      apiKey: typeof loaded.apiKey === "string" ? loaded.apiKey : undefined,
      headers,
    };
  }
  async fetchRequest(input: SubscriptionFetchInput): Promise<Response> {
    this.#assertAccount({ providerId: input.provider, accountId: input.account });
    return (await this.#getHost()).fetch(input);
  }
  #assertAccount(input: SubscriptionAccountInput): SubscriptionProvider {
    const provider = this.#state.providers.find((item) => item.id === input.providerId && item.enabled);
    if (!provider?.signedIn || (input.accountId && !provider.accounts.some((item) => item.id === input.accountId)))
      throw new Error(sourceText("error.app.subscription.accountDisconnected"));
    return provider;
  }
  async #checkVersions(): Promise<void> {
    await runCauseEffect(
      io(async () => {
        for (const packageName of Object.keys(this.#config.plugins)) {
          const entry = this.#package(packageName);
          try {
            const registry = this.#config.domesticMirror
              ? "https://registry.npmmirror.com"
              : "https://registry.npmjs.org";
            const response = await fetch(`${registry}/${encodeURIComponent(entry.packageName)}/latest`, {
              signal: AbortSignal.timeout(15_000),
            });
            if (response.ok) {
              const data = record(await response.json());
              const version = text(data.version);
              if (/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(version)) this.#latest.set(entry.packageName, version);
            }
          } catch {
            /* Preserve the last known version; offline does not mean up to date. */
          }
        }
      }),
    );
  }
  async #exclusive(operation: () => Promise<SubscriptionState>): Promise<SubscriptionState> {
    const previous = this.#mutating;
    let release: () => void = () => {};
    this.#mutating = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
  async install(input: SubscriptionPackageInput): Promise<SubscriptionState> {
    return this.#exclusive(async () => {
      await this.#initialize();
      if (!isSubscriptionPackageName(input.packageName))
        throw new Error(sourceText("error.app.subscription.unknownPlugin"));
      if (!this.#catalog.has(input.packageName)) {
        const metadata = await runCauseEffect(this.#market.packageMetadata(input.packageName));
        this.#catalog.set(
          input.packageName,
          this.#externalListing(metadata.packageName, metadata.packageName, metadata.description),
        );
      }
      const entry = this.#package(input.packageName);
      const executable = this.#options.bunExecutable();
      if (!executable) throw new Error(sourceText("error.app.subscription.installBunMissing"));
      const directory = this.#directory(entry.packageName);
      await runCauseEffect(
        io(async () => {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          await writeFile(
            join(directory, "package.json"),
            JSON.stringify({ private: true, dependencies: { [entry.packageName]: "latest" } }),
            { mode: 0o600 },
          );
          await new Promise<void>((resolve, reject) => {
            const registry = this.#config.domesticMirror
              ? "https://registry.npmmirror.com"
              : "https://registry.npmjs.org";
            const args = this.#config.plugins[entry.packageName]
              ? ["update", entry.packageName, "--latest", "--ignore-scripts", "--registry", registry]
              : ["install", "--ignore-scripts", "--registry", registry];
            const child = spawn(executable, args, {
              cwd: directory,
              windowsHide: true,
              stdio: "ignore",
              env: { ...process.env, ...this.#options.environment },
            });
            const timer = setTimeout(() => {
              child.kill();
              reject(new Error(sourceText("error.app.subscription.installTimedOut")));
            }, 5 * 60_000);
            child.once("error", () => {
              clearTimeout(timer);
              reject(new Error(sourceText("error.app.subscription.installFailed")));
            });
            child.once("exit", (code) => {
              clearTimeout(timer);
              if (code === 0) resolve();
              else reject(new Error(sourceText("error.app.subscription.installNetworkFailed")));
            });
          });
          const manifest = record(
            JSON.parse(
              await readFile(join(directory, "node_modules", ...entry.packageName.split("/"), "package.json"), "utf8"),
            ),
          );
          if (manifest.name !== entry.packageName || !text(manifest.version))
            throw new Error(sourceText("error.app.subscription.packageMismatch"));
          this.#config.plugins[entry.packageName] = { version: text(manifest.version), enabled: true };
        }),
      );
      await this.#save();
      this.#restart();
      return this.refresh();
    });
  }
  update(input: SubscriptionPackageInput): Promise<SubscriptionState> {
    return this.install(input);
  }
  async remove(input: SubscriptionPackageInput): Promise<SubscriptionState> {
    return this.#exclusive(async () => {
      await this.#initialize();
      this.#package(input.packageName);
      if (this.#host)
        for (const provider of this.#state.providers.filter((item) => item.packageName === input.packageName))
          await this.#host.call("signOut", { provider: provider.id });
      this.#restart();
      delete this.#config.plugins[input.packageName];
      await this.#save();
      await runCauseEffect(io(() => rm(this.#directory(input.packageName), { recursive: true, force: true })));
      return this.refresh();
    });
  }
  async setEnabled(input: SubscriptionEnabledInput): Promise<SubscriptionState> {
    await this.#initialize();
    this.#package(input.packageName);
    const entry = this.#config.plugins[input.packageName];
    if (!entry) throw new Error(sourceText("error.app.subscription.installFirst"));
    entry.enabled = input.enabled;
    await this.#save();
    this.#restart();
    return this.refresh();
  }
  async setPreferences(input: SubscriptionPreferencesInput): Promise<SubscriptionState> {
    await this.#initialize();
    this.#config.domesticMirror = input.domesticMirror;
    await this.#save();
    return this.#publish();
  }
  async startLogin(input: SubscriptionStartLoginInput): Promise<SubscriptionState> {
    await this.refresh();
    this.#pruneLogins();
    if (
      [...this.#logins.values()].filter((draft) => draft.public.status === "input" || draft.public.status === "waiting")
        .length >= 8
    )
      throw new Error(sourceText("error.app.subscription.tooManyRequests"));
    const provider = this.#state.providers.find((item) => item.id === input.providerId && item.enabled);
    if (!provider?.methods.some((method) => method.index === input.methodIndex))
      throw new Error(sourceText("error.app.subscription.methodUnavailable"));
    const id = randomUUID();
    const draft: LoginDraft = {
      public: { id, providerId: input.providerId, methodIndex: input.methodIndex, status: "input" },
      inputs: { ...input.inputs },
      apiKey: input.apiKey,
      account: input.accountId,
      cancelled: false,
    };
    this.#logins.set(id, draft);
    return this.#runLogin(draft, () => this.#advance(draft));
  }
  async #advance(draft: LoginDraft): Promise<SubscriptionState> {
    const host = await this.#getHost();
    const params = {
      provider: draft.public.providerId,
      method: draft.public.methodIndex,
      inputs: draft.inputs,
      account: draft.account,
    };
    const response = record(await host.call("prompt", params));
    if (isDynamicRecord(response.prompt)) {
      const prompt = response.prompt;
      draft.promptKey = text(prompt.key);
      draft.public = {
        ...draft.public,
        status: "input",
        prompt: {
          key: text(prompt.key),
          type: prompt.type === "select" ? "select" : "text",
          message: text(prompt.message),
          placeholder: text(prompt.placeholder),
          secret: /password|token|secret|key/iu.test(text(prompt.key)),
          options: list(prompt.options).map((item) => {
            const option = record(item);
            return { label: text(option.label), value: text(option.value), hint: text(option.hint) };
          }),
        },
      };
      return this.#publish();
    }
    const method = this.#state.providers
      .find((item) => item.id === params.provider)
      ?.methods.find((item) => item.index === params.method);
    if (method?.type === "api") {
      if (!draft.apiKey?.trim() && !this.#keylessMethods.has(`${params.provider}:${params.method}`)) {
        draft.awaitingApiKey = true;
        draft.public = {
          ...draft.public,
          status: "input",
          prompt: {
            key: "apiKey",
            type: "text",
            secret: true,
            message: sourceText("error.app.subscription.apiKeyPrompt"),
          },
        };
        return this.#publish();
      }
      const result = record(
        await host.call("apiKey", { ...params, key: draft.apiKey ?? draft.inputs.apiKey ?? draft.inputs.key ?? "" }),
      );
      draft.public = {
        ...draft.public,
        prompt: undefined,
        status: result.ok === true ? "connected" : "error",
        ...(result.ok === true ? {} : { error: sourceText("error.app.subscription.connectionFailed") }),
      };
      draft.inputs = {};
      draft.apiKey = undefined;
      return this.refresh();
    }
    const result = record(await host.call("authorize", params));
    draft.session = text(result.session);
    if (draft.cancelled) {
      await host.call("cancelAuth", { session: draft.session });
      return this.#publish();
    }
    draft.public = {
      ...draft.public,
      prompt: undefined,
      status: "waiting",
      url: text(result.url) || undefined,
      instructions: text(result.instructions),
      manualCode: result.method === "code",
    };
    this.#publish();
    if (result.method !== "code") void this.#runLogin(draft, () => this.#complete(draft)).catch(() => undefined);
    return this.#state;
  }
  async #complete(draft: LoginDraft, code?: string): Promise<SubscriptionState> {
    const result = record(
      await (await this.#getHost()).call("callback", { session: draft.session, code }, 10 * 60_000),
    );
    if (draft.cancelled) return this.#publish();
    draft.public = {
      ...draft.public,
      url: undefined,
      instructions: undefined,
      status: result.ok === true ? "connected" : "error",
      ...(result.ok === true ? {} : { error: sourceText("error.app.subscription.authorizationFailed") }),
    };
    draft.inputs = {};
    draft.apiKey = undefined;
    return this.refresh();
  }
  async submitLogin(input: SubscriptionSubmitLoginInput): Promise<SubscriptionState> {
    const draft = this.#logins.get(input.loginId);
    if (!draft || draft.cancelled || (draft.public.status !== "input" && draft.public.status !== "waiting"))
      throw new Error(sourceText("error.app.subscription.loginEnded"));
    return this.#runLogin(draft, async () => {
      if (draft.awaitingApiKey) {
        if (!input.value.trim()) throw new Error(sourceText("error.app.subscription.invalidInput"));
        draft.apiKey = input.value.trim();
        draft.awaitingApiKey = false;
        return this.#advance(draft);
      }
      if (draft.public.status === "waiting" && draft.public.manualCode) return this.#complete(draft, input.value);
      if (!draft.promptKey) throw new Error(sourceText("error.app.subscription.noPrompt"));
      const result = record(
        await (await this.#getHost()).call("validate", {
          provider: draft.public.providerId,
          method: draft.public.methodIndex,
          key: draft.promptKey,
          value: input.value,
        }),
      );
      if (result.error) {
        draft.public = { ...draft.public, error: sourceText("error.app.subscription.invalidInput") };
        return this.#publish();
      }
      draft.inputs[draft.promptKey] = input.value;
      draft.promptKey = undefined;
      return this.#advance(draft);
    });
  }
  async cancelLogin(input: SubscriptionCancelLoginInput): Promise<SubscriptionState> {
    const draft = this.#logins.get(input.loginId);
    if (!draft) return this.#publish();
    draft.cancelled = true;
    const session = draft.session;
    draft.inputs = {};
    draft.apiKey = undefined;
    draft.public = {
      id: draft.public.id,
      providerId: draft.public.providerId,
      methodIndex: draft.public.methodIndex,
      status: "cancelled",
    };
    this.#releaseLogin(draft);
    this.#publish();
    if (session && this.#host) await this.#host.call("cancelAuth", { session });
    return this.#publish();
  }
  async signOut(input: SubscriptionAccountInput): Promise<SubscriptionState> {
    const provider = this.#state.providers.find((item) => item.id === input.providerId && item.enabled);
    if (!provider) throw new Error(sourceText("error.app.subscription.providerUnavailable"));
    await (await this.#getHost()).call("signOut", { provider: input.providerId, account: input.accountId });
    if (input.accountId) this.#usage.delete(`${input.providerId}:${input.accountId}`);
    else for (const key of this.#usage.keys()) if (key.startsWith(`${input.providerId}:`)) this.#usage.delete(key);
    return this.refresh();
  }
  async getUsage(input: SubscriptionAccountInput): Promise<SubscriptionState> {
    this.#assertAccount(input);
    const value = record(
      await (await this.#getHost()).call("usage", { provider: input.providerId, account: input.accountId }),
    );
    const usage: SubscriptionUsage = {
      plan: text(value.plan),
      user: text(value.user),
      balance: text(value.balance),
      windows: list(value.windows).map((item) => {
        const window = record(item);
        const used = number(window.amount);
        const limit = number(window.limit);
        return {
          label: text(window.name) || text(window.display),
          used: limit ? used : number(window.used),
          limit: limit || 100,
          remaining: limit && used !== undefined ? Math.max(0, limit - used) : undefined,
          unit: text(window.unit) || "%",
          resetsAt: text(window.resetsAt),
        };
      }),
      ...(value.error ? { error: sourceText("error.app.subscription.usageFailed") } : {}),
    };
    const provider = this.#state.providers.find((item) => item.id === input.providerId);
    const account = input.accountId ?? provider?.accounts[0]?.id ?? input.providerId;
    this.#usage.set(`${input.providerId}:${account}`, usage);
    return this.refresh();
  }
  async checkIn(input: SubscriptionAccountInput): Promise<SubscriptionState> {
    this.#assertAccount(input);
    const result = record(
      await (await this.#getHost()).call("checkin", { provider: input.providerId, account: input.accountId }),
    );
    if (result.outcome === "failed") throw new Error(sourceText("error.app.subscription.checkInFailed"));
    return this.getUsage(input);
  }
  async setOptions(input: SubscriptionOptionsInput): Promise<SubscriptionState> {
    const provider = this.#state.providers.find((item) => item.id === input.providerId && item.enabled);
    if (!provider) throw new Error(sourceText("error.app.subscription.providerUnavailable"));
    for (const key of Object.keys(input.values)) {
      if (!provider.options.some((option) => option.key === key))
        throw new Error(sourceText("error.app.subscription.unknownOption"));
    }
    this.#config.options[input.providerId] = { ...this.#config.options[input.providerId], ...input.values };
    await this.#save();
    await (await this.#getHost()).call("setProviderOptions", { options: this.#config.options });
    return this.refresh();
  }
  #restart(): void {
    if (this.#host) {
      const stopping = this.#host.stop();
      this.#retiringHosts.add(stopping);
      void stopping.finally(() => this.#retiringHosts.delete(stopping));
    }
    this.#host = null;
    this.#native = [];
  }
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#restart();
    await Promise.all(this.#retiringHosts);
    for (const draft of this.#logins.values()) {
      draft.cancelled = true;
      draft.public = { ...draft.public, status: "cancelled" };
      this.#releaseLogin(draft);
    }
    this.#logins.clear();
  }
}
