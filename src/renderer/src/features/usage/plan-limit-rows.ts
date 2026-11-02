import { accountUsageProviderRows } from "@openbot/ui/features/account/account-usage-view";
import { useText } from "@openbot/ui/text";
import { createMemo } from "solid-js";
import { useAgents } from "../agents/agents-context";

/** One row per provider account of the active server, for the rail rings. */
export function usePlanLimitRows() {
  const text = useText();
  const { agentStatus, hostAccountLimits } = useAgents();
  return createMemo(() => {
    // Slim build: no central account usage reading exists. Only the limits a
    // joined host reports become rows; otherwise the providers list alone does.
    const limits = hostAccountLimits();
    return accountUsageProviderRows(limits.length > 0 ? { limits } : null, agentStatus().providers, text);
  });
}
