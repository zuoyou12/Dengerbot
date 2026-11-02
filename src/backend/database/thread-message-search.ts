import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { databaseRow, databaseRows, requiredStringColumn } from "./database-rows";

/**
 * The trigram search index over stored message text, and the dirty queue that keeps it current.
 *
 * The index holds redacted text, so a match can never depend on a secret the user saved after the
 * message was stored: the hit and miss of a search follow the same redaction the read path applies.
 * Redaction is not a function of the row alone — the masked values come from the process registry
 * and the MCP configuration — so each sync compares the redaction token (registry revision plus a
 * fingerprint of the configurations) and marks every row for re-redaction when it moved.
 *
 * Triggers append to the dirty queue on every write to `projection_thread_messages`, including the
 * replay and compaction paths, because every write to that table runs inside one of the writer
 * entry points. `syncThreadMessageSearch` drains the queue: it reads the raw row, redacts it with
 * the current values, and rewrites the index row. A drain that stops early leaves the queue as it
 * was and the next sync finishes the work.
 */
export const THREAD_MESSAGE_SEARCH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS thread_message_search_state (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    redaction_token TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS thread_message_search_doc (
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (thread_id, message_id)
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS thread_message_search USING fts5(
    text,
    tokenize = 'trigram remove_diacritics 0'
  );
  CREATE TABLE IF NOT EXISTS thread_message_search_dirty (
    thread_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    PRIMARY KEY (thread_id, message_id)
  );
  CREATE TRIGGER IF NOT EXISTS thread_message_search_dirty_insert AFTER INSERT ON projection_thread_messages BEGIN
    INSERT INTO thread_message_search_dirty(thread_id, message_id)
    SELECT new.thread_id, new.message_id
    WHERE NOT EXISTS (SELECT 1 FROM thread_message_search_dirty WHERE thread_id = new.thread_id AND message_id = new.message_id);
  END;
  CREATE TRIGGER IF NOT EXISTS thread_message_search_dirty_update AFTER UPDATE OF message_json ON projection_thread_messages BEGIN
    INSERT INTO thread_message_search_dirty(thread_id, message_id)
    SELECT new.thread_id, new.message_id
    WHERE NOT EXISTS (SELECT 1 FROM thread_message_search_dirty WHERE thread_id = new.thread_id AND message_id = new.message_id);
  END;
  CREATE TRIGGER IF NOT EXISTS thread_message_search_dirty_delete AFTER DELETE ON projection_thread_messages BEGIN
    INSERT INTO thread_message_search_dirty(thread_id, message_id)
    SELECT old.thread_id, old.message_id
    WHERE NOT EXISTS (SELECT 1 FROM thread_message_search_dirty WHERE thread_id = old.thread_id AND message_id = old.message_id);
  END;
`;

/** How redaction behaves for one sync or search: the same object the read path uses. */
export interface ThreadMessageSearchRedaction {
  /** Masks every value the current secrets contribute, on top of the fixed rules. */
  redact(agentId: string, text: string): string;
  /**
   * Answers a token that changes whenever `redact` could mask different text for the same row:
   * the registry revision, the MCP configuration fingerprint, or both.
   */
  token(): string;
}

/** Marks every stored message for re-redaction. Call within the caller's transaction. */
export function markAllThreadMessagesDirty(db: DatabaseSync): void {
  db.exec(
    `INSERT OR IGNORE INTO thread_message_search_dirty(thread_id, message_id)
     SELECT thread_id, message_id FROM projection_thread_messages`,
  );
}

function storedToken(db: DatabaseSync): string | null {
  const row = databaseRow(db.prepare("SELECT redaction_token FROM thread_message_search_state WHERE id = 1").get());
  return row ? requiredStringColumn(row, "redaction_token") : null;
}

/** A fingerprint of every configuration value the MCP redaction masks. */
export function mcpSecretsFingerprint(db: DatabaseSync): string {
  const rows = databaseRows(
    db
      .prepare(
        `SELECT mcp_server_id, enabled, command, args_json, env_json, env_passthrough_json, working_directory, url, headers_json
       FROM projection_mcp_servers ORDER BY mcp_server_id`,
      )
      .all(),
  );
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function redactedText(agentId: string, messageJson: string, redaction: ThreadMessageSearchRedaction): string | null {
  let message: unknown;
  try {
    message = JSON.parse(messageJson);
  } catch {
    return null;
  }
  if (typeof message !== "object" || message === null) return null;
  const text = (message as { text?: unknown }).text;
  if (typeof text !== "string" || !text.trim()) return null;
  const redacted = redaction.redact(agentId, text);
  return redacted.trim() ? redacted : null;
}

function reindexRows(db: DatabaseSync, redaction: ThreadMessageSearchRedaction, batchLimit: number): number {
  const rows = databaseRows(
    db.prepare("SELECT thread_id, message_id FROM thread_message_search_dirty LIMIT ?").all(batchLimit),
  );
  if (rows.length === 0) return 0;
  const select = db.prepare(
    `SELECT m.message_json, t.agent_id FROM projection_thread_messages m
     JOIN projection_threads t ON t.thread_id = m.thread_id
     WHERE m.thread_id = ? AND m.message_id = ?`,
  );
  const docRow = db.prepare("SELECT rowid FROM thread_message_search_doc WHERE thread_id = ? AND message_id = ?");
  const dropFtsRow = db.prepare(
    "DELETE FROM thread_message_search WHERE rowid IN (SELECT rowid FROM thread_message_search_doc WHERE thread_id = ? AND message_id = ?)",
  );
  for (const dirty of rows) {
    const threadId = requiredStringColumn(dirty, "thread_id");
    const messageId = requiredStringColumn(dirty, "message_id");
    // The doc row is kept when the row survives: its rowid keys the FTS row, so a re-redaction
    // rewrites the FTS row in place instead of moving the message to a new rowid.
    const existing = databaseRow(docRow.get(threadId, messageId));
    const rowid = existing ? Number(existing.rowid) : null;
    dropFtsRow.run(threadId, messageId);
    const stored = databaseRow(select.get(threadId, messageId));
    const text =
      stored === null
        ? null
        : redactedText(
            requiredStringColumn(stored, "agent_id"),
            requiredStringColumn(stored, "message_json"),
            redaction,
          );
    if (text === null) {
      db.prepare("DELETE FROM thread_message_search_doc WHERE thread_id = ? AND message_id = ?").run(
        threadId,
        messageId,
      );
      continue;
    }
    const key =
      rowid ??
      Number(
        db
          .prepare("INSERT INTO thread_message_search_doc(thread_id, message_id) VALUES (?, ?)")
          .run(threadId, messageId).lastInsertRowid,
      );
    db.prepare("INSERT INTO thread_message_search(rowid, text) VALUES (?, ?)").run(key, text);
  }
  for (const dirty of rows) {
    db.prepare("DELETE FROM thread_message_search_dirty WHERE thread_id = ? AND message_id = ?").run(
      requiredStringColumn(dirty, "thread_id"),
      requiredStringColumn(dirty, "message_id"),
    );
  }
  return rows.length;
}

/**
 * Brings the index in line with the stored rows and the current redaction, up to `maxRows` rows of
 * re-redaction. Answers `false` when rows are still queued: the caller must not answer from the
 * index yet, because a match would depend on rows the sync has not re-redacted. A search drains a
 * bounded batch per call, so a large rebuild costs the main process a bounded span per search.
 */
export function syncThreadMessageSearch(
  db: DatabaseSync,
  redaction: ThreadMessageSearchRedaction,
  options: { batchSize?: number } = {},
): boolean {
  const token = redaction.token();
  if (storedToken(db) !== token) {
    markAllThreadMessagesDirty(db);
    db.prepare(
      `INSERT INTO thread_message_search_state(id, redaction_token) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET redaction_token = excluded.redaction_token`,
    ).run(token);
  }
  const maxRows = options.batchSize ?? 2_000;
  let drained = 0;
  while (drained < maxRows) {
    const count = reindexRows(db, redaction, maxRows - drained);
    if (count === 0) break;
    drained += count;
  }
  const remaining = databaseRow(
    db.prepare("SELECT EXISTS(SELECT 1 FROM thread_message_search_dirty) AS remaining").get(),
  );
  return remaining !== null && Number(remaining.remaining) === 0;
}
