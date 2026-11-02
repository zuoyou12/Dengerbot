import { execFile, spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, delimiter, dirname, extname, isAbsolute, join, win32 } from "node:path";
import { promisify } from "node:util";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result } from "effect";
import { activeDshRuntime } from "./dsh-runtime";
import { type ProviderClientOperationError, providerCall, providerFailure } from "./provider-client-effects";

const execFileAsync = promisify(execFile);

/** What every resolved provider CLI carries. */
interface ResolvedCli {
  executable: string;
  version: string;
  /**
   * The `PATH` that `--version` ran with, if the resolver captured one. Each process of the CLI
   * starts with it. Absent on Windows, which has no login shell, and when the CLI was not run.
   */
  launchPath?: string;
}

/** What every resolved provider CLI carries, with its install source. */
export type AgentCliInfo = ResolvedCli & {
  source?: "system" | "managed";
};

export type ClaudeCliInfo = AgentCliInfo;

export function claudeTakesPromptSnapshotFlag(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  return (
    (parts[0] ?? 0) > 2 ||
    ((parts[0] ?? 0) === 2 && ((parts[1] ?? 0) > 1 || ((parts[1] ?? 0) === 1 && (parts[2] ?? 0) >= 263)))
  );
}

export const cliLaunchPath = Effect.fn("Cli.launchPath")(function* (
  executable: string,
  source: "system" | "managed" | undefined,
) {
  if (process.platform === "win32") return null;
  const folders = (yield* loginSearchPath()).filter((folder) => isAbsolute(folder));
  const own = dirname(executable);
  if (source === "system" && !folders.includes(own)) folders.push(own);
  return folders.length ? folders.join(delimiter) : null;
});

export const resolveClaudeCli = Effect.fn("Cli.resolveClaudeCli")(function* (
  input: { bundledExecutable?: string | null } = {},
): Effect.fn.Return<ClaudeCliInfo, ProviderClientOperationError> {
  const configured = configuredCliPath("claude");
  const candidates: string[] = [];
  if (configured) candidates.push(configured);
  if (input.bundledExecutable) candidates.push(input.bundledExecutable);
  if (process.platform === "win32") {
    const result = yield* providerCall(() =>
      execFileAsync("where.exe", ["claude"], { timeout: 5000, maxBuffer: 65536 }),
    ).pipe(Effect.catch(() => Effect.succeed({ stdout: "" })));
    candidates.push(
      ...result.stdout
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean),
    );
  } else {
    candidates.push(
      ...(yield* loginSearchPath()).filter((folder) => isAbsolute(folder)).map((folder) => join(folder, "claude")),
    );
  }
  for (const executable of candidates) {
    if (!(yield* isExecutable(executable))) continue;
    const target = cliSpawnTarget(executable, ["--version"]);
    const result = yield* Effect.result(
      providerCall(() =>
        execFileAsync(target.command, target.args, {
          timeout: 10000,
          maxBuffer: 65536,
          windowsVerbatimArguments: target.windowsVerbatimArguments,
        }),
      ),
    );
    if (Result.isFailure(result)) continue;
    const version = /\d+\.\d+\.\d+/u.exec(result.success.stdout)?.[0];
    if (!version) continue;
    const source = executable === input.bundledExecutable ? ("managed" as const) : ("system" as const);
    const launchPath = yield* cliLaunchPath(executable, source);
    return { executable, version, source, ...(launchPath ? { launchPath } : {}) };
  }
  return yield* Effect.fail(providerFailure(new CodexCliError(sourceText("error.provider.claudeMissing"), "missing")));
});

export class CodexCliError extends Error {
  constructor(
    message: string,
    readonly code: "missing" | "invalid" | "outdated" | "timeout",
  ) {
    super(message);
    this.name = "CodexCliError";
  }
}

/** The version the app-server adapter needs: paged history arrived in this release. */
const MINIMUM_CODEX_VERSION: readonly [number, number, number] = [0, 156, 0];

export interface CodexCliInfo extends AgentCliInfo {
  source: "system" | "managed";
}

/** Codex prints `codex-cli 0.156.0`, and older builds print the bare version. */
export function parseCodexVersion(output: string): string {
  const match = /(?:codex-cli\s+)?(\d+)\.(\d+)\.(\d+)/iu.exec(output);
  if (!match?.[1] || !match[2] || !match[3])
    throw new CodexCliError(sourceText("error.provider.codexVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function isMinimumCodexVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (!match?.[1] || !match[2] || !match[3]) return false;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  for (let index = 0; index < parts.length; index += 1) {
    const difference = (parts[index] ?? 0) - (MINIMUM_CODEX_VERSION[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

/**
 * Resolves the Codex CLI on this computer. The user's own installation is the only source in this
 * build: `OPENBOT_CODEX_PATH`, then the application's copy when one is named, then `codex` on the
 * login `PATH` and in the folders the Codex installer uses. A build older than the app-server
 * adapter is refused here rather than failing halfway through a thread.
 */
export const resolveCodexCli = Effect.fn("Cli.resolveCodexCli")(function* (
  input: {
    systemCandidates?: string[];
    bundledExecutable?: string | null | undefined;
    /** Accepted for the driver signature; Codex needs no state directory of its own. */
    stateDirectory?: string | undefined;
  } = {},
): Effect.fn.Return<CodexCliInfo, ProviderClientOperationError> {
  const configured = configuredCliPath("codex");
  const candidates: string[] = [];
  if (configured) candidates.push(configured);
  if (input.bundledExecutable) candidates.push(input.bundledExecutable);
  if (input.systemCandidates) candidates.push(...input.systemCandidates);
  if (process.platform === "win32") {
    const result = yield* providerCall(() =>
      execFileAsync("where.exe", ["codex"], { timeout: 5_000, maxBuffer: 65_536 }),
    ).pipe(Effect.catch(() => Effect.succeed({ stdout: "" })));
    candidates.push(
      ...result.stdout
        .split(/\r?\n/u)
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) candidates.push(win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe"));
    const appData = process.env.APPDATA?.trim();
    if (appData) candidates.push(win32.join(appData, "npm", "codex.cmd"));
  } else {
    candidates.push(
      ...(yield* loginSearchPath()).filter((folder) => isAbsolute(folder)).map((folder) => join(folder, "codex")),
    );
  }

  let found = false;
  let unreadable = false;
  for (const executable of [...new Set(candidates)]) {
    if (!(yield* isExecutable(executable))) continue;
    found = true;
    const target = cliSpawnTarget(executable, ["--version"]);
    const result = yield* Effect.result(
      providerCall(() =>
        execFileAsync(target.command, target.args, {
          timeout: CLI_VERSION_TIMEOUT_MS,
          maxBuffer: 65_536,
          windowsVerbatimArguments: target.windowsVerbatimArguments,
        }),
      ),
    );
    if (Result.isFailure(result)) continue;
    let version: string;
    try {
      version = parseCodexVersion(result.success.stdout);
    } catch {
      unreadable = true;
      continue;
    }
    if (!isMinimumCodexVersion(version))
      return yield* Effect.fail(
        providerFailure(new CodexCliError(sourceText("error.provider.codexOutdated", { version }), "outdated")),
      );
    const source = input.bundledExecutable && executable === input.bundledExecutable ? "managed" : "system";
    const launchPath = yield* cliLaunchPath(executable, source);
    return { executable, version, source, ...(launchPath ? { launchPath } : {}) };
  }

  return yield* Effect.fail(
    providerFailure(
      new CodexCliError(
        unreadable
          ? sourceText("error.provider.codexVersionUnreadable")
          : found
            ? sourceText("error.provider.codexNotStartedHint")
            : sourceText("error.provider.codexMissing"),
        unreadable ? "invalid" : found ? "invalid" : "missing",
      ),
    ),
  );
});

/**
 * The managed CLI OpenBot downloaded for each provider, keyed by provider id. `null` means OpenBot
 * has no managed copy and only the user's own installation is used. A missing key means the same as
 * an unset option: the resolver looks for the copy shipped inside the application itself.
 */
export type BundledProviderExecutables = Partial<Record<AgentProviderId, string | null | undefined>>;
/**
 * Bun prints a bare `1.4.2` and nothing else. It is not a provider CLI, so no discovery step reads
 * this; only `verifyInstalledRuntime` does, to confirm the binary in the store is the pinned one.
 */
export function parseBunVersion(output: string): string {
  const match = output.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+][\w.-]+)?$/);
  if (!match) throw new CodexCliError(sourceText("error.provider.bunVersionUnreadable"), "invalid");
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

/**
 * The DSH entry point and version. The update channel installs a newer build under
 * `provider-state/dsh-runtime`, and that one wins over the shipped baseline. DSH is a Node program,
 * so the executable that starts it is a Node launcher, not the entry file.
 */
export function dshInstall(stateDirectory?: string): { bin: string; version: string } {
  const requireModule = createRequire(import.meta.url);
  // A packaged app ships DSH outside the asar: the launcher is a plain Node, which cannot read an
  // asar archive. Unpacked, the tree holds its own `node_modules`.
  const runtime = activeDshRuntime(stateDirectory);
  const roots = runtime
    ? [runtime.directory]
    : process.resourcesPath
      ? [join(process.resourcesPath, "dsh-runtime")]
      : [];
  const resolve = (id: string) => {
    try {
      return requireModule.resolve(id, roots.length > 0 ? { paths: roots } : undefined);
    } catch {
      // No runtime tree beside the application: fall back to this build's own dependencies, which is
      // the development layout. In a package the spawn fails later with a visible provider error.
      return requireModule.resolve(id);
    }
  };
  const manifest = requireModule(resolve("@deepseek-ai/dsh/package.json"));
  return {
    bin: resolve("@deepseek-ai/dsh/lib/bin.js"),
    version: isDynamicRecord(manifest) && typeof manifest.version === "string" ? manifest.version : "0.0.0",
  };
}

/**
 * The oldest Node that runs DSH. Its native loader compares the runtime fingerprint against a list
 * of released Node and Electron builds, and it rejects an Electron main process.
 */
const DSH_NODE_MINIMUM: readonly [number, number] = [24, 9];

/** Whether a `node --version` reading meets the DSH minimum. */
export function isDshNodeVersion(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\./u.exec(version.trim());
  if (!match?.[1] || !match[2]) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > DSH_NODE_MINIMUM[0] || (major === DSH_NODE_MINIMUM[0] && minor >= DSH_NODE_MINIMUM[1]);
}

/**
 * Resolves the Node launcher for the bundled DSH. The application's own process is Electron, whose
 * runtime fingerprint DSH refuses, so the launcher is a Node installation. `OPENBOT_DEEPSEEK_NODE`
 * names one directly; else the Node the installer shipped (`resources/node`) comes before a Node
 * found on this computer.
 */
export const resolveDshCli = Effect.fn("Cli.resolveDshCli")(function* (
  input: {
    systemCandidates?: string[];
    bundledExecutable?: string | null | undefined;
    stateDirectory?: string | undefined;
  } = {},
): Effect.fn.Return<AgentCliInfo, ProviderClientOperationError> {
  const install = dshInstall(input.stateDirectory);
  const configured = process.env.OPENBOT_DEEPSEEK_NODE?.trim();
  const shipped = process.resourcesPath
    ? join(process.resourcesPath, "node", process.platform === "win32" ? "node.exe" : "node")
    : null;
  const systemCandidates = yield* collectNodeCandidates();
  const candidates =
    input.systemCandidates ?? (configured ? [configured] : [...systemCandidates, ...(shipped ? [shipped] : [])]);
  let outdated: string | null = null;
  for (const candidate of candidates) {
    if (!(yield* isExecutable(candidate))) continue;
    const attempt = yield* Effect.result(
      providerCall(() =>
        execFileAsync(candidate, ["--version"], { timeout: CLI_VERSION_TIMEOUT_MS, maxBuffer: 64 * 1024 }),
      ),
    );
    if (Result.isFailure(attempt)) continue;
    const version = attempt.success.stdout.trim();
    if (!isDshNodeVersion(version)) {
      outdated = version;
      continue;
    }
    const source = candidate === shipped ? ("managed" as const) : ("system" as const);
    return { executable: candidate, version: install.version, source };
  }
  return yield* Effect.fail(
    providerFailure(
      new CodexCliError(
        outdated
          ? sourceText("error.provider.piOutdated", { version: outdated })
          : sourceText("error.provider.nativeMissing", { provider: "Node 24.9" }),
        outdated ? "outdated" : "missing",
      ),
    ),
  );
});

/** Where a Node launcher may be, in order. The same search as a provider CLI, by another name. */
const collectNodeCandidates = Effect.fn("Cli.collectNodeCandidates")(function* () {
  const found: string[] = [];
  if (process.platform === "win32") {
    const output = yield* providerCall(() =>
      execFileAsync("where.exe", ["node"], { timeout: 5_000, maxBuffer: 64 * 1024 }),
    ).pipe(Effect.catch(() => Effect.succeed({ stdout: "" })));
    found.push(
      ...output.stdout
        .split(/\r?\n/u)
        .map((path) => path.trim())
        .filter((path) => isWindowsRunnable(path, process.env.PATHEXT)),
    );
    const programFiles = process.env.ProgramFiles?.trim();
    if (programFiles) found.push(win32.join(programFiles, "nodejs", "node.exe"));
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (localAppData) found.push(win32.join(localAppData, "Programs", "nodejs", "node.exe"));
  } else {
    for (const folder of yield* loginSearchPath()) {
      if (isAbsolute(folder)) found.push(join(folder, "node"));
    }
  }
  return [...new Set(found)];
});
/** An explicit path remains under the user's control, including during managed updates. */
export function configuredCliPath(provider: AgentProviderId): string | null {
  return process.env[`OPENBOT_${provider.toUpperCase()}_PATH`]?.trim() || null;
}

/** The extensions Windows runs when `PATHEXT` is unset, in the order the system itself uses. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/** Whether Windows can start a file by its extension, as `PATHEXT` lists them. */
export function isWindowsRunnable(path: string, pathext: string | undefined): boolean {
  const dot = path.lastIndexOf(".");
  // A dot inside a directory name is not an extension.
  if (dot <= Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"))) return false;
  const extension = path.slice(dot).toLowerCase();
  return (pathext?.trim() || DEFAULT_PATHEXT).split(";").some((entry) => entry.trim().toLowerCase() === extension);
}

/**
 * The shells that macOS runs as the login shell when `$SHELL` names one. Each accepts `-lic` (`sh`
 * gets `-lc`) and runs `printf %s "$PATH"` as POSIX shells do; fish joins a quoted `$PATH` with `:`
 * too. tcsh refuses `-lic`, so a tcsh user gets `/bin/zsh`.
 */
const MAC_LOGIN_SHELLS = new Set(["bash", "fish", "ksh", "sh", "zsh"]);

/**
 * The shell that reports the login `PATH`. It has to be a login shell, because that is what reads
 * the profile a version manager appends its `PATH` to, and a packaged app inherits none of it.
 *
 * Both platforms prefer the user's own `$SHELL`, because that is the profile their terminal reads:
 * a user who sets up nvm in `~/.bash_profile` has no Codex in zsh. macOS falls back to `/bin/zsh`,
 * the default login shell, which is always present, and uses `$SHELL` only for a known shell at an
 * absolute path. Linux cannot assume zsh is installed at all, so it falls back to `/bin/sh`. The
 * `-i` flag does not go with `sh`, because `sh` is not required to accept an interactive non-tty
 * invocation and dash exits rather than running the command.
 */
function loginShellCommand(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): { command: string; args: string[] } {
  const preferred = environment.SHELL?.trim();
  if (platform !== "linux") {
    if (!preferred || !isAbsolute(preferred) || !MAC_LOGIN_SHELLS.has(basename(preferred))) {
      return { command: "/bin/zsh", args: ["-lic"] };
    }
  } else if (!preferred) {
    return { command: "/bin/sh", args: ["-lc"] };
  }
  return { command: preferred, args: preferred.endsWith("/sh") ? ["-lc"] : ["-lic"] };
}

const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const LOGIN_SHELL_MAX_OUTPUT_BYTES = 64 * 1024;

/**
 * Runs one script in the user's login shell and returns what it printed.
 *
 * The shell starts in a session of its own, with no controlling terminal. An interactive bash that
 * finds the terminal held by another process group sends SIGTTIN to its own group, and without a
 * session of its own that group is OpenBot's. An OpenBot started from a terminal then stopped as soon
 * as two lookups overlapped, and only SIGKILL could end it (#766). With no terminal, the shell turns
 * job control off instead. `execFile` cannot do this: it does not pass `detached` on to `spawn`.
 *
 * A failed start, a non-zero exit, a signal, the timeout and too much output all reject, as
 * `execFile` did, so each caller keeps its fallback.
 */
export function runInLoginShell(
  script: string,
  shell = loginShellCommand(),
): Effect.Effect<string, ProviderClientOperationError> {
  return Effect.callback<string, ProviderClientOperationError>((resume) => {
    const resolve = (value: string) => resume(Effect.succeed(value));
    const reject = (cause: unknown) => resume(Effect.fail(providerFailure(cause)));
    let finished = false;
    const child = spawn(shell.command, [...shell.args, script], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | null = null;
    // The whole group, so that nothing the user's profile started outlives the lookup. The pipes are
    // closed too, as `execFile` did: a process outside the group can still hold them, and `close`
    // waits for every holder.
    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.stdout.destroy();
      child.stderr.destroy();
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        // The group has already exited.
      }
    };
    const timer = setTimeout(
      () => stop(new Error(`The login shell did not finish in ${LOGIN_SHELL_TIMEOUT_MS / 1000} seconds.`)),
      LOGIN_SHELL_TIMEOUT_MS,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > LOGIN_SHELL_MAX_OUTPUT_BYTES) stop(new Error("The login shell printed too much output."));
      else chunks.push(chunk);
    });
    // Drained and dropped: an interactive shell with no terminal reports that job control is off.
    child.stderr.resume();
    child.once("error", (error) => {
      finished = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      finished = true;
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`The login shell exited with ${signal ?? `code ${code}`}.`));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    return Effect.sync(() => {
      clearTimeout(timer);
      if (!finished) stop(new Error("Login shell interrupted."));
    });
  });
}

/** How long the login shell's `PATH` is kept. A tool the user installs is found after this. */
const LOGIN_PATH_TTL_MS = 60_000;

let loginPath: { value: Deferred.Deferred<readonly string[]>; readAt: number } | null = null;

/**
 * The login shell's `PATH`, then this process's. The script is fixed: no user text reaches the
 * shell. A packaged app starts with a short `PATH`, and a version manager adds its folders in the
 * profile that only a login shell reads. Provider CLIs and custom agents are looked up here, and
 * every caller in the next `LOGIN_PATH_TTL_MS` shares one shell.
 */
export const loginSearchPath = Effect.fn("Cli.loginSearchPath")(function* () {
  if (loginPath && Date.now() - loginPath.readAt < LOGIN_PATH_TTL_MS) return yield* Deferred.await(loginPath.value);
  const value = Deferred.makeUnsafe<readonly string[]>();
  loginPath = { value, readAt: Date.now() };
  const exit = yield* Effect.exit(
    runInLoginShell('printf %s "$PATH"').pipe(
      Effect.catch(() => Effect.succeed("")),
      // An interactive profile can print before the script runs, such as a greeting or `fastfetch`.
      Effect.map((stdout) => stdout.split(/\r?\n/u).pop()?.trim() ?? ""),
      Effect.map((shellPath) => [
        ...new Set([...shellPath.split(delimiter), ...(process.env.PATH ?? "").split(delimiter)].filter(Boolean)),
      ]),
    ),
  );
  yield* Deferred.done(value, exit);
  return yield* exit;
}, Effect.uninterruptible);

/** The `PATH` entry that each process of a resolved CLI starts with, to spread over its environment. */
export function cliPathEnvironment(cli: { readonly launchPath?: string }): Record<string, string> {
  return cli.launchPath ? { PATH: cli.launchPath } : {};
}

/**
 * One argument on a `cmd.exe /c` line that runs a batch wrapper. `cmd.exe` reads the line first: it
 * toggles quoting at every `"` and expands `%NAME%` inside quotes too. The wrapper then hands `%*` to
 * a program that splits it with the C runtime rules. So an argument with any character outside a
 * plain set is quoted, an inner `"` is written as `""` with the backslashes before it doubled, which
 * both parsers read as one literal quote, and `%` is written as `%%cd:~,%`, which expands to one `%`.
 */
function batchArgument(argument: string): string {
  if (/^[\w\-.,/:=@+\\]+$/.test(argument)) return argument;
  let quoted = '"';
  let backslashes = 0;
  for (const character of argument) {
    if (character === "\\") {
      backslashes += 1;
    } else {
      if (character === '"') quoted += `${"\\".repeat(backslashes)}"`;
      backslashes = 0;
    }
    quoted += character === "%" ? "%%cd:~,%" : character;
  }
  return `${quoted}${"\\".repeat(backslashes)}"`;
}

/**
 * How to start a resolved CLI. A `.cmd` or `.bat` wrapper is a script that only the Windows command
 * processor runs, so it is called through `cmd.exe` with verbatim quoting. Every other executable
 * starts with no shell. That keeps a path that holds a
 * space runnable: a managed CLI lives under `userData`, which holds a space for a user such as
 * `C:\Users\Jane Doe` and for the `Dengerbot Dev` profile, and `cmd.exe` would split it there.
 */
export function cliSpawnTarget(
  executable: string,
  argv: readonly string[],
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[]; windowsVerbatimArguments: boolean } {
  if (platform !== "win32" || ![".bat", ".cmd"].includes(extname(executable).toLowerCase())) {
    return { command: executable, args: [...argv], windowsVerbatimArguments: false };
  }

  const commandLine = [`"${executable.replaceAll("%", "%%")}"`, ...argv.map(batchArgument)].join(" ");
  return {
    command: process.env.ComSpec?.trim() || "cmd.exe",
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  };
}

/**
 * A busy computer can take many seconds to start a CLI, so the limit is generous. A timeout is
 * reported apart from a failure: the CLI is not broken, and reinstalling it does not help. The
 * provider runtime tries again later, so this limit only has to cover one slow answer.
 */
const CLI_VERSION_TIMEOUT_MS = 10_000;

/** `X_OK` also passes for a folder, and a login-shell `PATH` folder can hold one with the CLI's name. */
const isExecutable = Effect.fn("Cli.isExecutable")((path: string) =>
  providerCall(async () => {
    await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
    return (await stat(path)).isFile();
  }).pipe(Effect.match({ onSuccess: (file) => file, onFailure: () => false })),
);
