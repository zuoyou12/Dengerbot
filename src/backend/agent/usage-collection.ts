import { randomUUID } from "node:crypto";
import { type AgentSummary, isAgentModel, type UsageTokens, WORKFLOWS_USAGE_ID } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import type { AgentUsage } from "../database/agent-usage";
import type { ProviderSession } from "../database/provider-sessions";
import { getRecord, getString } from "../protocol";

const logger = createOpenBotLogger("usage-collection");

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Translates provider counters at the process boundary, without retaining provider payloads. */
export function collectProviderUsage(
  usage: AgentUsage,
  agent: Pick<AgentSummary, "id" | "model">,
  session: Pick<ProviderSession, "id" | "provider" | "createdAt">,
  method: string,
  params: unknown,
): void {
  if (method === "turn/started") {
    const turnId = getString(getRecord(params, "turn"), "id");
    if (turnId) usage.startTurn(agent.id, session.id, turnId, session.provider, agent.model);
    return;
  }
  if (method === "model/rerouted") {
    const turnId = getString(params, "turnId");
    const model = getString(params, "toModel");
    if (turnId && isAgentModel(model)) usage.reroute(agent.id, session.id, turnId, model);
    return;
  }
  if (method !== "thread/tokenUsage/updated" && method !== "openbot/usage") return;
  const turnId = getString(params, "turnId") ?? "baseline";
  const value = getRecord(params, "usage");
  if (!value) return;
  // A model chosen while the turn runs applies from the next turn, so the turn keeps its own.
  const model = usage.turnModel(agent.id, session.id, turnId) ?? agent.model;
  // ACP `Usage` is session-cumulative by contract: its fields are documented as "Sum of all token
  // types across session" and "Total input tokens across all turns". So one counter per session,
  // like Codex, and the first report of a session that predates collection is a baseline: it
  // carries tokens spent before analytics existed.
  usage.record({
    agentId: agent.id,
    sessionId: session.id,
    turnId,
    provider: session.provider,
    model,
    counterId: `${session.id}:grok`,
    baseline: session.createdAt < usage.collectionStartedAt(),
    tokens: acpTokens(value),
  });
}

/**
 * Collects the usage of one workflow model or condition step under the reserved Workflows row. The
 * step is its own session, so its counters never meet those of another step on the same process.
 */
export function workflowUsageObserver(
  usage: AgentUsage,
  provider: ProviderSession["provider"],
  model: AgentSummary["model"],
): (notification: { method: string; params?: unknown }) => void {
  const session = { id: `workflow:${randomUUID()}`, provider, createdAt: new Date().toISOString() };
  return ({ method, params }) => {
    try {
      collectProviderUsage(usage, { id: WORKFLOWS_USAGE_ID, model }, session, method, params);
    } catch (error) {
      logger.warn("Could not save the usage of a workflow step.", { provider, error });
    }
  };
}

/** An ACP `Usage`, whose `inputTokens` include the cache reads and writes. */
function acpTokens(value: DynamicRecord): UsageTokens {
  const input = count(value.inputTokens);
  const cached = count(value.cachedReadTokens);
  const creation = count(value.cachedWriteTokens);
  return {
    uncachedInput:
      input !== null && cached !== null && creation !== null && input >= cached + creation
        ? input - cached - creation
        : null,
    cachedInput: cached,
    cacheCreation: creation,
    output: count(value.outputTokens),
  };
}
