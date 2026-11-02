/**
 * Provider-reported costs arrive in USD (the database column and analytics contract stay
 * USD-denominated), and the UI renders them in CNY. The rate is pinned here rather than
 * fetched live; update it when the estimate needs to track the market.
 * Source: exchangerate-api.com, 2026-10-31 (ECB cross-check 6.6529, 2026-10-30).
 */
export const USD_TO_CNY_RATE = 6.67;

export function usdToCny(value: number): number {
  return value * USD_TO_CNY_RATE;
}

/** A provider that reports its cost in CNY is normalized to USD for storage. */
export function cnyToUsd(value: number): number {
  return value / USD_TO_CNY_RATE;
}
