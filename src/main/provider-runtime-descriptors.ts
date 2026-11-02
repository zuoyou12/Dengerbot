import { chmod, copyFile, link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ManagedRuntimeId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { parseBunVersion } from "../backend/cli";
import { sha256File } from "../backend/file-hash";
import { assertSafeArchive, extractArchive, rejectNonRegularFiles } from "./provider-runtime-archive";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";

export type RuntimeTarget = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

/** A hash of the download, in the algorithm its source publishes. */
export interface ArchiveDigest {
  algorithm: "sha256" | "sha512";
  hex: string;
}

/**
 * Where a version came from, which decides what vouches for its bytes.
 *
 * `lock` is the version this build carries in `native-runtime.lock.json`: every file has a hash the
 * repository reviewed. `latest` is a release found upstream after the build: the download has the
 * hash its source publishes, and the installed files have the hashes recorded when they were
 * installed (see `INSTALL_RECORD`).
 */
type RuntimeSource = "lock" | "latest";

export interface RuntimeSpec {
  runtime: ManagedRuntimeId;
  version: string;
  /** The version the package inside the download carries. */
  packageVersion: string;
  source: RuntimeSource;
  target: RuntimeTarget;
  url: string;
  /** `null` only where the source publishes no hash. */
  archiveDigest: ArchiveDigest | null;
  downloadBytes: number;
  installedBytes: number;
  executableName: string;
}

/**
 * The file an install from an upstream release writes beside its files, naming each one's SHA-256.
 *
 * The lock cannot vouch for a version it has never seen, so what was verified at install time is
 * written down and checked on every start, as the lock's hashes are for a pinned version. It guards
 * against a damaged or replaced install, not against a writer who can change the record as well:
 * the store is the user's, and anything that can write to it can already run as the user.
 */
export const INSTALL_RECORD = "openbot-install.json";

/** Everything a staging step may use. `downloadSmallFile` is passed in so fetching stays private
 *  to the manager: a descriptor can ask for a checksummed LICENSE, and nothing else. */
export interface ProviderStageContext {
  readonly spec: RuntimeSpec;
  /** The verified archive or bare binary the manager downloaded. */
  readonly downloadedPath: string;
  /** The directory the descriptor fills, renamed into place by the manager once it verifies. */
  readonly staging: string;
  readonly lock: AgentRuntimeLock;
  /** `expectedSha256` is `null` for a file of an upstream release, which the lock has no hash for. */
  downloadSmallFile(url: string, expectedSha256: string | null): Effect.Effect<Uint8Array, ProviderRuntimeFailure>;
}

/**
 * How one pinned tool is downloaded, unpacked and checked: a provider CLI, or the JavaScript runtime
 * the MCP servers need.
 *
 * The manager used to answer these four questions with an if-chain over providers, so
 * a provider it had never heard of silently downloaded another provider's binary into that
 * provider's directory. `Record<ManagedRuntimeId, …>` is the fix: a runtime with no descriptor
 * is a `TS2741` naming the id.
 */
export interface ProviderRuntimeDescriptor {
  readonly runtime: ManagedRuntimeId;
  /** Where the artifact for this target lives, and what it should weigh and hash. */
  spec(target: RuntimeTarget, lock: AgentRuntimeLock): RuntimeSpec;
  /** Fill `staging` with the installed layout: `bin/<executable>`, licences and the manifest. */
  stage(context: ProviderStageContext): Effect.Effect<void, ProviderRuntimeFailure>;
  /** Check a pinned install against the lock, beyond the shared executable and `--version` checks. */
  verify(root: string, spec: RuntimeSpec, lock: AgentRuntimeLock): Effect.Effect<void, ProviderRuntimeFailure>;
  /** A file of the install whose text `parseVersion` reads, for a program with no `--version`. */
  readonly versionFile?: string;
  parseVersion(output: string): string;
}

/**
 * The name Bun answers `npx`-shaped arguments under. Bun decides what it is from `argv[0]`, so the
 * same bytes under this second name run packages instead of scripts, and `bunx -y pkg` takes the
 * arguments a catalog entry already writes for `npx`.
 */
export function bunxExecutableName(target: RuntimeTarget): "bunx" | "bunx.exe" {
  return target === "win32-x64" ? "bunx.exe" : "bunx";
}

/**
 * A hard link, because 80MB twice on disk buys nothing and a symlink would fail the staged-layout
 * guard that keeps an archive from writing outside the store. `copyFile` covers the filesystem that
 * refuses a link, so the runtime still installs there; it only costs the space.
 */
const stageBunx = Effect.fn("ProviderRuntime.stageBunx")((binary: string, bunx: string) =>
  runtimeIO(() => link(binary, bunx)).pipe(
    Effect.catch(() =>
      Effect.gen(function* () {
        yield* runtimeIO(() => copyFile(binary, bunx));
        if (!bunx.endsWith(".exe")) yield* runtimeIO(() => chmod(bunx, 0o755));
      }),
    ),
  ),
);

interface NpmPackageCheck {
  name: string;
  version: string;
  archivePathError: string;
  mismatchError: string;
}

/**
 * Unpacks an npm platform tarball beside `staging`, checks that its `package.json` names the pinned
 * package and version, and gives `fill` the package root. The unpacked copy is removed after `fill`,
 * so only what `fill` copies into `staging` is installed.
 */
const withNpmPackage = Effect.fn("ProviderRuntime.withNpmPackage")(function* (
  downloadedPath: string,
  staging: string,
  expected: NpmPackageCheck,
  fill: (packageRoot: string) => Effect.Effect<void, ProviderRuntimeFailure>,
) {
  const extracted = `${staging}.extracted`;
  yield* runtimeIO(() => rm(extracted, { recursive: true, force: true }));
  yield* Effect.acquireUseRelease(
    runtimeIO(() => mkdir(extracted, { recursive: true })),
    () =>
      Effect.gen(function* () {
        yield* assertSafeArchive(downloadedPath, ["package"], expected.archivePathError);
        yield* extractArchive(downloadedPath, extracted);
        yield* rejectNonRegularFiles(extracted);
        const packageRoot = join(extracted, "package");
        const text = yield* runtimeIO(() => readFile(join(packageRoot, "package.json"), "utf8"));
        const packageManifest = yield* runtimeSync(() => JSON.parse(text));
        if (
          !isDynamicRecord(packageManifest) ||
          packageManifest.name !== expected.name ||
          packageManifest.version !== expected.version
        )
          return yield* new ProviderRuntimeFailure({ cause: new Error(expected.mismatchError) });
        yield* fill(packageRoot);
      }),
    () => runtimeIO(() => rm(extracted, { recursive: true, force: true })).pipe(Effect.orDie),
  );
});

/** The `<runtime>-package.json` text that each install writes beside its files. */
function layoutManifest(fields: Record<string, string>): string {
  return `${JSON.stringify({ layoutVersion: 1, ...fields })}\n`;
}

const PROVIDER_RUNTIME_DESCRIPTORS: Record<ManagedRuntimeId, ProviderRuntimeDescriptor> = {
  bun: {
    runtime: "bun",
    spec: (target, lock) => {
      const artifact = lock.bun.artifacts[target];
      return {
        runtime: "bun",
        target,
        version: lock.bun.version,
        packageVersion: lock.bun.version,
        source: "lock",
        url: `${lock.bun.registry}/${artifact.package}/-/${artifact.asset}`,
        archiveDigest: { algorithm: "sha256", hex: artifact.assetSha256 },
        downloadBytes: artifact.downloadBytes,
        installedBytes: artifact.installedBytes,
        executableName: artifact.executable,
      };
    },
    stage: Effect.fn("ProviderRuntime.bun.stage")(function* ({
      spec,
      downloadedPath,
      staging,
      lock,
      downloadSmallFile,
    }: ProviderStageContext): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.bun.artifacts[spec.target];
      yield* withNpmPackage(
        downloadedPath,
        staging,
        {
          name: artifact.package,
          version: lock.bun.version,
          archivePathError: sourceText("error.provider.bunArchivePath"),
          mismatchError: sourceText("error.provider.bunPackageMismatch"),
        },
        (packageRoot: string) =>
          Effect.gen(function* () {
            // The platform tarball carries no licence, so it comes from the tagged source like Codex's.
            const license = yield* downloadSmallFile(
              `${lock.bun.repository}/raw/${encodeURIComponent(lock.bun.tag)}/LICENSE.md`,
              lock.bun.licenseSha256,
            );
            const binary = join(staging, "bin", artifact.executable);
            yield* runtimeIO(() => mkdir(join(staging, "bin"), { recursive: true }));
            yield* Effect.all(
              [
                runtimeIO(() => copyFile(join(packageRoot, "bin", artifact.executable), binary)),
                runtimeIO(() => writeFile(join(staging, "LICENSE.md"), license)),
                runtimeIO(() =>
                  writeFile(
                    join(staging, "bun-package.json"),
                    layoutManifest({
                      version: lock.bun.version,
                      target: spec.target,
                      executable: `bin/${artifact.executable}`,
                    }),
                  ),
                ),
              ],
              { concurrency: "unbounded" },
            );
            if (spec.target !== "win32-x64") yield* runtimeIO(() => chmod(binary, 0o755));
            yield* stageBunx(binary, join(staging, "bin", bunxExecutableName(spec.target)));
          }),
      );
    }),
    verify: Effect.fn("ProviderRuntime.bun.verify")(function* (
      root: string,
      spec: RuntimeSpec,
      lock: AgentRuntimeLock,
    ): Effect.fn.Return<void, ProviderRuntimeFailure> {
      const artifact = lock.bun.artifacts[spec.target];
      const executable = join(root, "bin", spec.executableName);
      if (
        (yield* sha256File(executable).pipe(Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })))) !==
        artifact.binarySha256
      )
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.bunChecksum")) });
      if (
        (yield* sha256File(join(root, "LICENSE.md")).pipe(
          Effect.mapError(({ cause }) => new ProviderRuntimeFailure({ cause })),
        )) !== lock.bun.licenseSha256
      ) {
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.bunLicenseChecksum")) });
      }
      // Only the size, because the second name is the same bytes: hashing 80MB twice on every start
      // would buy nothing. A truncated or replaced file fails this, and a swapped whole binary is
      // what the `bun` hash above already answers for.
      const [bun, bunx] = yield* Effect.all(
        [runtimeIO(() => stat(executable)), runtimeIO(() => stat(join(root, "bin", bunxExecutableName(spec.target))))],
        { concurrency: "unbounded" },
      );
      if (bun.size !== bunx.size)
        return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.bunxDamaged")) });
    }),
    parseVersion: parseBunVersion,
  },
};

export function providerRuntimeDescriptor(runtime: ManagedRuntimeId): ProviderRuntimeDescriptor {
  return PROVIDER_RUNTIME_DESCRIPTORS[runtime];
}
