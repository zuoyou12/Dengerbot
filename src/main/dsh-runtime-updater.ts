import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type { DshRuntimeStatus } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { dshInstall } from "../backend/cli";
import { activeDshRuntime, compareDshVersions, installedDshRuntimes } from "../backend/dsh-runtime";

const exec = promisify(execFile);
type DshFailureKey =
  | "error.provider.dshReleaseNetwork"
  | "error.provider.dshDownload"
  | "error.provider.dshIntegrity"
  | "error.provider.dshRuntime"
  | "error.provider.dshInstall";
class DshUpdateFailure extends Error {
  constructor(key: DshFailureKey) {
    super(sourceText(key));
  }
}

async function safeResult<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DshUpdateFailure) throw error;
    throw new DshUpdateFailure("error.provider.dshInstall");
  }
}

async function npmInstall(
  node: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number },
): Promise<void> {
  try {
    await exec(node, args, options);
  } catch (error) {
    const stderr = isDynamicRecord(error) && typeof error.stderr === "string" ? error.stderr : "";
    const code = isDynamicRecord(error) && typeof error.code === "string" ? error.code : "";
    if (/\b(?:EINTEGRITY|ESHASUM)\b/u.test(stderr)) throw new DshUpdateFailure("error.provider.dshIntegrity");
    if (
      (isDynamicRecord(error) && error.killed === true) ||
      /\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNABORTED|ERR_SOCKET_TIMEOUT|ERR_STREAM_PREMATURE_CLOSE|FETCH_ERROR|CERT_HAS_EXPIRED|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/u.test(
        `${code} ${stderr}`,
      )
    )
      throw new DshUpdateFailure("error.provider.dshDownload");
    if (code === "ENOENT") throw new DshUpdateFailure("error.provider.dshRuntime");
    throw new DshUpdateFailure("error.provider.dshInstall");
  }
}
function parseUpdateJson(text: string): DynamicRecord {
  try {
    const parsed = JSON.parse(text);
    if (isDynamicRecord(parsed)) return parsed;
  } catch {
    throw new DshUpdateFailure("error.provider.dshIntegrity");
  }
  throw new DshUpdateFailure("error.provider.dshIntegrity");
}
const RELEASES_URL = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=100";
const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?$/u;

export interface DshRuntimeUpdaterOptions {
  stateDirectory: string;
  nodeExecutable: () => string | null;
  packaged?: boolean;
  fetchImpl?: typeof fetch;
}

export interface DshRuntimeUpdater {
  status(): Promise<DshRuntimeStatus>;
  checkForUpdate(): Promise<DshRuntimeStatus>;
  installUpdate(input: { version: string }): Promise<DshRuntimeStatus>;
  rollback(): Promise<DshRuntimeStatus>;
}

export function createDshRuntimeUpdater(options: DshRuntimeUpdaterOptions): DshRuntimeUpdater {
  const fetchImpl = options.fetchImpl ?? fetch;
  let latest: string | null = null;
  let updating = false;

  function status(): DshRuntimeStatus {
    const active = activeDshRuntime(options.stateDirectory);
    const installed = installedDshRuntimes(options.stateDirectory).map(({ version }) => ({ version }));
    const activeEntry: DshRuntimeStatus["active"] = active
      ? { version: active.version, source: active.source }
      : { version: dshInstall(options.stateDirectory).version, source: "development" };
    return {
      active: activeEntry,
      installed,
      latest: latest && compareDshVersions(latest, activeEntry.version) > 0 ? { version: latest } : null,
      channelConfigured: true,
    };
  }

  async function checkForUpdate(): Promise<DshRuntimeStatus> {
    latest = null;
    let releases: unknown;
    try {
      const response = await fetchImpl(RELEASES_URL, {
        headers: { "User-Agent": "Dengerbot-dsh-runtime-updater", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("Release service failed.");
      releases = await response.json();
    } catch (error) {
      throw new DshUpdateFailure(
        error instanceof SyntaxError ? "error.provider.dshIntegrity" : "error.provider.dshReleaseNetwork",
      );
    }
    if (!Array.isArray(releases)) throw new DshUpdateFailure("error.provider.dshIntegrity");
    const versions = releases.flatMap((release: unknown) => {
      if (
        !isDynamicRecord(release) ||
        release.draft !== false ||
        typeof release.tag_name !== "string" ||
        typeof release.published_at !== "string"
      )
        return [];
      const match = /^dsh-v(.+)$/u.exec(release.tag_name);
      return match?.[1] && VERSION.test(match[1]) && Number.isFinite(Date.parse(release.published_at))
        ? [match[1]]
        : [];
    });
    versions.sort((a, b) => compareDshVersions(b, a));
    if (!versions[0]) throw new DshUpdateFailure("error.provider.dshIntegrity");
    latest = versions[0];
    return status();
  }

  async function installUpdate(input: { version: string }): Promise<DshRuntimeStatus> {
    if (updating) throw new Error("A DSH update is already running.");
    if (!VERSION.test(input.version) || latest !== input.version || status().latest?.version !== input.version) {
      throw new Error("Check for the current DSH release before installing it.");
    }
    const node = options.nodeExecutable();
    if (!node) throw new DshUpdateFailure("error.provider.dshRuntime");
    const npm = findNpm(options.packaged ?? false);
    if (!npm) throw new DshUpdateFailure("error.provider.dshRuntime");
    updating = true;
    let staging: string | undefined;
    try {
      await mkdir(options.stateDirectory, { recursive: true });
      staging = await mkdtemp(join(options.stateDirectory, ".dsh-update-"));
      await writeFile(
        join(staging, "package.json"),
        JSON.stringify({ name: "dsh-update", private: true, dependencies: { "@deepseek-ai/dsh": input.version } }),
      );
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !/^(npm_config_|node_options$|node_path$)/iu.test(key)),
      );
      env.npm_config_userconfig = join(staging, "user-npmrc");
      env.npm_config_globalconfig = join(staging, "global-npmrc");
      try {
        const npmVersion = await exec(node, [npm, "--version"], { cwd: staging, env, timeout: 10_000 });
        if (!/^(?:1[1-9]|[2-9]\d)\./u.test(npmVersion.stdout.trim())) throw new Error("Unsupported npm.");
        const npmConfig = await exec(node, [npm, "config", "list", "-l"], { cwd: staging, env, timeout: 10_000 });
        if (!/^allow-git\s*=/mu.test(npmConfig.stdout)) throw new Error("Unsupported npm configuration.");
      } catch {
        throw new DshUpdateFailure("error.provider.dshRuntime");
      }
      const flags = [
        "--ignore-scripts",
        "--omit=dev",
        "--no-audit",
        "--no-fund",
        "--allow-git=none",
        "--registry=https://registry.npmjs.org",
        `--cache=${join(staging, "cache")}`,
      ];
      const execOptions = { cwd: staging, env, timeout: 15 * 60_000, maxBuffer: 4 * 1024 * 1024 };
      await npmInstall(node, [npm, "install", "--package-lock-only", ...flags], execOptions);
      const lock = parseUpdateJson(await readFile(join(staging, "package-lock.json"), "utf8"));
      if (!isDynamicRecord(lock) || !isDynamicRecord(lock.packages))
        throw new DshUpdateFailure("error.provider.dshIntegrity");
      for (const [name, entry] of Object.entries(lock.packages)) {
        if (!name) continue;
        if (
          !isDynamicRecord(entry) ||
          typeof entry.resolved !== "string" ||
          typeof entry.integrity !== "string" ||
          !entry.integrity.startsWith("sha512-") ||
          !entry.resolved.startsWith("https://registry.npmjs.org/")
        ) {
          throw new DshUpdateFailure("error.provider.dshIntegrity");
        }
      }
      await npmInstall(node, [npm, "ci", ...flags], execOptions);
      const manifest = parseUpdateJson(
        await readFile(join(staging, "node_modules", "@deepseek-ai", "dsh", "package.json"), "utf8"),
      );
      if (!isDynamicRecord(manifest) || manifest.name !== "@deepseek-ai/dsh" || manifest.version !== input.version)
        throw new DshUpdateFailure("error.provider.dshIntegrity");
      const home = await mkdtemp(join(tmpdir(), "tecat-dsh-home-"));
      try {
        try {
          await exec(node, [join(staging, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"), "--version"], {
            cwd: staging,
            env: { ...process.env, DSH_HOME: home },
            timeout: 90_000,
          });
        } catch {
          throw new DshUpdateFailure("error.provider.dshRuntime");
        }
      } finally {
        await rm(home, { recursive: true, force: true });
      }
      const root = join(options.stateDirectory, "dsh-runtime");
      mkdirSync(root, { recursive: true });
      const target = join(root, input.version);
      if (existsSync(target)) throw new Error("This DSH version is already installed.");
      await rename(staging, target);
      staging = undefined;
      return status();
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
      updating = false;
    }
  }

  async function rollback(): Promise<DshRuntimeStatus> {
    if (updating) throw new Error("A DSH update is already running.");
    const root = join(options.stateDirectory, "dsh-runtime");
    if (existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) rmSync(join(root, entry.name), { recursive: true, force: true });
      }
    }
    return status();
  }

  return {
    status: () => safeResult(async () => status()),
    checkForUpdate: () => safeResult(checkForUpdate),
    installUpdate: (input) => safeResult(() => installUpdate(input)),
    rollback: () => safeResult(rollback),
  };
}

function findNpm(packaged: boolean): string | null {
  if (process.resourcesPath) {
    const bundled = join(process.resourcesPath, "dsh-runtime", "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(bundled)) return bundled;
  }
  if (packaged) return null;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    for (const path of [
      join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      join(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ]) {
      if (existsSync(path)) return path;
    }
  }
  return null;
}
