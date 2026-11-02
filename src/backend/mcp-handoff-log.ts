import type { McpServerConfig } from "@openbot/contracts/ipc";
import { mcpSecretValues } from "./mcp-redaction";

/**
 * What this app has already handed to a provider process: the MCP server names, and the secret
 * values behind them.
 *
 * A provider keeps the configuration it was given until its process stops. The user can edit a
 * credential, or disable a server, while that process still runs - `applyPendingRuntimeRefresh`
 * waits for the active turn on purpose - and the store then no longer names the value the process
 * holds. A reader that redacts against the configuration as it stands now would let that value
 * through, in the one line most likely to quote it: the CLI's own report of the failed connection.
 *
 * So the record only grows, for the life of the app. It is a few strings, and the cost of keeping a
 * value too long is a masked word in a log line, while the cost of dropping one too early is a
 * credential in a log file and in a renderer error event.
 */
export class McpHandoffLog {
  readonly #names = new Set<string>();
  readonly #values = new Set<string>();
  // Moves whenever the recorded values change, so a reader that derived text from the old set —
  // such as the message search index — can tell that its redaction went stale.
  #revision = 0;

  /** How many times the recorded names or values changed in this process. */
  get revision(): number {
    return this.#revision;
  }

  /** Remembers one hand-off and answers with the same list, so a caller can wrap a source with it. */
  record(configs: readonly McpServerConfig[]): McpServerConfig[] {
    const values = mcpSecretValues(configs);
    this.#revision += 1;
    for (const config of configs) this.#names.add(config.name);
    for (const value of values) this.#values.add(value);
    return [...configs];
  }

  /**
   * Remembers one secret that is not on a row: the bearer token OpenBot mints for a signed-in http
   * server. It reaches a provider process in a header and is never stored, so `mcpSecretValues`
   * cannot find it, and a CLI quoting the request it failed on would otherwise print it in full.
   */
  recordSecret(value: string): void {
    if (value.length >= 4) {
      this.#values.add(value);
      this.#revision += 1;
    }
  }

  names(): string[] {
    return [...this.#names];
  }

  values(): string[] {
    return [...this.#values];
  }
}
