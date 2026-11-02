import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";

/**
 * Where the DeepSeek Harness runs from. The application ships one baseline build in its resources;
 * the update channel installs a newer build under `provider-state/dsh-runtime/<version>`, and that
 * one wins while it is present. Each build is a standalone production install whose entry is
 * `node_modules/@deepseek-ai/dsh`.
 */
export interface DshRuntimeInstall {
  version: string;
  directory: string;
  source: "installed" | "bundled" | "development";
}

const MANIFEST = join("node_modules", "@deepseek-ai", "dsh", "package.json");

function manifestVersion(directory: string): string | null {
  const path = join(directory, MANIFEST);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isDynamicRecord(parsed) && typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function splitVersion(version: string): { main: number[]; pre: string[] } {
  const [main = "", pre] = version.split("-", 2);
  return {
    main: main.split(".").map((part) => Number(part)),
    pre: pre ? pre.split(".") : [],
  };
}

/** Semver order for the versions DSH publishes, prerelease tags included (`0.2.1-rc.3`). */
export function compareDshVersions(left: string, right: string): number {
  const a = splitVersion(left);
  const b = splitVersion(right);
  for (let index = 0; index < Math.max(a.main.length, b.main.length); index += 1) {
    const x = a.main[index] ?? 0;
    const y = b.main[index] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  // A release outranks any prerelease of the same main version.
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = Number(x);
    const yn = Number(y);
    if (!Number.isNaN(xn) && !Number.isNaN(yn)) {
      if (xn !== yn) return xn < yn ? -1 : 1;
      continue;
    }
    if (!Number.isNaN(xn)) return -1;
    if (!Number.isNaN(yn)) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** The builds installed by the update channel, newest first. */
export function installedDshRuntimes(stateDirectory: string | undefined): DshRuntimeInstall[] {
  if (!stateDirectory) return [];
  const root = join(stateDirectory, "dsh-runtime");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const directory = join(root, entry.name);
      const version = manifestVersion(directory);
      return version ? [{ version, directory, source: "installed" as const }] : [];
    })
    .sort((a, b) => compareDshVersions(b.version, a.version));
}

/** The build the next session starts with: the newest installed one, else the shipped baseline. */
export function activeDshRuntime(stateDirectory: string | undefined): DshRuntimeInstall | null {
  const installed = installedDshRuntimes(stateDirectory);
  const newest = installed[0];
  if (!process.resourcesPath) return newest ?? null;
  const bundled = join(process.resourcesPath, "dsh-runtime");
  const version = manifestVersion(bundled);
  if (newest && (!version || compareDshVersions(newest.version, version) > 0)) return newest;
  return version ? { version, directory: bundled, source: "bundled" } : null;
}
