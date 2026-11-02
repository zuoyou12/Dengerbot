import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ConversationMessage } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";

/** One memory the review proposes, checked against the message that it quotes. */
export interface MemoryReviewCandidate {
  readonly text: string;
  readonly evidence: string;
  readonly sourceMessageId: string;
  readonly replaceMemoryId?: string;
}

const MAX_CANDIDATES = 5;
const MIN_EVIDENCE = 4;
const REVIEW_INPUT_CHARACTERS = 16_000;
const REVIEW_MESSAGE_CHARACTERS = 1_200;
/** Existing memories shown so the review can correct one instead of adding a contradicting entry. */
const REVIEW_EXISTING_LIMIT = 30;
const REVIEW_EXISTING_TEXT_CHARACTERS = 200;

/**
 * Whether this message is the user speaking. Routine deliveries and teammate relays also arrive as
 * `author: "user"`; their text is not the user's own words, so it is not reviewable evidence.
 */
function isUserAuthored(message: ConversationMessage): boolean {
  return message.author === "user" && message.source === "user";
}

/** The per-agent cursor of the idle memory review, under `userData`. */
export const MEMORY_REVIEW_STATE_FILE = "agent-memory-review-v1.json";

export interface MemoryReviewState {
  readonly version: 1;
  readonly agents: Readonly<Record<string, { lastMessageId: string; lastRunAt: number }>>;
}

/** A missing or damaged state file means "nothing reviewed yet"; the next review starts from recent messages. */
export function decodeMemoryReviewState(contents: string | null): MemoryReviewState {
  const empty: MemoryReviewState = { version: 1, agents: {} };
  if (!contents) return empty;
  try {
    const value = JSON.parse(contents);
    if (!isDynamicRecord(value) || !isDynamicRecord(value.agents)) return empty;
    const agents: Record<string, { lastMessageId: string; lastRunAt: number }> = {};
    for (const [agentId, entry] of Object.entries(value.agents)) {
      if (!isDynamicRecord(entry) || typeof entry.lastMessageId !== "string" || typeof entry.lastRunAt !== "number")
        continue;
      agents[agentId] = { lastMessageId: entry.lastMessageId, lastRunAt: entry.lastRunAt };
    }
    return { version: 1, agents };
  } catch {
    return empty;
  }
}

export interface MemoryReviewExisting {
  readonly id: string;
  readonly text: string;
}

export interface MemoryReviewRequest {
  prompt: string;
  /** The newest user message the request includes; the review cursor moves here and no further. */
  newestShownMessageId: string | null;
}

/**
 * The request that reviews recent user messages for durable memories. It runs on a disposable
 * client without tools: the only output is JSON, and the host verifies every quote before writing.
 * Only user-authored messages are shown; an assistant's or a routine's claim is not evidence about
 * the user. The budget keeps the newest messages, because the cursor only moves to the newest one
 * it shows: an oldest-first cut would let the cursor skip messages it never sent.
 */
export function memoryReviewPrompt(
  messages: readonly ConversationMessage[],
  existing: readonly MemoryReviewExisting[] = [],
): MemoryReviewRequest {
  let remaining = REVIEW_INPUT_CHARACTERS;
  const shown: string[] = [];
  let newestShownMessageId: string | null = null;
  for (const message of messages.toReversed()) {
    if (remaining <= 0) break;
    if (!isUserAuthored(message)) continue;
    const text = redactText(message.text).slice(0, Math.min(REVIEW_MESSAGE_CHARACTERS, remaining));
    if (!text.trim()) continue;
    shown.unshift(JSON.stringify({ id: message.id, text }));
    newestShownMessageId ??= message.id;
    remaining -= text.length;
  }
  const memories = existing.slice(0, REVIEW_EXISTING_LIMIT).map((memory) => ({
    id: memory.id,
    text: redactText(memory.text).slice(0, REVIEW_EXISTING_TEXT_CHARACTERS),
  }));
  const prompt = [
    "Review these user messages for durable memories. This request comes from Dengerbot, not from the user. Do not answer the user and do not call tools.",
    "Keep only facts, preferences, standing decisions, or corrections that stay useful across conversations and that the user stated themselves. Do not keep task-only details, one-off requests, secrets, credentials, guesses, or anything taken from an assistant message.",
    'Output only JSON: {"memories":[{"text":"one short fact","evidence":"a continuous quote from the source user message","sourceMessageId":"the message id"}]}.',
    `Return at most ${MAX_CANDIDATES} memories. Return an empty array when nothing is worth keeping. Each text holds one fact, at most ${INPUT_LIMITS.agentMemoryText} characters.`,
    "The evidence must appear exactly in the named user message. Do not include a memory whose evidence is not there. When a newer message contradicts an older one, keep only the newer fact.",
    "",
    "User messages, oldest first:",
    shown.join("\n"),
  ];
  if (memories.length > 0) {
    prompt.push(
      "",
      "Saved memories. When the user corrected one of these in the messages above, the text may carry its id as replaceMemoryId; only an id from this list is valid.",
      memories.map((memory) => JSON.stringify(memory)).join("\n"),
    );
  }
  return { prompt: prompt.join("\n"), newestShownMessageId };
}

/**
 * The checked candidates in a reply, or `null` when the reply is not usable JSON. A candidate whose
 * evidence is not a continuous quote of the named user message, whose text is empty or too long, or
 * whose text repeats another candidate is dropped. A reply with no candidates is `[]`, not `null`:
 * the review ran and found nothing.
 */
export function parseMemoryReview(
  reply: string | null,
  messages: readonly ConversationMessage[],
): MemoryReviewCandidate[] | null {
  if (!reply) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/gu, "").trim());
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || !Array.isArray(parsed.memories)) return null;
  const users = new Map(
    messages.filter((message) => isUserAuthored(message)).map((message) => [message.id, message.text]),
  );
  const seen = new Set<string>();
  const candidates: MemoryReviewCandidate[] = [];
  for (const entry of parsed.memories) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (!isDynamicRecord(entry)) continue;
    const text = typeof entry.text === "string" ? redactText(entry.text.trim()) : "";
    const evidence = typeof entry.evidence === "string" ? redactText(entry.evidence.trim()) : "";
    const sourceMessageId = typeof entry.sourceMessageId === "string" ? entry.sourceMessageId : "";
    const source = users.get(sourceMessageId);
    if (!text || text.length > INPUT_LIMITS.agentMemoryText) continue;
    if (evidence.length < MIN_EVIDENCE || !source?.includes(evidence)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const replaceMemoryId =
      typeof entry.replaceMemoryId === "string" && entry.replaceMemoryId.trim()
        ? entry.replaceMemoryId.trim()
        : undefined;
    candidates.push({ text, evidence, sourceMessageId, ...(replaceMemoryId ? { replaceMemoryId } : {}) });
  }
  return candidates;
}

export interface MemoryReviewSchedulerOptions {
  enabled: boolean;
  /** How long after the turn the review waits, so the user can keep typing. */
  debounceMs: number;
  /** The least time between two reviews of one agent. */
  minimumIntervalMs: number;
  /** False while a turn, a queue or a compaction still needs the agent. */
  idle(agentId: string): boolean;
  /** Runs the review. Its failure is logged and does not affect the agent. */
  run(agentId: string): Promise<void>;
  warn(message: string, error: unknown): void;
  now?(): number;
}

/**
 * Schedules the idle memory review. It owns only timers and the per-agent interval; the review
 * itself belongs to the service. A turn that completes during the wait does not add a second timer,
 * and a review that finds the agent busy is skipped until a later turn schedules it again.
 */
export class MemoryReviewScheduler {
  readonly #options: MemoryReviewSchedulerOptions;
  readonly #timers = new Map<string, NodeJS.Timeout>();
  readonly #lastRun = new Map<string, number>();
  readonly #now: () => number;

  constructor(options: MemoryReviewSchedulerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  schedule(agentId: string): void {
    if (!this.#options.enabled || this.#timers.has(agentId)) return;
    const timer = setTimeout(() => {
      this.#timers.delete(agentId);
      const now = this.#now();
      const last = this.#lastRun.get(agentId) ?? 0;
      if (now - last < this.#options.minimumIntervalMs) return;
      if (!this.#options.idle(agentId)) return;
      this.#lastRun.set(agentId, now);
      void this.#options.run(agentId).catch((error: unknown) => {
        this.#options.warn("Could not review memories.", error);
      });
    }, this.#options.debounceMs);
    timer.unref?.();
    this.#timers.set(agentId, timer);
  }

  dispose(): void {
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}
