import { MANAGED_RUNTIME_PROVIDERS, type ManagedProviderId } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import type { RuntimeSpec, RuntimeTarget } from "./provider-runtime-descriptors";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";

/**
 * The latest release of each managed provider CLI, read from the source that publishes it.
 *
 * OpenBot used to install only the version `native-runtime.lock.json` pinned, so a new CLI reached
 * users with the next OpenBot release. Providers ship faster than that, so the update offer now
 * follows upstream. The lock still names the version a first install uses when no source answers.
 *
 * Every download keeps a hash from its source: GitHub's asset `digest` for Pi and npm's
 * `dist.integrity` for OpenCode. Bun is a tool runtime rather than a provider, and stays on the lock.
 */

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LatestReleaseContext {
  target: RuntimeTarget;
  lock: AgentRuntimeLock;
  fetch: Fetch;
}

/**
 * Versions the OpenBot repository asks every installation not to offer.
 *
 * This is the one way to stop a broken upstream release without shipping an OpenBot release. It is a
 * block list, not an allow list: a new release is offered at once, and only a version named here is
 * held back. A list that cannot be read blocks nothing.
 */
const BLOCKED_VERSIONS_URL =
  "https://raw.githubusercontent.com/nightly-labs/openbot/main/provider-runtime-blocklist.json";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const HEADERS = { "User-Agent": "OpenBot-runtime-installer" };

export type BlockedVersions = ReadonlyMap<ManagedProviderId, ReadonlySet<string>>;

const LATEST_RELEASES: ReadonlyMap<
  ManagedProviderId,
  (context: LatestReleaseContext) => Effect.Effect<RuntimeSpec, ProviderRuntimeFailure>
> = new Map([]);

export function latestRelease(
  provider: ManagedProviderId,
  context: LatestReleaseContext,
): Effect.Effect<RuntimeSpec, ProviderRuntimeFailure> {
  const release = LATEST_RELEASES.get(provider);
  if (!release)
    return Effect.fail(
      new ProviderRuntimeFailure({
        cause: new Error(sourceText("error.provider.releaseNoDownload", { name: provider })),
      }),
    );
  return release(context);
}
export const fetchBlockedVersions = Effect.fn("ProviderRelease.fetchBlockedVersions")(function* (
  fetch: Fetch,
): Effect.fn.Return<BlockedVersions, ProviderRuntimeFailure> {
  const value = yield* fetchJsonEffect(fetch, BLOCKED_VERSIONS_URL);
  if (!(value.schemaVersion === 1 && isDynamicRecord(value.blocked))) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.blockedListShape")) });
  }
  const blocked = new Map<ManagedProviderId, ReadonlySet<string>>();
  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const versions = value.blocked[provider];
    if (Array.isArray(versions)) blocked.set(provider, new Set(versions.filter(isString)));
  }
  return blocked;
});

const fetchJsonEffect = Effect.fn("ProviderRelease.fetchJson")(function* (
  fetch: Fetch,
  url: string,
  headers: Record<string, string> = {},
): Effect.fn.Return<DynamicRecord, ProviderRuntimeFailure> {
  const text = yield* readTextEffect(yield* requestEffect(fetch, url, headers));
  const value = yield* runtimeSync(() => JSON.parse(text));
  if (!isDynamicRecord(value))
    return yield* new ProviderRuntimeFailure({
      cause: new Error(sourceText("error.provider.releaseMetadataNotObject")),
    });
  return value;
});

const requestEffect = Effect.fn("ProviderRelease.request")(function* (
  fetch: Fetch,
  url: string,
  headers: Record<string, string> = {},
): Effect.fn.Return<Response, ProviderRuntimeFailure> {
  const response = yield* runtimeIO((signal) =>
    fetch(url, {
      headers: { ...HEADERS, ...headers },
      redirect: "follow",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    }),
  );
  if (!response.ok) {
    yield* runtimeIO(async () => {
      await response.body?.cancel();
    }).pipe(Effect.catch(() => Effect.void));
    return yield* new ProviderRuntimeFailure({
      cause: new Error(sourceText("error.provider.releaseCheckHttp", { status: response.status })),
    });
  }
  return response;
});

const readTextEffect = Effect.fn("ProviderRelease.readText")(function* (
  response: Response,
): Effect.fn.Return<string, ProviderRuntimeFailure> {
  const value = yield* readLimitedBody(response, sourceText("error.provider.releaseMetadataTooLarge"));
  return value ? new TextDecoder().decode(value) : "";
});
export const readLimitedBody = Effect.fn("ProviderRelease.readLimitedBody")(function* (
  response: Response,
  tooLargeMessage: string,
): Effect.fn.Return<Uint8Array | null, ProviderRuntimeFailure> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_METADATA_BYTES) {
    yield* runtimeIO(async () => {
      await response.body?.cancel();
    }).pipe(Effect.catch(() => Effect.void));
    return yield* new ProviderRuntimeFailure({ cause: new Error(tooLargeMessage) });
  }
  const body = response.body;
  if (!body) return null;
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    (reader) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = yield* runtimeIO(() => reader.read());
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_METADATA_BYTES)
            return yield* new ProviderRuntimeFailure({ cause: new Error(tooLargeMessage) });
          chunks.push(chunk.value);
        }
        const value = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          value.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return value;
      }),
    (reader) =>
      runtimeIO(() => reader.cancel()).pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => reader.releaseLock())),
      ),
  );
});
