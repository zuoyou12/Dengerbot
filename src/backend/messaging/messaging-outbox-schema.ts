// Shared by migration v51 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `messaging_outbox` holds every post that an agent sends on its own initiative - the `messaging_post`
// tool, a routine's answer, a workflow's output - from the moment it is asked for, so a post is never
// lost to a restart, a busy connection or a platform hiccup. One row per idempotency key: the tool
// call's key, the routine run's id, `workflow-step:<id>`, so asking the same request twice records it
// once. The row keeps its own copies of the place and thread, and no foreign keys: deleting a
// connection is never blocked by an unsent post.
//
// `status`:
// - `pending` waits for its turn. A post goes out only when no earlier unfinished post waits for the
//   same connection, place and thread, so two answers of one conversation cannot swap order.
// - `sending` is set before the post starts. A restart finds it `uncertain`: a long text goes in more
//   than one post, so a part of it can be posted already.
// - `sent` ends the row.
// - `failed` ends the row with a `reason`: `refused` (the connection takes no such post), `send-failed`
//   (the platform rejected it), `gone` (the connection is deleted or closed), `expired` (it waited
//   more than a day).
// - `uncertain` ends the row with reason `restart`: what was sent is not known, so nothing is sent again.
export const MESSAGING_OUTBOX_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS messaging_outbox (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL,
    place TEXT NOT NULL,
    thread TEXT,
    markdown TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'sending', 'sent', 'failed', 'uncertain')),
    reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS messaging_outbox_status
    ON messaging_outbox(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS messaging_outbox_lane
    ON messaging_outbox(connection_id, place, thread);
`;
