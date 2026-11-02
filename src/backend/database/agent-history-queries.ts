import { CONTEXT_RESET_ITEM_TYPE } from "@openbot/contracts/ipc";
import { ORDER_KEY_COLUMNS, ORDER_KEY_DESC, ORDERED_THREAD_MESSAGES } from "./conversation-queries";
import type { DatabaseCore } from "./database-core";
import {
  databaseRow,
  databaseRows,
  decodeConversationMessageJson,
  optionalStringColumn,
  requiredStringColumn,
} from "./database-rows";
import { syncThreadMessageSearch, type ThreadMessageSearchRedaction } from "./thread-message-search";

export interface AgentHistorySelection {
  before?: string;
  messageId?: string;
  author?: string;
  limit: number;
}

/** The FTS phrase for a query: quoted, so match operators in the text stay literal. */
export function threadSearchMatchQuery(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

/** Model history reads use a thread and reset boundary; UI history remains unchanged. */
export class AgentHistoryQueries {
  readonly #core: DatabaseCore;
  readonly #redaction: () => ThreadMessageSearchRedaction;
  constructor(core: DatabaseCore, redaction: () => ThreadMessageSearchRedaction) {
    this.#core = core;
    this.#redaction = redaction;
  }

  /** The reset boundary and the readable rows above it, shared by the page read and the search. */
  #historyCte(threadId: string): { cte: string; bindings: string[] } {
    const cte = `${ORDERED_THREAD_MESSAGES}, visible AS (
      SELECT ordered.*, message.message_json FROM ordered
      JOIN projection_thread_messages message ON message.thread_id = ? AND message.message_id = ordered.message_id
    ), boundary AS (
      SELECT * FROM visible WHERE item_type = ? AND author = 'system'
      AND json_extract(message_json, '$.source') = 'system' AND json_extract(message_json, '$.status') = 'completed'
      ORDER BY ${ORDER_KEY_DESC} LIMIT 1
    ), allowed AS (
      SELECT * FROM visible WHERE NOT EXISTS (SELECT 1 FROM boundary)
      OR (${ORDER_KEY_COLUMNS}) > (SELECT ${ORDER_KEY_COLUMNS} FROM boundary)
    )`;
    return { cte, bindings: [threadId, threadId, CONTEXT_RESET_ITEM_TYPE] as const };
  }

  #resetMessageId(cte: string, bindings: readonly string[]): string | null {
    const reset = databaseRow(this.#core.connection.prepare(`${cte} SELECT message_id FROM boundary`).get(...bindings));
    return reset ? requiredStringColumn(reset, "message_id") : null;
  }

  read(agentId: string, threadId: string, selection: AgentHistorySelection) {
    const owner = this.#core.connection
      .prepare("SELECT thread_id FROM projection_threads WHERE thread_id = ? AND agent_id = ?")
      .get(threadId, agentId);
    if (!owner) throw new Error("History is unavailable in this conversation.");
    const { cte, bindings } = this.#historyCte(threadId);
    const resetMessageId = this.#resetMessageId(cte, bindings);
    const anchorId = selection.messageId ?? selection.before;
    if (
      anchorId &&
      !this.#core.connection
        .prepare(`${cte} SELECT message_id FROM allowed WHERE message_id = ?`)
        .get(...bindings, anchorId)
    ) {
      throw new Error("History reference is unavailable. Read recent history again.");
    }
    const rows = databaseRows(
      this.#core.connection
        .prepare(`${cte}
      SELECT message_json,
        (SELECT provider_session_id FROM projection_turns WHERE thread_id = ? AND turn_id = json_extract(allowed.message_json, '$.turnId')) AS provider_session_id
      FROM allowed WHERE author IN ('user', 'assistant', 'agent')
        AND COALESCE(item_type, '') != 'commentary'
        AND COALESCE(json_extract(message_json, '$.delivery.status'), 'completed') IN ('completed', 'failed', 'interrupted')
        AND (? IS NULL OR author = ?)
        AND (? IS NULL OR message_id = ?)
        AND (? IS NULL OR (${ORDER_KEY_COLUMNS}) < (SELECT ${ORDER_KEY_COLUMNS} FROM allowed WHERE message_id = ?))
      ORDER BY ${ORDER_KEY_DESC} LIMIT ?`)
        .all(
          ...bindings,
          threadId,
          selection.author ?? null,
          selection.author ?? null,
          selection.messageId ?? null,
          selection.messageId ?? null,
          selection.before ?? null,
          selection.before ?? null,
          selection.limit,
        ),
    );
    return {
      resetMessageId,
      messages: rows.map((row) => ({
        message: decodeConversationMessageJson(requiredStringColumn(row, "message_json")),
        providerSessionId: optionalStringColumn(row, "provider_session_id"),
      })),
    };
  }

  /**
   * The messages of one thread whose redacted text contains the query, newest first. The index
   * holds the text after the same redaction the reader applies, brought current by the sync, so a
   * hit and a miss match what a redacting scan would decide. Rows keep the same shape as `read`.
   */
  search(
    agentId: string,
    threadId: string,
    query: string,
    selection: { before?: string; limit: number },
  ): { resetMessageId: string | null; messages: ReturnType<AgentHistoryQueries["read"]>["messages"] } {
    const owner = this.#core.connection
      .prepare("SELECT thread_id FROM projection_threads WHERE thread_id = ? AND agent_id = ?")
      .get(threadId, agentId);
    if (!owner) throw new Error("History is unavailable in this conversation.");
    // The search answers from the index only when the sync drained fully; a big rebuild continues
    // across searches, and until then the caller falls back to the redacting scan.
    if (!syncThreadMessageSearch(this.#core.connection, this.#redaction())) {
      throw new Error("The message search index is still catching up.");
    }
    const { cte, bindings } = this.#historyCte(threadId);
    const rows = databaseRows(
      this.#core.connection
        .prepare(`${cte}
      SELECT message_json,
        (SELECT provider_session_id FROM projection_turns WHERE thread_id = ? AND turn_id = json_extract(allowed.message_json, '$.turnId')) AS provider_session_id
      FROM allowed
      JOIN (SELECT rowid AS search_rowid, message_id AS search_message FROM thread_message_search_doc WHERE thread_id = ?) doc
        ON doc.search_message = allowed.message_id
      JOIN thread_message_search ON thread_message_search.rowid = doc.search_rowid AND thread_message_search MATCH ?
      WHERE author IN ('user', 'assistant', 'agent')
        AND COALESCE(item_type, '') != 'commentary'
        AND COALESCE(json_extract(message_json, '$.delivery.status'), 'completed') IN ('completed', 'failed', 'interrupted')
        AND (? IS NULL OR (${ORDER_KEY_COLUMNS}) < (SELECT ${ORDER_KEY_COLUMNS} FROM allowed WHERE message_id = ?))
      ORDER BY ${ORDER_KEY_DESC} LIMIT ?`)
        .all(
          ...bindings,
          threadId,
          threadId,
          threadSearchMatchQuery(query),
          selection.before ?? null,
          selection.before ?? null,
          selection.limit,
        ),
    );
    return {
      resetMessageId: this.#resetMessageId(cte, bindings),
      messages: rows.map((row) => ({
        message: decodeConversationMessageJson(requiredStringColumn(row, "message_json")),
        providerSessionId: optionalStringColumn(row, "provider_session_id"),
      })),
    };
  }
}
