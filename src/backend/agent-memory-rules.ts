import { appendFileSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { databaseRows, requiredStringColumn } from "./database/database-rows";

/**
 * The rules beside a saved agent memory: when it stops loading, and which facts no tidy may move.
 *
 * `agent_memory_rules` is a companion table, not a change to a released one: it references
 * `projection_agent_memories(memory_id)` and follows its rows through `ON DELETE CASCADE`, so a
 * forget, a clear, or an agent deletion removes the rule with the memory. An expired memory stays
 * stored and searchable; it only stops entering the prompt the day after its `until` date, which is
 * how the entry grammar promised to the model behaves.
 */
export const AGENT_MEMORY_RULES_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS agent_memory_rules (
    memory_id TEXT PRIMARY KEY REFERENCES projection_agent_memories(memory_id) ON DELETE CASCADE,
    expires_at TEXT
  );
`;

/** The ids whose expiry date has passed. `today` is a `YYYY-MM-DD` date, the stored form. */
export function expiredMemoryIds(db: DatabaseSync, today = new Date().toISOString().slice(0, 10)): Set<string> {
  return new Set(
    databaseRows(
      db.prepare("SELECT memory_id FROM agent_memory_rules WHERE expires_at IS NOT NULL AND expires_at < ?").all(today),
    ).map((row) => requiredStringColumn(row, "memory_id")),
  );
}

/** Whether a `YYYY-MM-DD` string names a real calendar day, checked in UTC. */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Sets or clears one memory's expiry. Call within the caller's transaction. */
export function writeMemoryExpiry(db: DatabaseSync, memoryId: string, expiresAt: string | null): void {
  db.prepare(
    `INSERT INTO agent_memory_rules(memory_id, expires_at) VALUES (?, ?)
     ON CONFLICT(memory_id) DO UPDATE SET expires_at = excluded.expires_at`,
  ).run(memoryId, expiresAt);
}

/**
 * A safety or health fact always loads: neither a budget downgrade nor a background tidy may move one
 * out of the prompt. The words are a narrow, English-shaped set, because a memory text is the user's
 * own phrasing and a false "core" is cheaper than a forgotten allergy: the entry simply stays.
 */
const CORE_MEMORY_FACT =
  /\b(allerg\w+|anaphyla\w+|intoleran\w+|asthma|epi-?pen|diabet\w+|heart condition|pacemaker|defibrillator|vegetarian|vegan|halal|kosher|gluten|lactose|peanut|shellfish|bee sting)\b/iu;

export function isCoreMemoryFact(text: string): boolean {
  return CORE_MEMORY_FACT.test(text);
}

const logger = createOpenBotLogger("agent-memory-rules");

/** The memory audit journal under `userData`, deliberately outside any agent workspace. */
export const AGENT_MEMORY_JOURNAL_FILE = "agent-memory-journal-v1.ndjson";
const JOURNAL_TEXT_CHARACTERS = 240;
const JOURNAL_MAX_BYTES = 512_000;

export interface AgentMemoryJournalInput {
  userDataPath: string;
  /** Who wrote the change: the agent's own tool, the person, or the idle review. */
  actor: "agent" | "person" | "review";
  action: "save" | "replace" | "delete" | "clear";
  agentId: string;
  memoryId?: string | null;
  text?: string | null;
  /** The text the change removed, when there was one. */
  before?: string | null;
}

function journalField(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const redacted = redactText(value.trim());
  return redacted.slice(0, JOURNAL_TEXT_CHARACTERS);
}

/**
 * Appends one audit line. The audited agent must not be able to rewrite its own trail, so the journal
 * lives beside the database, not in a workspace. A failed write is logged and dropped: recording a
 * change that already happened never fails the change, and never retries inside a turn.
 */
export function appendAgentMemoryJournal(input: AgentMemoryJournalInput): void {
  const path = join(input.userDataPath, AGENT_MEMORY_JOURNAL_FILE);
  const fields: Record<string, string> = {
    at: new Date().toISOString(),
    actor: input.actor,
    action: input.action,
    agentId: input.agentId,
  };
  const memoryId = journalField(input.memoryId);
  if (memoryId) fields.memoryId = memoryId;
  const text = journalField(input.text);
  if (text) fields.text = text;
  const before = journalField(input.before);
  if (before) fields.before = before;
  try {
    appendFileSync(path, `${JSON.stringify(fields)}\n`, "utf8");
    if (statSync(path).size > JOURNAL_MAX_BYTES) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      // Keep the newest half, cut on a whole line so a reader never sees a torn record.
      writeFileSync(path, `${lines.slice(Math.floor(lines.length / 2)).join("\n")}\n`, "utf8");
    }
  } catch (error) {
    logger.warn("Could not write the memory journal line.", { path, error });
  }
}
