// The `messaging_outbox` table: every post an agent sends on its own initiative, recorded before the
// platform sees it. The rows are written directly, not through `database.dispatch`, for the same
// reason the routine deliveries are: a row holds the answer text, and the event log is never deleted
// from.
//
// One post goes out only when no earlier unfinished post waits for the same connection, place and
// thread, so two answers of one conversation cannot swap order. There is no release after N waits:
// a blocked lane stays blocked until its oldest post settles, and a post that waits more than a day
// expires.

import {
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";

/** A post the outbox can send: its lane, the text, and how often it has waited already. */
export interface MessagingOutboxOutgoing {
  id: string;
  connectionId: string;
  place: string;
  thread: string | null;
  markdown: string;
  attempts: number;
}

/** Why a post ended as `failed` or `uncertain`, as the answers of the tool read it. */
export type MessagingOutboxDropReason = "refused" | "send-failed" | "gone" | "expired" | "restart";

/**
 * The retry cadence for a post that waits for its connection: 1, 2, 4 and 8 minutes, then every 15
 * minutes, as the routine deliveries use.
 */
export function outboxWaitDelay(attempts: number): number {
  const minutes = [1, 2, 4, 8][attempts - 1] ?? 15;
  return minutes * 60_000;
}

/** How long a post may wait before it expires. */
const OUTBOX_EXPIRE_MS = 24 * 60 * 60_000;

interface OutboxRow {
  id: string;
  connectionId: string;
  place: string;
  thread: string | null;
  markdown: string;
  attempts: number;
}

function outboxRow(value: DynamicRecordLike): OutboxRow | null {
  const id = optionalStringColumn(value, "id");
  if (id === null) return null;
  return {
    id,
    connectionId: requiredStringColumn(value, "connection_id"),
    place: requiredStringColumn(value, "place"),
    thread: optionalStringColumn(value, "thread"),
    markdown: requiredStringColumn(value, "markdown"),
    attempts: requiredNumberColumn(value, "attempts"),
  };
}

type DynamicRecordLike = Parameters<typeof requiredStringColumn>[0];

function outgoingRows(value: unknown): MessagingOutboxOutgoing[] {
  const rows: MessagingOutboxOutgoing[] = [];
  for (const record of databaseRows(value)) {
    const row = outboxRow(record);
    if (row) rows.push(row);
  }
  return rows;
}

export class MessagingOutboxStore {
  readonly #database: OpenBotDatabase;

  constructor(database: OpenBotDatabase) {
    this.#database = database;
  }

  /**
   * Records a post before it is sent, under its idempotency key. A key that is already recorded
   * changes nothing, so asking the same request twice never posts twice. Answers whether the row is
   * new.
   */
  record(input: {
    id: string;
    connectionId: string;
    place: string;
    thread: string | null;
    markdown: string;
    at: string;
  }): boolean {
    const result = this.#database.connection
      .prepare(
        `INSERT OR IGNORE INTO messaging_outbox (id, connection_id, place, thread, markdown, status, reason,
           attempts, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?, ?)`,
      )
      .run(input.id, input.connectionId, input.place, input.thread, input.markdown, input.at, input.at, input.at);
    return Number(result.changes) > 0;
  }

  /**
   * The posts that may go out now: pending, due, and the oldest unfinished post of their lane - a
   * later post never passes an earlier one that has not settled. The oldest post comes first.
   */
  due(now: string): MessagingOutboxOutgoing[] {
    return outgoingRows(
      this.#database.connection
        .prepare(
          `SELECT o.*, o.rowid AS outbox_rowid FROM messaging_outbox o
           WHERE o.status = 'pending' AND o.next_attempt_at <= ?
             AND NOT EXISTS (
               SELECT 1 FROM messaging_outbox b
               WHERE b.connection_id = o.connection_id AND b.place = o.place
                 AND ((b.thread IS NULL AND o.thread IS NULL) OR b.thread = o.thread)
                 AND b.rowid < o.rowid
                 AND b.status IN ('pending', 'sending')
             )
           ORDER BY o.rowid`,
        )
        .all(now),
    );
  }

  /**
   * The posts of one connection that may go out now, oldest first: the lane heads among its pending
   * posts, whatever their retry time says. A connection that has just come back sends its waiting
   * posts at once, without waiting for the timer.
   */
  dueForConnection(connectionId: string): MessagingOutboxOutgoing[] {
    return outgoingRows(
      this.#database.connection
        .prepare(
          `SELECT o.*, o.rowid AS outbox_rowid FROM messaging_outbox o
           WHERE o.connection_id = ? AND o.status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM messaging_outbox b
               WHERE b.connection_id = o.connection_id AND b.place = o.place
                 AND ((b.thread IS NULL AND o.thread IS NULL) OR b.thread = o.thread)
                 AND b.rowid < o.rowid
                 AND b.status IN ('pending', 'sending')
             )
           ORDER BY o.rowid`,
        )
        .all(connectionId),
    );
  }

  /** Whether the post is recorded, and what became of it if it ended. */
  statusOf(id: string): { recorded: boolean; status: string | null; reason: string | null } {
    const row = databaseRow(
      this.#database.connection.prepare(`SELECT status, reason FROM messaging_outbox WHERE id = ?`).get(id),
    );
    if (!row) return { recorded: false, status: null, reason: null };
    return { recorded: true, status: optionalStringColumn(row, "status"), reason: optionalStringColumn(row, "reason") };
  }

  /** The row to send, or null when it is gone. */
  rowOf(id: string): MessagingOutboxOutgoing | null {
    const record = databaseRow(
      this.#database.connection.prepare(`SELECT *, rowid AS outbox_rowid FROM messaging_outbox WHERE id = ?`).get(id),
    );
    return record ? outboxRow(record) : null;
  }

  /** Whether no earlier unfinished post waits in this row's lane: only a lane head may send. */
  isLaneHead(id: string): boolean {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT 1 AS head FROM messaging_outbox o
           WHERE o.id = ? AND NOT EXISTS (
             SELECT 1 FROM messaging_outbox b
             WHERE b.connection_id = o.connection_id AND b.place = o.place
               AND ((b.thread IS NULL AND o.thread IS NULL) OR b.thread = o.thread)
               AND b.rowid < o.rowid
               AND b.status IN ('pending', 'sending')
           )`,
        )
        .get(id),
    );
    return row !== null;
  }

  /** Marks the post as on its way. False when another send of it is running or it settled already. */
  claim(id: string, at: string): boolean {
    const result = this.#database.connection
      .prepare(`UPDATE messaging_outbox SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'pending'`)
      .run(at, id);
    return Number(result.changes) > 0;
  }

  markSent(id: string, at: string): void {
    this.#database.connection
      .prepare(
        `UPDATE messaging_outbox SET status = 'sent', reason = NULL, next_attempt_at = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .run(at, id);
  }

  /** Ends a post with a reason. Every reason ends the row; only a restart reads as `uncertain`. */
  end(id: string, status: "failed" | "uncertain", reason: MessagingOutboxDropReason, at: string): void {
    this.#database.connection
      .prepare(
        `UPDATE messaging_outbox SET status = ?, reason = ?, next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(status, reason, at, id);
  }

  /** Moves a waiting post past a transient failure, by the retry cadence. */
  retryAt(id: string, nextAttemptAt: string, at: string): void {
    this.#database.connection
      .prepare(
        `UPDATE messaging_outbox SET status = 'pending', attempts = attempts + 1, next_attempt_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('pending', 'sending')`,
      )
      .run(nextAttemptAt, at, id);
  }

  /** The earliest moment a pending post is due, or null when none waits: what the timer arms to. */
  nextDueAt(): string | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(`SELECT MIN(next_attempt_at) AS next FROM messaging_outbox WHERE status = 'pending'`)
        .get(),
    );
    return row ? optionalStringColumn(row, "next") : null;
  }

  /**
   * Called when the service starts, before any connection runs: a post that was `sending` when the
   * process ended may be half-posted, so it ends `uncertain` and nothing sends it again.
   */
  interruptSending(at: string): void {
    this.#database.connection
      .prepare(
        `UPDATE messaging_outbox SET status = 'uncertain', reason = 'restart', next_attempt_at = NULL, updated_at = ?
         WHERE status = 'sending'`,
      )
      .run(at);
  }

  /** Ends the unfinished posts of one connection as `gone`: it was deleted or closed. */
  dropConnection(connectionId: string, at: string): void {
    this.#database.connection
      .prepare(
        `UPDATE messaging_outbox SET status = 'failed', reason = 'gone', next_attempt_at = NULL, updated_at = ?
         WHERE connection_id = ? AND status IN ('pending', 'sending')`,
      )
      .run(at, connectionId);
  }

  /** Ends posts that waited more than a day as `expired`, so a lane cannot block for ever. */
  expireStale(now: string): void {
    const boundary = new Date(Date.parse(now) - OUTBOX_EXPIRE_MS).toISOString();
    this.#database.connection
      .prepare(
        `UPDATE messaging_outbox SET status = 'failed', reason = 'expired', next_attempt_at = NULL, updated_at = ?
         WHERE status = 'pending' AND created_at < ?`,
      )
      .run(now, boundary);
  }

  /** The newest rows, for a diagnostics view. Nothing exposes them yet. */
  recent(limit: number): Array<MessagingOutboxOutgoing & { status: string; reason: string | null; createdAt: string }> {
    const rows: Array<MessagingOutboxOutgoing & { status: string; reason: string | null; createdAt: string }> = [];
    for (const record of databaseRows(
      this.#database.connection
        .prepare(`SELECT *, rowid AS outbox_rowid FROM messaging_outbox ORDER BY rowid DESC
        LIMIT ?`)
        .all(limit),
    )) {
      const row = outboxRow(record);
      if (!row) throw new Error("Invalid outbox row.");
      rows.push({
        ...row,
        status: requiredStringColumn(record, "status"),
        reason: optionalStringColumn(record, "reason"),
        createdAt: requiredStringColumn(record, "created_at"),
      });
    }
    return rows;
  }
}
