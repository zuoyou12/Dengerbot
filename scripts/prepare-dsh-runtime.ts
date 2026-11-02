/**
 * Builds the standalone DSH runtime tree the packaged application ships.
 *
 * The DeepSeek provider is DSH, started by a plain Node outside the app bundle, which cannot read
 * an asar archive. So the release keeps a real, self-contained tree under
 * `build/dsh-runtime/<platform>/<arch>`: one `package.json` that names the same pinned dependency
 * as this repository, and its production install next to it. `electron-builder.yml` ships that
 * folder as `resources/dsh-runtime`, and `dshInstall` in `src/backend/cli.ts` resolves it there.
 *
 * Usage: `bun scripts/prepare-dsh-runtime.ts [win32 x64]`
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { isCurrentInstallation } from "./runtime-install";

const PACKAGE_NAME = "@deepseek-ai/dsh";
const NPM_VERSION = "11.13.0";
const manifestSchema = z.object({ version: z.string() });
const rootManifestSchema = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
});
/** A registry mirror can be named for the same reason as for Electron; the default is npm's own. */
const REGISTRY = process.env.OPENBOT_NPM_REGISTRY?.trim() || "https://registry.npmjs.org";
const logger = createOpenBotLogger("prepare-dsh-runtime");

async function main(): Promise<void> {
  const [platform = "win32", arch = "x64"] = process.argv.slice(2);
  if (platform !== "win32" || arch !== "x64") {
    throw new Error(`Only win32 x64 is prepared today, asked for ${platform} ${arch}.`);
  }
  const root = await readFile(resolve("package.json"), "utf8");
  const rootManifest = rootManifestSchema.parse(JSON.parse(root));
  const pinned = rootManifest.dependencies?.[PACKAGE_NAME] ?? rootManifest.devDependencies?.[PACKAGE_NAME];
  if (!pinned) throw new Error(`${PACKAGE_NAME} is not a dependency of this build.`);

  const target = resolve("build/dsh-runtime", platform, arch);
  const manifest = join(target, "node_modules", PACKAGE_NAME, "package.json");
  const current = await isCurrentInstallation(async () => {
    const installed = manifestSchema.parse(JSON.parse(await readFile(manifest, "utf8")));
    if (installed.version !== pinned) throw new Error(`Installed ${installed.version}, pinned ${pinned}.`);
    const npm = manifestSchema.parse(
      JSON.parse(await readFile(join(target, "node_modules", "npm", "package.json"), "utf8")),
    );
    if (npm.version !== NPM_VERSION) throw new Error(`Installed npm ${npm.version}, pinned ${NPM_VERSION}.`);
    const npmCli = join(target, "node_modules", "npm", "bin", "npm-cli.js");
    if (execFileSync("node", [npmCli, "--version"], { encoding: "utf8" }).trim() !== NPM_VERSION) {
      throw new Error("The staged npm is not usable.");
    }
  });
  if (current) {
    logger.info(`DSH ${pinned} is already prepared at ${target}.`);
    return;
  }

  await mkdir(target, { recursive: true });
  writeFileSync(
    join(target, "package.json"),
    `${JSON.stringify({ name: "openbot-dsh-runtime", private: true, dependencies: { [PACKAGE_NAME]: pinned, npm: NPM_VERSION } }, null, 2)}\n`,
  );
  const npm = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(isAbsolute)
    .map((directory) => join(directory, "node_modules", "npm", "bin", "npm-cli.js"))
    .find(existsSync);
  if (!npm) throw new Error("Node and npm 11 are required to prepare the DSH runtime.");
  const config = execFileSync("node", [npm, "config", "list", "-l"], { encoding: "utf8" });
  if (!/^allow-git\s*=/mu.test(config)) throw new Error("npm must support the allow-git setting.");
  logger.info(`Installing ${PACKAGE_NAME}@${pinned} and npm ${NPM_VERSION} from ${REGISTRY} into ${target}.`);
  execFileSync(
    "node",
    [
      npm,
      "install",
      "--ignore-scripts",
      "--allow-git=none",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      "--registry",
      REGISTRY,
    ],
    {
      cwd: target,
      stdio: "inherit",
    },
  );

  const installed = manifestSchema.parse(JSON.parse(await readFile(manifest, "utf8")));
  if (installed.version !== pinned) throw new Error(`Installed ${installed.version}, expected ${pinned}.`);
  const bundledNpm = join(target, "node_modules", "npm", "bin", "npm-cli.js");
  const npmVersion = execFileSync("node", [bundledNpm, "--version"], { encoding: "utf8" }).trim();
  if (npmVersion !== NPM_VERSION) throw new Error(`Installed npm ${npmVersion}, expected ${NPM_VERSION}.`);
  logger.info(`DSH ${pinned} and npm ${npmVersion} prepared at ${target}.`);
}

await main().catch((error: unknown) => {
  logger.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
