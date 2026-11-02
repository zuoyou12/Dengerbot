import type { AcpFlavor } from "./acp-flavor";

/**
 * Normalizes deceptive error envelopes from subscribed upstream providers (such as ZCode code 1000
 * or WorkBuddy code 11140 / 10085) into clear, user-friendly diagnostic messages.
 */
// biome-ignore lint/nursery/noMisleadingReturnType: The message is one literal per provider error; the nullable string is the contract callers use.
export function normalizeSubscribedProviderError(detail: string): string | null {
  if (!detail) return null;
  if (
    detail.includes('"code":1000') ||
    detail.includes('"code": 1000') ||
    detail.includes("code: 1000") ||
    detail.includes("用户未登录") ||
    detail.includes("Token已过期")
  ) {
    return "ZCode 认证失败 (code 1000): 用户未登录或 Token 已过期，请在设置中配置或重新登录 ZCode。";
  }
  if (
    detail.includes('"code":11140') ||
    detail.includes('"code": 11140') ||
    detail.includes("code: 11140") ||
    detail.includes("账号存在异常行为")
  ) {
    return "WorkBuddy 账号受限 (code 11140): 账号存在异常行为，已触发风控限制。请在 WorkBuddy 客户端重新登录。";
  }
  if (
    detail.includes('"code":10085') ||
    detail.includes('"code": 10085') ||
    detail.includes("code: 10085") ||
    detail.includes("请求不合法")
  ) {
    return "WorkBuddy 请求不合法 (code 10085): 缺少必需的 User-Agent: WorkBuddy/5.5.6 标头。";
  }
  return null;
}

/**
 * DeepSeek Harness (`dsh --profile acp`). Its ACP server advertises only `close`, `list` and
 * `resume`, so a restore uses `session/resume`; the protocol's own rule covers that.
 *
 * It has no compact request: the ACP server exposes no such method. OpenBot therefore rotates the
 * session at the context threshold and starts the next one from the history handoff. The DSH
 * profile raises the harness's own automatic compaction (see `configureDshCustomProviders`), so
 * OpenBot usually acts first and DSH remains the overflow fallback. A small window or a large
 * output reservation can still let DSH compact first; the handoff then reads OpenBot's own history.
 */
export const DSH_ACP_FLAVOR: AcpFlavor = {
  contextCompaction: "handoff",
  turnFailure(_error, detail, redact, log) {
    const normalized = normalizeSubscribedProviderError(detail);
    if (normalized) {
      log(detail);
      return redact(normalized);
    }
    return detail;
  },
};
