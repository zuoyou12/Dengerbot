import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { type PluginJsonObject, pluginRecord } from "./subscription-json";

/** The private Magpie-compatible host transport. No token or plugin log crosses this boundary. */
export interface SubscriptionFetchInput {
  provider: string;
  account?: string;
  model: string;
  npm: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  session?: string;
  proxy?: string;
  signal?: AbortSignal;
}

interface PendingCall {
  finish: (result: unknown, error?: Error) => void;
  frame?: (message: PluginJsonObject) => void;
}
export interface SubscriptionAuthEvent {
  provider: string;
  account: string;
  said: string;
}

export class SubscriptionHost {
  readonly #process: ChildProcessWithoutNullStreams;
  readonly #calls = new Map<number, PendingCall>();
  #id = 0;
  #closed = false;
  #stopping: Promise<void> | null = null;

  get running(): boolean {
    return !this.#closed;
  }

  constructor(
    executable: string,
    script: string,
    cwd: string,
    onAuth: (event: SubscriptionAuthEvent) => void,
    environment?: NodeJS.ProcessEnv,
  ) {
    this.#process = spawn(executable, [script], {
      cwd,
      windowsHide: true,
      stdio: "pipe",
      env: { ...process.env, ...environment },
    });
    // Plugin stdout is a bounded line protocol. Discard stderr, which can contain vendor secrets.
    this.#process.stderr.on("data", () => {});
    let bytes = 0;
    this.#process.stdout.on("data", (chunk: Buffer) => {
      const last = chunk.lastIndexOf(10);
      bytes = last < 0 ? bytes + chunk.length : chunk.length - last - 1;
      if (bytes > 32 * 1024 * 1024) void this.stop();
    });
    createInterface({ input: this.#process.stdout, crlfDelay: Number.POSITIVE_INFINITY }).on("line", (line) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        void this.stop();
        return;
      }
      if (!isDynamicRecord(value)) return;
      if (value.event === "auth" || value.event === "signIn") {
        onAuth({
          provider: typeof value.provider === "string" ? value.provider : "",
          account: typeof value.account === "string" ? value.account : "",
          said: typeof value.said === "string" ? value.said : "",
        });
        return;
      }
      if (typeof value.id !== "number") return;
      const call = this.#calls.get(value.id);
      if (!call) return;
      if (value.event) {
        call.frame?.(pluginRecord(value));
        return;
      }
      const error = value.error ? new Error(sourceText("error.app.subscription.operationFailed")) : undefined;
      call.finish(value.result, error);
    });
    this.#process.on("error", () => this.#fail());
    this.#process.on("exit", () => this.#fail());
    this.#process.stdin.on("error", () => this.#fail());
  }

  #write(value: unknown): void {
    if (this.#closed) throw new Error(sourceText("error.app.subscription.stopped"));
    this.#process.stdin.write(`${JSON.stringify(value)}\n`);
  }

  #fail(): void {
    this.#closed = true;
    for (const call of [...this.#calls.values()])
      call.finish(null, new Error(sourceText("error.app.subscription.stopped")));
    this.#calls.clear();
  }

  call(method: string, params: unknown = {}, timeoutMs = 120_000, signal?: AbortSignal): Promise<unknown> {
    if (this.#closed || signal?.aborted)
      return Promise.reject(new Error(sourceText("error.app.subscription.cancelled")));
    if (this.#calls.size >= 64) return Promise.reject(new Error(sourceText("error.app.subscription.tooManyRequests")));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => abort(), timeoutMs);
      const finish = (value: unknown, error?: Error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.#calls.delete(id);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = () => {
        try {
          this.#write({ method: "abort", params: { id } });
        } catch {}
        finish(null, new Error(sourceText("error.app.subscription.operationTimedOut")));
      };
      this.#calls.set(id, { finish });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        this.#write({ id, method, params });
      } catch {
        finish(null, new Error(sourceText("error.app.subscription.unavailable")));
      }
    });
  }

  fetch(input: SubscriptionFetchInput): Promise<Response> {
    if (this.#closed || input.signal?.aborted)
      return Promise.reject(new Error(sourceText("error.app.subscription.requestCancelled")));
    if (this.#calls.size >= 32) return Promise.reject(new Error(sourceText("error.app.subscription.tooManyRequests")));
    const id = ++this.#id;
    return new Promise((resolve, reject) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
      let headed = false;
      let ended = false;
      let waiting = false;
      let closed = false;
      const queue: Buffer[] = [];
      const timer = setTimeout(() => abort(), 10 * 60_000);
      const clean = () => {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", abort);
        this.#calls.delete(id);
      };
      const consume = () => {
        waiting = false;
        const chunk = queue.shift();
        if (chunk) {
          controller?.enqueue(chunk);
          try {
            this.#write({ method: "credit", params: { id, n: chunk.length + 2048 } });
          } catch {}
        }
        if (!chunk && !ended) waiting = true;
        if (ended && queue.length === 0 && !closed) {
          closed = true;
          controller?.close();
          clean();
        }
      };
      const fail = (error: Error) => {
        if (closed) return;
        closed = true;
        ended = true;
        queue.length = 0;
        if (headed) controller?.error(error);
        else reject(error);
        clean();
      };
      const abort = () => {
        try {
          this.#write({ method: "abort", params: { id } });
        } catch {}
        fail(new Error(sourceText("error.app.subscription.requestTimedOut")));
      };
      this.#calls.set(id, {
        finish: (_value, error) => {
          if (error) {
            fail(error);
            return;
          }
          if (!headed) {
            fail(new Error(sourceText("error.app.subscription.noResponse")));
            return;
          }
          ended = true;
          if (queue.length === 0 && !closed) {
            closed = true;
            controller?.close();
            clean();
          }
        },
        frame: (message) => {
          if (message.event === "head") {
            if (headed || typeof message.status !== "number") {
              abort();
              return;
            }
            headed = true;
            const headers = new Headers();
            if (isDynamicRecord(message.headers))
              for (const [key, value] of Object.entries(message.headers)) {
                if (
                  typeof value === "string" &&
                  !["content-length", "content-encoding", "transfer-encoding"].includes(key.toLowerCase())
                )
                  headers.set(key, value);
              }
            const stream = new ReadableStream<Uint8Array>(
              {
                start(c) {
                  controller = c;
                },
                pull: consume,
                cancel: abort,
              },
              { highWaterMark: 0 },
            );
            try {
              resolve(new Response(stream, { status: message.status, headers }));
            } catch {
              headed = false;
              abort();
            }
          } else if (message.event === "chunk" && typeof message.data === "string" && headed) {
            const chunk = Buffer.from(message.data, "base64");
            if (
              chunk.length > 64 * 1024 ||
              queue.reduce((total, entry) => total + entry.length + 2048, 0) + chunk.length + 2048 > 512 * 1024
            ) {
              abort();
              return;
            }
            queue.push(chunk);
            // A pending reader has requested a chunk; enqueue only one at a time.
            if (waiting) consume();
          }
        },
      });
      input.signal?.addEventListener("abort", abort, { once: true });
      const { body, signal: _signal, ...params } = input;
      try {
        this.#write({
          id,
          method: "fetch",
          params: { ...params, body: body ? Buffer.from(body).toString("base64") : undefined, window: 512 * 1024 },
        });
      } catch {
        abort();
      }
    });
  }

  stop(): Promise<void> {
    if (this.#stopping) return this.#stopping;
    this.#stopping = new Promise<void>((resolve) => {
      if (this.#process.exitCode !== null || this.#process.signalCode !== null || !this.#process.pid) {
        resolve();
        return;
      }
      this.#process.once("close", () => resolve());
      this.#process.once("error", () => resolve());
      this.#process.kill();
    });
    this.#fail();
    return this.#stopping;
  }
}
