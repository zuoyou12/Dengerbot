import type { AgentSummary } from "@openbot/contracts/ipc";

/** How an agent's turns are paid for. `custom` is an endpoint the user added, local or remote. */
export const PROVIDER_AUTH_KINDS = ["subscription", "api_key", "free", "custom", "unknown"] as const;
export type ProviderAuthKind = (typeof PROVIDER_AUTH_KINDS)[number];

export interface ProviderAuthFacts {
  /** The type and plan of the provider's own sign-in, as its CLI reports them. */
  account: (provider: AgentSummary["provider"]) => { type: string; planType: string | null } | null;
  hasApiKey: (provider: AgentSummary["provider"]) => boolean;
  customProviderIds: () => readonly string[];
  /** Whether the main process environment, which the provider CLIs inherit, sets the key. */
  envKey: (name: "XAI_API_KEY" | "CURSOR_API_KEY") => boolean;
}

/**
 * Reads only what the host already holds; nothing here calls a provider. A case it cannot tell
 * apart is `unknown`, never a guess: DeepSeek can run any model with the user's own key.
 */
export function providerAuthKind(agent: AgentSummary, facts: ProviderAuthFacts): ProviderAuthKind {
  switch (agent.provider) {
    case "codex": {
      const account = facts.account("codex");
      if (account?.type === "apiKey") return "api_key";
      if (account?.type !== "chatgpt") return "unknown";
      return account.planType === "free" ? "free" : "subscription";
    }
    case "deepseek":
      return facts.hasApiKey(agent.provider) ? "api_key" : "unknown";
    default:
      return "unknown";
  }
}
