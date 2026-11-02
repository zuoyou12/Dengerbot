/**
 * Stages a plain Node launcher for the packaged application.
 *
 * DSH refuses the Electron runtime, so the DeepSeek provider starts it with a separate `node`.
 * A package cannot rely on the user having one on `PATH`: this downloads the pinned release,
 * checks it against the release's `SHASUMS256.txt`, and keeps only `node.exe` under
 * `build/node-runtime/<platform>/<arch>`. `electron-builder.yml` ships that folder as
 * `resources/node`, and `resolveDshCli` in `src/backend/cli.ts` prefers it.
 *
 * Usage: `bun scripts/install-node-runtime.ts [win32 x64]`
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { download, isCurrentInstallation } from "./runtime-install";

/** The Node build DSH's native loader accepts and this project was verified with. */
const NODE_VERSION = "24.17.0";
/** Release mirrors move; the pin can be repointed without a code change. */
const MIRROR = process.env.OPENBOT_NODE_MIRROR?.trim() || "https://nodejs.org/dist";
const logger = createOpenBotLogger("install-node-runtime");

async function main(): Promise<void> {
  const [platform = "win32", arch = "x64"] = process.argv.slice(2);
  if (platform !== "win32" || arch !== "x64") {
    throw new Error(`Only win32 x64 is staged today, asked for ${platform} ${arch}.`);
  }
  // Node release files name Windows `win`, not `win32`.
  const fileName = `node-v${NODE_VERSION}-${platform === "win32" ? "win" : platform}-${arch}`;
  const binaryName = "node.exe";
  const outputDir = resolve("build/node-runtime", platform, arch);
  const stagedBinary = join(outputDir, binaryName);

  const current = await isCurrentInstallation(async () => {
    const probe = execFileSync(stagedBinary, ["--version"], { encoding: "utf8" }).trim();
    if (probe !== `v${NODE_VERSION}`) throw new Error(`Staged node reports ${probe}.`);
  });
  if (current) {
    logger.info(`Node ${NODE_VERSION} is already staged.`);
    return;
  }

  const zip = await download(fetch, `${MIRROR}/v${NODE_VERSION}/${fileName}.zip`, fileName);
  const sums = await download(fetch, `${MIRROR}/v${NODE_VERSION}/SHASUMS256.txt`, "SHASUMS256");
  const expected = new RegExp(`^([0-9a-f]{64})\\s+${fileName}\\.zip$`, "mu").exec(sums.toString("utf8"))?.[1];
  if (!expected) throw new Error(`SHASUMS256.txt names no ${fileName}.zip.`);
  const actual = createHash("sha256").update(zip).digest("hex");
  if (actual !== expected) throw new Error(`${fileName}.zip sha256 mismatch: ${actual}.`);

  const temp = await mkdtemp(join(tmpdir(), "openbot-node-"));
  try {
    const archive = join(temp, `${fileName}.zip`);
    await writeFile(archive, zip);
    // Windows 10 and newer ship bsdtar, which reads zip. Take only the launcher from the release.
    // Address it absolutely: a Git Bash `tar` on `PATH` is GNU tar, which reads `C:` as a remote
    // host and fails.
    const systemTar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
    execFileSync(systemTar, ["-xf", archive, "-C", temp, `${fileName}/${binaryName}`], { stdio: "inherit" });
    await mkdir(outputDir, { recursive: true });
    await copyFile(join(temp, fileName, binaryName), stagedBinary);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  logger.info(`Node ${NODE_VERSION} staged at ${outputDir}.`);
}

await main().catch((error: unknown) => {
  logger.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
