/**
 * Packs the staged DSH runtime tree into the archive the update channel serves.
 *
 * `prepare:dsh-runtime` builds `build/dsh-runtime/<platform>/<arch>`; this writes
 * `dist/dsh-runtime-<version>-<platform>-<arch>.tar.gz` and a manifest that names the archive, its
 * version and its SHA-256. Publish both, and set `OPENBOT_DSH_RUNTIME_MANIFEST` to the manifest URL.
 *
 * Usage: `bun scripts/package-dsh-runtime.ts [win32 x64]`
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";

const logger = createOpenBotLogger("package-dsh-runtime");

function main(): void {
  const [platform = "win32", arch = "x64"] = process.argv.slice(2);
  const tree = resolve("build/dsh-runtime", platform, arch);
  const manifestPath = join(tree, "node_modules", "@deepseek-ai", "dsh", "package.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`No staged DSH tree at ${tree}. Run \`bun run prepare:dsh-runtime ${platform} ${arch}\` first.`);
  }
  const staged = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = typeof staged?.version === "string" ? staged.version : null;
  if (!version) throw new Error("The staged DSH manifest has no version.");

  const outputDir = resolve("dist");
  mkdirSync(outputDir, { recursive: true });
  const name = `dsh-runtime-${version}-${platform}-${arch}.tar.gz`;
  const archive = join(outputDir, name);
  // The archive holds the tree at its root: `package.json` and `node_modules` are the first entries.
  const tar =
    process.platform === "win32" ? join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-czf", archive, "-C", tree, "."], { stdio: "inherit" });

  const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
  const manifest = {
    version,
    url: name,
    sha256,
    bytes: statSync(archive).size,
  };
  const manifestFile = join(outputDir, `dsh-runtime-${platform}-${arch}.json`);
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  logger.info("DSH runtime archive written.", { archive, sha256, version });
  logger.info(`Manifest: ${manifestFile}`);
}

main();
