// The DeepSeek account sign-in: a `dsh --profile web` process whose page runs the OAuth flow.
//
// The OAuth callback is registered on DSH's own web server, and an ACP profile mounts no HTTP
// service, so the sign-in must open the web profile of the same `DSH_HOME` the providers use — a
// fresh home would sign into an installation that owns no account. `--patch` is not a legal dsh
// option (`unknown option '--patch'`), so the account bridge reaches the web profile through the
// patch file that `provider-drivers` appends, not through the command line.
//
// Everything the process prints is discarded: the sign-in URL carries tokens, and no log anywhere
// may keep them. Completion is read from the bridge handoff file, which the account bridge rewrites
// when the account changes; this service polls it and closes the window once it reports signed in.

import { type ChildProcess, spawn } from "node:child_process";
import type { DshAccountSignInPhase } from "@openbot/contracts/dsh-account";

export interface DshSignInServiceOptions {
  /**
   * The command to run: the real Node launcher (DSH refuses the Electron runtime) and the dsh entry
   * file. Null when no DSH installation is usable, which makes the sign-in fail visibly.
   */
  dshSpawn: () => { executable: string; entry: string } | null;
  /** The `DSH_HOME` the provider sessions already use. */
  dshHome: string | null;
  /** Reads the bridge handoff; the window closes once it reports a signed-in account. */
  isSignedIn: () => boolean;
  /** Called on every phase change, so the renderer row can refresh without polling races. */
  onPhaseChange?: (phase: DshAccountSignInPhase) => void;
  log?: (message: string) => void;
}

const SIGN_IN_POLL_MS = 2_000;

export class DshSignInService {
  readonly #options: DshSignInServiceOptions;
  #child: ChildProcess | null = null;
  #pollTimer: NodeJS.Timeout | null = null;
  #phase: DshAccountSignInPhase = "idle";

  constructor(options: DshSignInServiceOptions) {
    this.#options = options;
  }

  get phase(): DshAccountSignInPhase {
    return this.#phase;
  }

  startSignIn(): void {
    if (this.#child) return;
    const command = this.#options.dshSpawn();
    if (!command || !this.#options.dshHome) {
      this.#setPhase("failed");
      this.#options.log?.("The DeepSeek sign-in could not start: no usable DSH installation.");
      return;
    }
    this.#setPhase("signing-in");
    // stdio "ignore" is the whole point: the sign-in URL carries tokens and never enters a log.
    const child = spawn(command.executable, [command.entry, "--profile", "web"], {
      env: { ...process.env, DSH_HOME: this.#options.dshHome },
      stdio: "ignore",
      windowsHide: true,
    });
    this.#child = child;
    child.once("exit", () => {
      if (this.#child !== child) return;
      this.#child = null;
      this.#stopPolling();
      if (this.#phase === "signing-in") this.#setPhase("failed");
    });
    this.#pollTimer = setInterval(() => {
      if (this.#options.isSignedIn()) {
        this.#setPhase("signed-in");
        this.#close();
      }
    }, SIGN_IN_POLL_MS);
    this.#options.log?.("Opened the DeepSeek account sign-in window.");
  }

  cancelSignIn(): void {
    if (!this.#child && this.#phase === "idle") return;
    this.#close();
    this.#setPhase("idle");
  }

  stop(): void {
    this.#close();
    this.#setPhase("idle");
  }

  #close(): void {
    this.#stopPolling();
    const child = this.#child;
    this.#child = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    // A window the user never finished is a child process, not a service: killing it is safe, and
    // its "exit" handler must not flip the phase afterwards.
    child.removeAllListeners("exit");
    child.kill();
  }

  #stopPolling(): void {
    if (!this.#pollTimer) return;
    clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  #setPhase(phase: DshAccountSignInPhase): void {
    if (this.#phase === phase) return;
    this.#phase = phase;
    this.#options.onPhaseChange?.(phase);
  }
}
