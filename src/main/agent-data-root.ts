import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/** The root below which `Agents`, `Shared` and `Downloads` live. */
export const AGENT_DATA_ROOT_ENV = "DENGERBOT_HOME";
export const AGENT_DATA_FOLDER = "DengerBot";
export const WINDOWS_AGENT_DATA_ROOT = "D:\\DengerBot";

/**
 * Where the agent folders live on this computer.
 *
 * Windows keeps them on `D:` so the profile drive does not grow with every agent workspace. The
 * drive is used only when this user can write to its root: a second disk on another account, a
 * read-only mount or an optical drive falls back to the home folder. macOS and Linux have no second
 * drive convention, so the folder sits in the home folder, where the old root was and where the user
 * can reach it in Finder. `DENGERBOT_HOME` overrides both, and must be absolute so that it names the
 * same folder from every working directory.
 */
export function resolveAgentDataRoot(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  driveIsWritable: (drive: string) => boolean = writableDirectory,
): string {
  const path = platform === "win32" ? win32 : posix;
  const override = environment[AGENT_DATA_ROOT_ENV]?.trim();
  if (override) {
    if (!path.isAbsolute(override)) throw new Error(`${AGENT_DATA_ROOT_ENV} must be an absolute path.`);
    return path.normalize(override);
  }
  if (platform === "win32" && driveIsWritable(win32.parse(WINDOWS_AGENT_DATA_ROOT).root)) {
    return WINDOWS_AGENT_DATA_ROOT;
  }
  return path.join(homeDirectory, AGENT_DATA_FOLDER);
}

function writableDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
