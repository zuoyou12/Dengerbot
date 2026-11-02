import { existsSync, readdirSync } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { isMissingFileError } from "../src/backend/file-errors";
import { type DevelopmentProfile, developmentUserDataName } from "../src/main/development-profile";
import { resolveDevelopmentAppDataRoot } from "./development-state-paths";
import { readScriptArguments } from "./script-arguments";
import { cleanupSeedOwnedTransfers, isDevelopmentProfileActive } from "./seed-dev-state";

export { resolveDevelopmentAppDataRoot } from "./development-state-paths";

const logger = createOpenBotLogger("reset-dev-state");

const developmentProfiles = ["app", "test-client"] as const satisfies readonly DevelopmentProfile[];
// The profile names this fork used before the Dengerbot identity, kept so that `dev:reset` also
// removes them from a computer that ran those builds.
const legacyDevelopmentStateNames = [
  "OpenBot Dev",
  "OpenBot Dev Test Client",
  "OpenBot Dev Host",
  "Dengerbot Dev Host",
] as const;

const USAGE = [
  "Usage: bun run dev:reset",
  "",
  "Deletes the app, test-client, and legacy host development profiles. It refuses while a",
  "dev app has one of them open. It takes no options.",
].join("\n");

export function developmentStatePaths(appDataRoot: string): string[] {
  const safeRoot = resolve(appDataRoot);
  if (safeRoot === parse(safeRoot).root) {
    throw new Error("The application data root cannot be a filesystem root.");
  }

  const worktreeProfiles: string[] = [];
  if (existsSync(safeRoot)) {
    try {
      const entries = readdirSync(safeRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /^(?:Dengerbot|OpenBot) Dev wt-/u.test(entry.name)) {
          worktreeProfiles.push(entry.name);
        }
      }
    } catch {
      // Ignore directory read errors
    }
  }

  const candidateNames = Array.from(
    new Set([
      ...developmentProfiles.map((profile) => developmentUserDataName(profile)),
      ...legacyDevelopmentStateNames,
      ...worktreeProfiles,
    ]),
  );

  return candidateNames.map((name) => {
    const target = resolve(safeRoot, name);
    if (dirname(target) !== safeRoot) {
      throw new Error(`Unsafe Dengerbot dev state path: ${target}`);
    }
    return target;
  });
}

export async function resetDevelopmentState(
  appDataRoot: string,
  homeDirectory = homedir(),
  beforeDelete: (statePath: string) => void = () => {},
): Promise<string[]> {
  const existingPaths: string[] = [];
  for (const statePath of developmentStatePaths(appDataRoot)) {
    try {
      await lstat(statePath);
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
    existingPaths.push(statePath);
  }

  // Check every profile before deleting any, so a refusal leaves all of them as they were.
  for (const statePath of existingPaths) {
    if (await isDevelopmentProfileActive(statePath)) {
      throw new Error(`Quit the OpenBot dev app before you reset its state. ${statePath} is open.`);
    }
  }

  for (const statePath of existingPaths) {
    beforeDelete(statePath);
    await cleanupSeedOwnedTransfers(statePath, homeDirectory);
    await rm(statePath, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
  }

  // Also remove agent workspaces, dynamic agent database, and transfers
  const extraPaths = [
    join(homeDirectory, "OpenBot", "Agents"),
    join(homeDirectory, "OpenBot", "Shared", "Data", "agent-data.db"),
    join(homeDirectory, "OpenBot", "Shared", "Data", "agent-data.db-wal"),
    join(homeDirectory, "OpenBot", "Shared", "Data", "agent-data.db-shm"),
    join(homeDirectory, "OpenBot", "Shared", "Transfers"),
  ];

  for (const extraPath of extraPaths) {
    try {
      await lstat(extraPath);
    } catch (error) {
      if (isMissingFileError(error)) {
        continue;
      }
      throw error;
    }
    beforeDelete(extraPath);
    await rm(extraPath, { force: true, maxRetries: 3, recursive: true, retryDelay: 100 });
    existingPaths.push(extraPath);
  }

  return existingPaths;
}

async function main(): Promise<void> {
  if (readScriptArguments({ usage: USAGE, options: {} }) === null) return;
  const appDataRoot = resolveDevelopmentAppDataRoot();
  const deletedPaths = await resetDevelopmentState(appDataRoot, homedir(), (statePath) => {
    logger.info(`Deleting ${statePath}`);
  });

  if (deletedPaths.length === 0) {
    logger.info("No OpenBot development state was found.");
  } else {
    logger.info("OpenBot development state reset.");
  }

  logger.info("Seed-owned and shared transfer files were removed.");
  logger.info("Agent workspaces (~/OpenBot/Agents) and dynamic agent data were removed.");
  // The downloaded provider CLIs are the computer's now, not this profile's, so a reset no longer
  // takes them. Say so: it used to cost a fresh download of every one of them.
  logger.info("~/.codex, ~/.claude, and downloaded provider CLIs were not changed.");
}

function isMainModule(): boolean {
  const entryPath = process.argv[1];
  return entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href;
}

if (isMainModule()) {
  main().catch((error: unknown) => {
    logger.error(toLogValue(error));
    process.exitCode = 1;
  });
}
