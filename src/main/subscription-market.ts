import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import type {
  SubscriptionMarketSnapshot,
  SubscriptionPackageMetadata,
  SubscriptionPluginListing,
} from "@openbot/contracts/subscription-catalog";
import {
  isSubscriptionPackageName,
  SUBSCRIPTION_PLUGIN_CATALOG,
  SUBSCRIPTION_PLUGIN_MARKET_URL,
} from "@openbot/contracts/subscription-catalog";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

export class SubscriptionMarketFailure extends Schema.TaggedError<SubscriptionMarketFailure>()(
  "SubscriptionMarketFailure",
  { cause: Schema.Defect() },
) {}
const { io } = causeHelpers(SubscriptionMarketFailure);
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const clean = (value: unknown, max = 4096): string =>
  typeof value === "string"
    ? value
        .slice(0, max)
        .split("")
        .filter((character) => {
          const code = character.charCodeAt(0);
          return (code >= 32 && code !== 127) || code === 9 || code === 10;
        })
        .join("")
        .replace(/\bBearer\s+\S+|\bsk-[a-zA-Z0-9_-]{12,}/gu, "[redacted]")
    : "";
function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value) &&
    !["constructor", "prototype"].includes(value)
  );
}
function icon(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/u.test(value) ? value : "generic";
}
function registryListing(value: unknown): SubscriptionPluginListing | null {
  if (
    !isDynamicRecord(value) ||
    !isSubscriptionPackageName(value.package) ||
    (value.kind !== undefined && value.kind !== "") ||
    !Array.isArray(value.providers) ||
    value.providers.length === 0 ||
    value.providers.length > 64 ||
    !value.providers.every(identifier)
  )
    return null;
  const summary = isDynamicRecord(value.summary) ? value.summary : {};
  return {
    id: value.package.split("/").at(-1) ?? value.package,
    packageName: value.package,
    name: clean(value.name, 256) || value.package,
    icon: icon(value.icon),
    providerIds: [...new Set(value.providers)],
    description: { en: clean(summary.en), zh: clean(summary.zh) },
    community: value.community === true,
  };
}
function safeHomepage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
async function readJson(response: Response): Promise<DynamicRecord> {
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body)
    throw new Error("Subscription market request failed.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Subscription market response is too large.");
      chunks.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = JSON.parse(new TextDecoder().decode(data));
    if (!isDynamicRecord(parsed)) throw new Error("Invalid subscription market document.");
    return parsed;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface SubscriptionPluginMarketOptions {
  domesticMirror: () => boolean;
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/** Reads public registry metadata only. It never installs, imports or executes npm package code. */
export class SubscriptionPluginMarket {
  readonly #options: SubscriptionPluginMarketOptions;
  #entries: readonly SubscriptionPluginListing[] = SUBSCRIPTION_PLUGIN_CATALOG;
  #loaded = false;
  constructor(options: SubscriptionPluginMarketOptions) {
    this.#options = options;
  }
  #registry(): string {
    return this.#options.domesticMirror() ? "https://registry.npmmirror.com" : "https://registry.npmjs.org";
  }
  #get(url: string, accept = "application/json") {
    return io(async (signal) =>
      readJson(
        await (this.#options.fetchImpl ?? fetch)(url, {
          headers: { accept, "user-agent": "Dengerbot-subscription-market" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          redirect: "error",
        }),
      ),
    );
  }
  readonly catalog = Effect.fn("SubscriptionPluginMarket.catalog")(function* (this: SubscriptionPluginMarket) {
    const result = yield* Effect.result(
      this.#get(SUBSCRIPTION_PLUGIN_MARKET_URL).pipe(
        Effect.catch(() =>
          this.#get(
            "https://api.github.com/repos/magpie-community/plugins/contents/registry.json?ref=main",
            "application/vnd.github.raw+json",
          ),
        ),
      ),
    );
    if (result._tag === "Failure")
      return {
        entries: this.#entries,
        source: this.#loaded ? "cached" : "offline",
        error: "unavailable",
      } satisfies SubscriptionMarketSnapshot;
    const value = result.success;
    if (!isDynamicRecord(value) || !Array.isArray(value.plugins) || value.plugins.length > 4096)
      return {
        entries: this.#entries,
        source: this.#loaded ? "cached" : "offline",
        error: "invalid-registry",
      } satisfies SubscriptionMarketSnapshot;
    const entries = new Map<string, SubscriptionPluginListing>();
    for (const candidate of value.plugins) {
      const entry = registryListing(candidate);
      if (entry) entries.set(entry.packageName, entry);
    }
    if (!entries.size)
      return {
        entries: this.#entries,
        source: this.#loaded ? "cached" : "offline",
        error: "invalid-registry",
      } satisfies SubscriptionMarketSnapshot;
    this.#entries = [...entries.values()];
    this.#loaded = true;
    return { entries: this.#entries, source: "registry" } satisfies SubscriptionMarketSnapshot;
  });
  readonly packageMetadata = Effect.fn("SubscriptionPluginMarket.packageMetadata")(function* (
    this: SubscriptionPluginMarket,
    packageName: string,
  ) {
    if (!isSubscriptionPackageName(packageName))
      return yield* Effect.fail(
        new SubscriptionMarketFailure({ cause: new Error("Invalid subscription package name.") }),
      );
    const value = yield* this.#get(`${this.#registry()}/${encodeURIComponent(packageName)}/latest`);
    if (
      !isDynamicRecord(value) ||
      value.name !== packageName ||
      typeof value.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u.test(value.version) ||
      value.version.length > 160
    )
      return yield* Effect.fail(
        new SubscriptionMarketFailure({ cause: new Error("Invalid subscription package metadata.") }),
      );
    return {
      packageName,
      version: value.version,
      description: clean(value.description),
      license: typeof value.license === "string" ? clean(value.license, 160) : undefined,
      homepage: safeHomepage(value.homepage),
    } satisfies SubscriptionPackageMetadata;
  });
  readonly search = Effect.fn("SubscriptionPluginMarket.search")(function* (
    this: SubscriptionPluginMarket,
    query: string,
  ) {
    const needle = query.trim();
    if (needle.length > 256)
      return yield* Effect.fail(
        new SubscriptionMarketFailure({ cause: new Error("Subscription search query is too long.") }),
      );
    const matches = this.#entries.filter((entry) =>
      `${entry.name} ${entry.packageName} ${entry.description.en} ${entry.description.zh}`
        .toLowerCase()
        .includes(needle.toLowerCase()),
    );
    if (!needle) return matches;
    const data = yield* this.#get(
      `${this.#registry()}/-/v1/search?text=${encodeURIComponent(`${needle} keywords:opencode-plugin`)}&size=50`,
    );
    if (!isDynamicRecord(data) || !Array.isArray(data.objects) || data.objects.length > 250)
      return yield* Effect.fail(
        new SubscriptionMarketFailure({ cause: new Error("Invalid subscription search response.") }),
      );
    const results = new Map(matches.map((entry) => [entry.packageName, entry]));
    for (const item of data.objects) {
      if (!isDynamicRecord(item) || !isDynamicRecord(item.package)) continue;
      const pkg = item.package;
      if (!isSubscriptionPackageName(pkg.name)) continue;
      const keywords = Array.isArray(pkg.keywords)
        ? pkg.keywords.filter((entry): entry is string => typeof entry === "string")
        : [];
      const words = `${pkg.name} ${keywords.join(" ")}`.toLowerCase();
      if (
        !/(?:opencode|magpie)/u.test(words) ||
        !/(?:auth|provider|subscription)/u.test(words) ||
        /(?:middleware|agent-|tools-|page-)/u.test(words)
      )
        continue;
      const known = this.#entries.find((entry) => entry.packageName === pkg.name);
      const description = clean(pkg.description);
      results.set(
        pkg.name,
        known ?? {
          id: pkg.name.split("/").at(-1) ?? pkg.name,
          name: pkg.name,
          packageName: pkg.name,
          icon: "generic",
          providerIds: [],
          description: { en: description, zh: description },
          community: false,
        },
      );
    }
    return [...results.values()];
  });
}
