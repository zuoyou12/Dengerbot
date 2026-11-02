import type { ConversationMessage } from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";

/** How long the steward call runs before the mechanical fallback rotates. */
export const STEWARD_TIMEOUT_MS = 20_000;
/** Messages of the conversation the steward request reads. */
export const STEWARD_MESSAGES = 40;
/** Input text of the conversation that the steward request reads. */
const STEWARD_INPUT_CHARACTERS = 12_000;
const STEWARD_MESSAGE_CHARACTERS = 1_200;

export type StewardAction = "rotate" | "continue";

export interface StewardDecision {
  readonly action: StewardAction;
  readonly reason: string;
}

/**
 * The request that decides whether a pressured session rotates now or keeps going. It runs on a
 * disposable client without tools: the only output is a decision, and the caller rotates on any
 * failure, so a wrong or missing answer costs at most the rotation that would have happened anyway.
 * The transcript is redacted first, like every auxiliary request that carries conversation text.
 */
export function stewardPrompt(input: {
  messages: readonly ConversationMessage[];
  usedTokens: number;
  contextWindow: number;
  /** How many times this session already kept going on a steward decision. */
  stewardAsks: number;
}): string {
  let remaining = STEWARD_INPUT_CHARACTERS;
  const transcript: string[] = [];
  for (const message of input.messages.toReversed()) {
    if (remaining <= 0) break;
    if (message.author !== "user" && message.author !== "assistant" && message.author !== "agent") continue;
    const text = redactText(message.text).slice(0, Math.min(STEWARD_MESSAGE_CHARACTERS, remaining));
    if (!text.trim()) continue;
    transcript.unshift(`${message.author}: ${text}`);
    remaining -= text.length;
  }
  const percent = Math.min(100, Math.round((input.usedTokens / input.contextWindow) * 100));
  return [
    "You are reviewing your own conversation to time its move to a fresh session. This request comes from Dengerbot, not from the user: do not answer the messages below and do not continue the work.",
    `The conversation has used about ${percent}% of the context window${
      input.stewardAsks > 0
        ? `, and it has already been kept going ${input.stewardAsks} time(s) on your earlier decisions`
        : ""
    }.`,
    "",
    'Decide between two actions and output only JSON: {"action":"continue","reason":"one sentence"} or {"action":"rotate","reason":"one sentence"}.',
    '- "continue": the work is under way. A task is half-done, a question still waits for a real answer, or a multi-step request is in progress. Rotating now would cut the work apart.',
    '- "rotate": the conversation reached a stopping point. The latest request was answered, nothing is half-done, nothing was promised. A fresh session that starts from a handoff note loses nothing.',
    "Check every part of the user's latest request against what the assistant actually did. A reply that only thanks or acknowledges is not an answer. An unfinished plan, a failing command, a build or a test still running, a question you asked that waits for the user: all of these mean continue.",
    "The more times this conversation has already been kept going, the more a reasonable stopping point counts as one.",
    "",
    "Recent messages, oldest first:",
    transcript.join("\n\n"),
  ].join("\n");
}

const ACTIONS: Record<string, StewardAction> = {
  rotate: "rotate",
  switch: "rotate",
  continue: "continue",
  compact: "continue",
};

/**
 * The decision in a reply, or `null` when the reply holds none. The last JSON object wins, so a
 * model that quotes an earlier decision in its prose cannot decide; only the two known words (and
 * their obvious synonyms) are accepted, and a reply without a usable object is a failure the
 * caller answers with the mechanical rotation.
 */
export function parseStewardDecision(reply: string | null): StewardDecision | null {
  if (!reply) return null;
  const candidates: string[] = [];
  const stripped = reply
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "")
    .trim();
  candidates.push(stripped);
  for (const match of stripped.matchAll(/\{[^{}]*\}/gu)) candidates.push(match[0]);
  for (const candidate of candidates.reverse()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const word = (parsed as { action?: unknown }).action;
    // The model's last word decides: an object that names no action we accept is a failed answer,
    // not a reason to reach back for an earlier one.
    if (typeof word !== "string") continue;
    const action = ACTIONS[word];
    if (!action) return null;
    const rawReason = (parsed as { reason?: unknown }).reason;
    const reason = typeof rawReason === "string" ? redactText(rawReason.trim()).slice(0, 300) : "";
    return { action, ...(reason ? { reason } : { reason: "" }) };
  }
  return null;
}
