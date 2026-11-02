import type { UsageTokens } from "@openbot/contracts/ipc";

/**
 * Prices the tokens of one update from list rates. No retained provider has list rates in this
 * build (the table used to hold codex, grok and claude rates only), so every estimate is null
 * and the provider-reported cost is what usage records carry. The signature stays: the database
 * layer calls this for every recorded update.
 */
export function estimateUsageCost(
  _provider: string,
  _model: string,
  _tokens: UsageTokens,
  _lastRequestInputTokens: number | null,
  _smallestRequestInputTokens: number | null = null,
): { cost: number | null; basis: string | null } {
  return { cost: null, basis: null };
}
