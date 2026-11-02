import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";

/**
 * The folders one Workspace only agent may write: its workspace and the shared folder. The temporary
 * folders and the provider's state are added to them.
 *
 * A provider that takes no sandbox per session gets a provider process of its own for a
 * Workspace only agent, and OpenBot starts that process inside an operating system sandbox. The whole process is confined: the file edit tools, the shell, and every
 * command and MCP server it starts. Nothing inside the process can take the sandbox away. Only macOS
 * has the sandbox now: on Linux and Windows the process does not start, and the user must choose
 * Full access.
 */
export interface ProcessConfinement {
  readonly writableRoots: readonly string[];
}

/** What a provider must write to run, and what in there it must not write. */
export interface ProviderStatePaths {
  readonly writable: readonly string[];
  /**
   * Files and folders in `writable` that load code or settings for the provider processes that are
   * not confined. A confined agent that wrote them would reach outside at the next start of one.
   */
  readonly protected: readonly string[];
  /**
   * Folders in `writable` that hold a folder for each project, and the file names in there, at any
   * depth, that trust a project or approve its MCP servers for the processes that are not confined.
   */
  readonly protectedInProjects?: { readonly folders: readonly string[]; readonly names: readonly string[] };
  /**
   * Files outside `writable` that the provider writes in, and that processes that are not confined
   * open too. Only their contents are writable: a confined agent that replaced one with a link would
   * send those processes' writes outside.
   */
  readonly writableContents?: readonly string[];
}

export interface SpawnTarget {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

class ProcessConfinementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessConfinementUnavailableError";
  }
}

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
/**
 * OpenCode keeps its sessions under the XDG data and state folders. Its settings folder is not in the
 * list, so it stays read-only. Its cache holds the npm packages and the language servers that every
 * OpenCode process runs, so a confined process gets a cache of its own: `OPENCODE_CONFINED_ENV`.
 */
export function openCodeStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const xdg = (name: string, fallback: string) => join(env[name]?.trim() || join(home, fallback), "opencode");
  return {
    writable: [xdg("XDG_DATA_HOME", ".local/share"), xdg("XDG_STATE_HOME", ".local/state"), OPENCODE_CONFINED_CACHE],
    protected: [],
  };
}

const OPENCODE_CONFINED_CACHE = join(tmpdir(), "openbot-confined-cache");

/** The folder where Pi keeps its sign-in, settings and sessions. */
export function piAgentDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
}

/** Pi can write sessions, but cannot change the settings or extensions a later full-access run loads. */
export function piStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  return { writable: [join(piAgentDirectory(env, home), "sessions")], protected: [] };
}
/** The environment of a confined OpenCode process: its own cache, apart from the one outside. */
export const OPENCODE_CONFINED_ENV: Readonly<Record<string, string>> = { XDG_CACHE_HOME: OPENCODE_CONFINED_CACHE };

/**
 * The project settings of every provider, in each root, whatever the provider of this process. A
 * process that is not confined and starts in that folder later loads them and runs their hooks,
 * plugins and commands: a Full access session of any provider, or the provider's CLI in a terminal.
 * A Workspace only Claude session ignores `.claude/settings*.json`, and Codex keeps `.codex` read-only
 * in its own sandbox for the same reason. A whole folder is denied, because a folder renamed to
 * `.claude` would bring a settings file past a rule for the file alone.
 */
const PROJECT_SETTINGS = [
  ".claude",
  ".codex",
  ".grok",
  ".opencode",
  "opencode.json",
  "opencode.jsonc",
  // Cursor reads its project rules, MCP servers, hooks and skills from `.cursor`.
  ".cursor",
  // Cline reads its project rules, workflows, hooks, skills and agents from these two.
  ".cline",
  ".clinerules",
  ".pi",
  ".muse",
  // Antigravity reads project skills from `.gemini` and its customizations from these four.
  ".gemini",
  ".agents",
  ".agent",
  "_agents",
  "_agent",
];

/**
 * The command that starts `target` inside the sandbox. It throws when this computer cannot make the
 * sandbox, because a Workspace only agent must not run with full access.
 */
export function confineSpawnTarget(
  target: SpawnTarget,
  confinement: ProcessConfinement,
  state: ProviderStatePaths,
  platform: NodeJS.Platform = process.platform,
): SpawnTarget {
  const writable = [...confinement.writableRoots, ...state.writable, ...workspaceTemporaryPaths(platform)];
  const protectedPaths = [
    ...state.protected,
    ...confinement.writableRoots.flatMap((root) => PROJECT_SETTINGS.map((name) => join(root, name))),
  ];
  if (platform === "darwin") {
    if (!existsSync(SANDBOX_EXEC)) throw new ProcessConfinementUnavailableError(unavailable("macOS sandbox-exec"));
    return {
      command: SANDBOX_EXEC,
      args: [
        "-p",
        seatbeltProfile(writable, protectedPaths, state.protectedInProjects, state.writableContents ?? []),
        target.command,
        ...target.args,
      ],
      windowsVerbatimArguments: false,
    };
  }
  // bubblewrap on Linux cannot deny a protected file that does not exist yet, such as a new
  // `opencode.json`, so Linux fails closed until it can.
  throw new ProcessConfinementUnavailableError(sourceText("error.agent.workspaceOnlyMacOnly"));
}

function unavailable(tool: string): string {
  return sourceText("error.agent.workspaceOnlyToolMissing", { tool });
}

/**
 * Writes are denied, then allowed in the writable folders, then denied again in the protected paths:
 * in a Seatbelt profile the last rule that matches wins. `file-write-data` allows writes in an
 * existing file, not its removal, a rename or a link in its place. Everything else stays open, as
 * the Access setting says: reads, the network and process starts.
 */
function seatbeltProfile(
  writable: readonly string[],
  protectedPaths: readonly string[],
  inProjects: ProviderStatePaths["protectedInProjects"],
  contents: readonly string[],
): string {
  const allowed = unique(writable.flatMap(realPaths)).map((path) => `(subpath ${sbplString(path)})`);
  const files = unique(contents.flatMap(realPaths)).map((path) => `(literal ${sbplString(path)})`);
  const names = inProjects?.names.map(regexText).join("|");
  const denied = [
    ...unique(protectedPaths.flatMap(realPaths)).map(
      (path) => `(literal ${sbplString(path)}) (subpath ${sbplString(path)})`,
    ),
    ...(names
      ? unique(inProjects?.folders.flatMap(realPaths) ?? []).map(
          (folder) => `(regex ${sbplString(`^${regexText(folder)}/(.+/)?(${names})(/|$)`)})`,
        )
      : []),
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${allowed.join(" ")})`,
    ...(files.length > 0 ? [`(allow file-write-data ${files.join(" ")})`] : []),
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/ptmx") (literal "/dev/dtracehelper") (regex #"^/dev/ttys[0-9]+$") (regex #"^/dev/fd/"))',
    ...(denied.length > 0 ? [`(deny file-write* ${denied.join(" ")})`] : []),
    "",
  ].join("\n");
}

/**
 * The path as written and as the kernel sees it. Seatbelt matches the real path, so `/tmp` must also
 * be given as `/private/tmp`, and a folder that does not exist yet is resolved through its parent.
 */
function realPaths(path: string): string[] {
  const absolute = resolve(path);
  return unique([absolute, resolveExisting(absolute)]);
}

function resolveExisting(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(resolveExisting(parent), basename(path));
  }
}

function regexText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sbplString(value: string): string {
  return JSON.stringify(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
