import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  type AgentAuthState,
  type AgentModelOption,
  type AgentProviderId,
  agentProviderDescriptor,
  type KeyOnlyProviderId,
  type PromptCacheTtl,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { AcpAgentClient, type AcpHistoryPersistence } from "./acp-client";
import { DSH_ACP_FLAVOR } from "./acp-flavor-dsh";
import { codexFastServiceTier } from "./agent/provider-models";
import type { AgentClient } from "./agent-client";
import { CodexAppServerClient } from "./app-server-client";
import { ClaudeAgentClient } from "./claude-client";
import {
  type AgentCliInfo,
  cliPathEnvironment,
  dshInstall,
  resolveClaudeCli,
  resolveCodexCli,
  resolveDshCli,
} from "./cli";
import type { CustomProviderConfig, CustomProviderSource } from "./custom-provider-types";
import type { McpOAuthAuthority } from "./mcp-oauth-provider";
import type { McpOAuthProxySettingsStore } from "./mcp-oauth-proxy";
import type { McpDropReporter, McpEndpointSource, McpServerSource, McpToolRuntimeSource } from "./mcp-provider-shapes";
import type { ProcessConfinement } from "./process-confinement";
import { type AccountReadResult, isCodexLoginType, type ModelListResponse } from "./protocol";
import { type ProviderClientOperationError, ProviderSignInError, providerFailure } from "./provider-client-effects";

/** One command OpenBot runs against a provider's own CLI, waiting for the process to exit. */
interface ProviderCliCommand {
  readonly argv: readonly string[];
  readonly env: (cli: AgentCliInfo) => Record<string, string>;
  readonly timeoutMs: number;
}

/**
 * How a provider keeps more than one account on this computer. Its CLI keeps the credentials,
 * sessions and settings of one account in a home folder that one variable names, so each account
 * after the first gets a folder of its own. The first account stays in the CLI's default folder.
 */
export interface ProviderAccountSupport {
  /** The variable that names the CLI's home folder. */
  readonly homeVariable: string;
  /** Signs a new, empty home folder in through the browser: a CLI command. */
  readonly signIn: ProviderCliCommand;
  /** Signs the account out before its folder is removed, for a CLI that keeps a credential outside it. */
  readonly signOut?: ProviderCliCommand;
  /** False for a CLI version that ignores `homeVariable`. Absent when every version reads it. */
  supports?(cli: AgentCliInfo): boolean;
  /**
   * A usage read in a process of its own leaves a session on disk. An account with no agent process
   * then shows its last reading, from its sign-in check, and starts no process to read usage.
   */
  readonly usageLeavesSession?: boolean;
}

/**
 * How a provider is signed in. The union makes each driver say what it is, and a new arm is a
 * compile error at both sign-in sites rather than a wrong login.
 */
type ProviderSignIn =
  /** The provider's own app-server hands back a URL for OpenBot to open. */
  | { kind: "browser" }
  /** OpenBot spawns the provider's CLI and waits for the process to exit. */
  | { kind: "cli-command"; command: ProviderCliCommand }
  /** The user signs in with the CLI themselves; OpenBot only re-probes the provider afterwards. */
  | { kind: "external" }
  /** The host opens an interactive terminal and refreshes the account when it closes. */
  | { kind: "terminal"; timeoutMs: number };

/**
 * A sign-in the user finishes on another device, for a host with no browser the user can see.
 * `codex-device` is the Codex app-server device code. `muse-device` is the device code a `muse serve`
 * host asks Meta for. `cli` spawns the provider's CLI and reads its link: `device` prints a code the
 * user confirms, `paste` waits for the code the provider's page shows, which the user copies back,
 * and `link` is a page that signs the CLI in by itself.
 */
type ProviderCodeSignIn =
  /** The Codex app-server's own device-code login. */
  { kind: "codex-device" } | { kind: "cli"; flow: "device" | "paste" | "link"; command: ProviderCliCommand };

/**
 * What a client needs from the app at spawn, beyond its own CLI: the stored secrets, and the user's
 * own endpoints.
 *
 * Required rather than optional on purpose: a driver that needs a stored key has no other way to
 * reach one, and a call site that forgets the endpoints builds a client whose user simply sees their
 * models missing. `apiKey` is synchronous because the store is loaded eagerly at startup, and
 * `customProviders` is a getter, because both are read inside a spawn.
 */
export interface ProviderClientContext {
  apiKey(provider: AgentProviderId): string | null;
  /** Durable provider-history ports, selected by the external provider id. */
  readonly history?: (provider: AgentProviderId) => AcpHistoryPersistence | undefined;
  readonly customProviders: CustomProviderSource;
  /**
   * The MCP servers the user enabled, read at spawn like the endpoints above. Each client resolves
   * and converts them itself, because the three providers take three different shapes.
   */
  readonly mcpServers: McpServerSource;
  /**
   * What a provider could not be given, reported once per spawn. Optional, so the test call sites
   * and `NO_PROVIDER_CREDENTIALS` stay valid: a driver with no reporter drops silently, exactly as
   * every driver did before.
   */
  readonly reportMcpDrops?: McpDropReporter;
  /**
   * What OpenBot downloaded for the MCP servers, read at spawn like everything else here. Optional
   * for the same reason as `reportMcpDrops`: a driver without one sees the machine as it is.
   */
  readonly mcpToolRuntimes?: McpToolRuntimeSource;
  /**
   * Where each http server is reached and with which bearer, read at spawn: a server this machine
   * signed in to is a route of the loopback OAuth proxy. Optional for the same reason again: a
   * driver without one hands over the URL and the headers the user wrote.
   */
  readonly mcpEndpoint?: McpEndpointSource;
  /**
   * The sign-ins this machine holds for http MCP servers. Read by `AgentService` and by nothing
   * else: a driver is given `mcpEndpoint` above, which never holds an OAuth token. This is
   * the whole authority - it signs in, refreshes and forgets - so it travels no further.
   */
  readonly mcpOAuth?: McpOAuthAuthority;
  /**
   * Where the OAuth proxy keeps its port and secret, so a Codex session resumed after a restart
   * reaches the same address. Optional: without it the proxy takes a new port at each start.
   */
  readonly mcpOAuthProxySettings?: McpOAuthProxySettingsStore;
  /**
   * Whether this model may still be used. A removed endpoint stays in the running process, with the
   * credentials it started with, until that process restarts, and the restart waits for the work in
   * flight. Read at the last moment before a prompt leaves, because everything above it awaits.
   */
  servesModel?(modelId: string): boolean;
  /**
   * A folder OpenBot owns for files it gives a provider process, outside every root an agent can
   * write. Optional for the same reason as `reportMcpDrops`.
   */
  readonly providerStateDirectory?: string;
  /**
   * A folder OpenBot owns for the temporary files of provider processes, emptied at each launch.
   * Optional for the same reason as `reportMcpDrops`: without it a process uses the system folder.
   * The app gives it on Windows only.
   */
  readonly providerTempDirectory?: string;
  /** The free bytes on the volume of a path. Optional: without it the volume is read. */
  readonly availableDiskBytes?: (path: string) => number;
  /**
   * Variables an agent's tools run with, beyond the user's own environment: today the paths that
   * point `gh` and `git` at the built-in GitHub connection. Paths only, never a secret, because a
   * provider process can outlive the token. Read at each spawn; empty while nothing is connected.
   */
  readonly agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>;
  /**
   * Variables that every provider process gets on a server, and so every program an agent starts: the
   * marker that the server memory guard finds leftover processes by, and the CPU limit module for Node
   * (`agentProcessEnvironment` in `src/main/server-memory.ts`). Fixed while the app runs. They are not
   * part of `agentEnvironment`: Codex gets that in each thread configuration and replaces a session
   * whose variables change, so Codex gets these in the spawn environment of its app-server instead.
   */
  readonly serverEnvironment?: Readonly<Record<string, string>>;
  /**
   * The home folder variable of a provider account after the first, for a driver with `accounts`.
   * Every process the client starts gets it, the account check included, so the client signs in
   * and keeps its sessions in that folder only.
   */
  readonly accountEnvironment?: Readonly<Record<string, string>>;
  /**
   * How long this server asks Claude to keep the prompt cache, read at each spawn. Optional for the
   * same reason as `reportMcpDrops`: without it the CLI uses its own cache time.
   */
  readonly promptCacheTtl?: () => PromptCacheTtl;
}

/** Nothing stored and no endpoint, for tests and for call sites that predate the credential store. */
export const NO_PROVIDER_CREDENTIALS: ProviderClientContext = {
  apiKey: () => null,
  customProviders: () => [],
  mcpServers: () => [],
};

/**
 * How a provider's model list differs from a plain `model/list` reading. Absent for a provider that
 * needs nothing more.
 */
interface ProviderModelCatalog {
  /** The CLI gives its list in pages, with `nextCursor`. */
  readonly paged?: true;
  /** The list can take the full request timeout, not 5 s. */
  readonly slowList?: true;
  /** No models while the provider says that the user must sign in and it has no client. */
  readonly hiddenWhenSignedOut?: true;
  /** The name to show for a model, before the name the CLI gives. Null keeps the CLI's name. */
  modelName?(id: string): string | null;
  /** Fields that only this provider's CLI reports. */
  modelFields?(model: ModelListResponse["data"][number]): { fastServiceTier?: string };
  /** False drops a model that the stored API key cannot use. Runs only while a key is stored. */
  usableWithStoredKey?(id: string, name: string): boolean;
  /**
   * The models to keep when the list failed, timed out or came back empty. Without this hook a
   * failed list keeps the previous models, and an empty list is a real answer.
   */
  fallback?(previous: AgentModelOption[]): AgentModelOption[];
}

/**
 * What a provider *does*. What it is called, how it is described and where its sign-in help points
 * live in the provider registry in `@openbot/contracts/agent-providers`; a driver holds only the
 * behaviour, so a new provider is one registry row plus one driver.
 */
export interface BuiltInProviderDriver {
  id: AgentProviderId;
  signIn: ProviderSignIn;
  /**
   * The file the provider's CLI writes when the user signs in with it. The host checks the account
   * again when this file changes, so a sign-in done outside OpenBot, such as over SSH, needs no
   * restart. Absent for a provider that OpenBot always signs in itself.
   */
  signInFile?(): string;
  /** Absent for a provider that has no sign-in on another device. */
  codeSignIn?: ProviderCodeSignIn;
  /** Absent for a provider that holds one account only. */
  accounts?: ProviderAccountSupport;
  /** The provider whose downloaded CLI this one runs. Absent when the provider has a CLI of its own. */
  cliProvider?: AgentProviderId;
  /** Absent for a provider whose `model/list` needs no special reading. */
  catalog?: ProviderModelCatalog;
  resolveCli(options?: {
    bundledExecutable?: string | null | undefined;
    /** Where the update channel installs runtimes; absent when the caller has no user data folder. */
    stateDirectory?: string | undefined;
  }): Effect.Effect<AgentCliInfo, ProviderClientOperationError>;
  createClient(
    cli: AgentCliInfo,
    requestTimeoutMs: number,
    context: ProviderClientContext,
    confinement?: ProcessConfinement,
  ): AgentClient;
  /**
   * The client that writes an agent profile, when the provider needs a different one. Profile
   * generation asks the model one question and must not let it act, so a provider that can be
   * started without tools starts that way here. Without this hook the normal client is used.
   */
  createProfileClient?(cli: AgentCliInfo, requestTimeoutMs: number, context: ProviderClientContext): AgentClient;
  authState(account: AccountReadResult["account"]): AgentAuthState;
  validateAccount(account: NonNullable<AccountReadResult["account"]>): void;
}

/**
 * DeepSeek runs on the bundled DeepSeek Harness, through its ACP server. DSH is a Node program whose
 * native loader refuses the Electron runtime, so the resolved launcher is a Node installation on this
 * computer and the entry file is passed as the first argument.
 */
/**
 * DSH keeps its profiles, sessions and credential file under `DSH_HOME`. The folder must belong to
 * this application: `~/.dsh` is the data of whatever DSH the user runs themselves.
 */
function dshHomeEnvironment(context: ProviderClientContext): { DSH_HOME?: string } {
  const root = context.providerStateDirectory;
  if (!root) return {};
  const home = join(root, "dsh");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return { DSH_HOME: home };
}

interface DshPiAiProviderProfile {
  readonly displayName: string;
  readonly api: NonNullable<CustomProviderConfig["api"]>;
  readonly baseURL: string;
  readonly apiKeyEnv?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly models: readonly { readonly id: string; readonly name: string }[];
}

/**
 * DSH compacts by itself while a turn runs, at `min(0.8W, W - output - 65536)`. With a large
 * window that is far below 80%, so it would compact before OpenBot gets a chance to rotate with a
 * history handoff. No extra headroom and a 95% ratio give `min(0.95W, W - output)`: for a 128K
 * window and an 8K output cap that is 93.75%, so OpenBot acts first. A window below about 80K, or a
 * large routed output cap, can still make DSH trigger first; the handoff still reads OpenBot's own
 * history, so that is a lost note rather than lost data. `maxTokens` is the summary output cap and
 * must be explicit when the headroom is zero.
 */
const DSH_COMPACTION_PATCH = {
  id: "compaction-basic",
  config: { thresholdRatio: 0.95, headroomTokens: 0, maxTokens: 8192 },
} as const;

/**
 * Writes the DSH profile patch into `$DSH_HOME/profiles/acp/cordis.patch.yml`: the compaction
 * policy above and, when there are any, the user's custom OpenAI-compatible endpoints for
 * `@deepseek-ai/dsh-llm-pi-ai`. Returns the environment variables carrying their API keys.
 */
export function configureDshCustomProviders(
  home: string | undefined,
  providers: readonly CustomProviderConfig[],
): Record<string, string> {
  const env: Record<string, string> = {};
  const providerProfiles: Record<string, DshPiAiProviderProfile> = {};
  for (const [index, endpoint] of providers.entries()) {
    if ((!endpoint.apiKey && endpoint.headers.length === 0) || endpoint.models.length === 0) continue;
    const hasAuthHeader = endpoint.headers.some((header) => header.name.toLowerCase() === "authorization");
    const apiKeyEnv = endpoint.apiKey || !hasAuthHeader ? `OPENBOT_CUSTOM_API_KEY_${index}` : undefined;
    if (apiKeyEnv) env[apiKeyEnv] = endpoint.apiKey || "local";
    providerProfiles[endpoint.id] = {
      displayName: endpoint.name,
      api: endpoint.api ?? "openai-completions",
      baseURL: endpoint.baseUrl,
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      ...(endpoint.headers.length > 0
        ? { headers: Object.fromEntries(endpoint.headers.map((header) => [header.name, header.value])) }
        : {}),
      models: endpoint.models.map((model) => ({
        id: model.id,
        name: model.name,
      })),
    };
  }
  if (home) {
    const profileDir = join(home, "profiles", "acp");
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const patch = [
      DSH_COMPACTION_PATCH,
      ...(Object.keys(providerProfiles).length > 0
        ? [{ id: "llm-pi-ai", config: { providers: providerProfiles } }]
        : []),
    ];
    writeFileSync(join(profileDir, "cordis.patch.yml"), `${JSON.stringify(patch, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  return env;
}

function dshClient(
  provider: KeyOnlyProviderId,
  cli: AgentCliInfo,
  timeout: number,
  context: ProviderClientContext,
  profileGeneration = false,
): AgentClient {
  const { bin } = dshInstall();
  const signInMessage = agentProviderDescriptor(provider).signInMessage;
  const history = context.history?.(provider);
  return new AcpAgentClient(cli, timeout, {
    provider,
    flavor: DSH_ACP_FLAVOR,
    argv: [bin, "--profile", "acp"],
    env: {},
    extraEnv: () => {
      const key = context.apiKey(provider);
      const dshHome = dshHomeEnvironment(context);
      const home = context.accountEnvironment?.DSH_HOME ?? dshHome.DSH_HOME;
      const customEnv = configureDshCustomProviders(home, context.customProviders());
      return {
        ...context.agentEnvironment?.(),
        ...(key ? { DEEPSEEK_API_KEY: key } : {}),
        ...customEnv,
        ...dshHome,
        ...(context.accountEnvironment ?? {}),
      };
    },
    signInMessage,
    // DSH publishes its model catalog before any key is stored, so a successful discovery is not
    // proof of an account. A stored DeepSeek key or a configured custom endpoint is.
    authenticate: () => {
      if (
        context.apiKey(provider) ||
        context
          .customProviders()
          .some((endpoint) => (endpoint.apiKey || endpoint.headers.length > 0) && endpoint.models.length > 0)
      )
        return Effect.void;
      return Effect.fail(providerFailure(new ProviderSignInError({ message: signInMessage })));
    },
    ...(profileGeneration ? { profileGeneration: true } : {}),
    ...(context.servesModel ? { servesModel: context.servesModel } : {}),
    mcpServers: context.mcpServers,
    ...(context.reportMcpDrops ? { reportMcpDrops: context.reportMcpDrops } : {}),
    ...(context.mcpToolRuntimes ? { mcpToolRuntimes: context.mcpToolRuntimes } : {}),
    ...(context.mcpEndpoint ? { mcpEndpoint: context.mcpEndpoint } : {}),
    ...(history ? { history } : {}),
  });
}

export const BUILT_IN_PROVIDER_DRIVERS: readonly BuiltInProviderDriver[] = [
  {
    id: "codex",
    signIn: { kind: "browser" },
    codeSignIn: { kind: "codex-device" },
    accounts: {
      homeVariable: "CODEX_HOME",
      signIn: { argv: ["login"], env: () => ({}), timeoutMs: 600_000 },
      signOut: { argv: ["logout"], env: () => ({}), timeoutMs: 30_000 },
    },
    catalog: { paged: true, modelFields: codexFastServiceTier },
    resolveCli: resolveCodexCli,
    createClient: (cli, requestTimeoutMs, context) =>
      new CodexAppServerClient(cli.executable, requestTimeoutMs, {
        ...cliPathEnvironment(cli),
        ...context.serverEnvironment,
        ...context.accountEnvironment,
      }),
    authState: (account) => ({ kind: "chatgpt", email: account?.email ?? null }),
    // An API-key login has no plan usage to read.
    validateAccount: (account) => {
      if (!isCodexLoginType(account.type)) {
        throw new Error(sourceText("error.provider.codexLoginRequired"));
      }
    },
  },
  {
    id: "claude",
    signIn: {
      kind: "cli-command",
      command: { argv: ["auth", "login", "--claudeai"], env: () => ({}), timeoutMs: 600_000 },
    },
    codeSignIn: {
      kind: "cli",
      flow: "paste",
      command: { argv: ["auth", "login", "--claudeai"], env: () => ({}), timeoutMs: 600_000 },
    },
    accounts: {
      homeVariable: "CLAUDE_CONFIG_DIR",
      signIn: { argv: ["auth", "login", "--claudeai"], env: () => ({}), timeoutMs: 600_000 },
      signOut: { argv: ["auth", "logout"], env: () => ({}), timeoutMs: 30_000 },
    },
    resolveCli: resolveClaudeCli,
    createClient: (cli, timeout, context) =>
      new ClaudeAgentClient(
        cli,
        undefined,
        undefined,
        timeout,
        context.mcpServers,
        context.reportMcpDrops,
        context.mcpToolRuntimes,
        context.mcpEndpoint,
        context.providerStateDirectory,
        (inherited) => ({
          ...context.agentEnvironment?.(inherited),
          ...context.accountEnvironment,
          ...(context.promptCacheTtl?.() === "1h" ? { ENABLE_PROMPT_CACHING_1H: "1" } : {}),
        }),
        undefined,
        context.accountEnvironment ? undefined : () => context.apiKey("claude"),
      ),
    authState: (account) => ({ kind: "claude", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
  {
    id: "deepseek",
    // DSH reads the saved key from its environment; nothing signs in through a browser.
    signIn: { kind: "external" },
    cliProvider: "deepseek",
    resolveCli: resolveDshCli,
    createClient: (cli, timeout, context) => dshClient("deepseek", cli, timeout, context),
    createProfileClient: (cli, timeout, context) => dshClient("deepseek", cli, timeout, context, true),
    authState: (account) => ({ kind: "deepseek", email: account?.email ?? null }),
    validateAccount: () => undefined,
  },
] as const;

const PROVIDER_DRIVERS = new Map(BUILT_IN_PROVIDER_DRIVERS.map((driver) => [driver.id, driver]));

export function requireProviderDriver(provider: AgentProviderId): BuiltInProviderDriver {
  const driver = PROVIDER_DRIVERS.get(provider);
  if (!driver) throw new Error(`Unknown agent provider: ${provider}`);
  return driver;
}
