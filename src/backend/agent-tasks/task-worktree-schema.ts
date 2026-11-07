// Shared by migration v52 and the separate new-database schema. IF NOT EXISTS throughout, because
// this text is both the migration and the tail of the latest schema.
//
// `task_worktree`: the git worktree of each task that runs in its own checkout, one row per task. It
// is a companion table and not a column of `projection_agent_threads` on purpose: that table is
// replayed by the released-schema fixture of migration 47, and a column added later would change what
// that replay builds. There is no foreign key on purpose: the row outlives its thread, because the
// worktree it names is a folder of the user's own repository, and deleting a conversation must never
// delete a checkout or a branch.
export const TASK_WORKTREE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS task_worktree (
    thread_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`;
