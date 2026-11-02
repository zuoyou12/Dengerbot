import { analyticsRange, type ClientAgentSummary, type HostAnalytics, LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import type { ProfileActivityPhase } from "@openbot/ui/features/settings/ProfileActivity";
import { errorReference } from "@openbot/user-errors";
import { createEffect, createStore, untrack } from "solid-js";
import { usagePort } from "../usage/usage-port";

/** Loads this computer's activity using the upstream profile report. */
export function createProfileActivityStore(isActive: () => boolean) {
  const [state, setState] = createStore<{
    phase: ProfileActivityPhase;
    report: HostAnalytics | null;
    agents: ClientAgentSummary[];
    errorReference: string | null;
  }>({ phase: "loading", report: null, agents: [], errorReference: null });
  let generation = 0;

  async function load(): Promise<void> {
    const request = ++generation;
    const background = untrack(() => state.report !== null);
    if (!background)
      setState((draft) => {
        draft.phase = "loading";
        draft.errorReference = null;
      });
    const { startDate, endDate, timeZone } = analyticsRange("profile", 365);
    try {
      const [report, agents] = await Promise.all([
        usagePort().agent.getHostAnalytics({ startDate, endDate, timeZone }, LOCAL_SERVER_ID),
        usagePort().agent.listAgents(LOCAL_SERVER_ID),
      ]);
      if (request !== generation) return;
      setState((draft) => {
        draft.report = report;
        draft.agents = agents;
        draft.phase = report ? "ready" : "unsupported";
      });
    } catch (error) {
      if (request !== generation || background) return;
      setState((draft) => {
        draft.phase = "error";
        draft.errorReference = errorReference(error);
      });
    }
  }

  createEffect(isActive, (active) => {
    if (!active) {
      generation++;
      return;
    }
    void load();
    const unsubscribe = usagePort().agent.onScopedEvent(({ serverId, event }) => {
      if (serverId === LOCAL_SERVER_ID && event.type === "turn-completed") void load();
    });
    return () => {
      generation++;
      unsubscribe();
    };
  });
  return { state, retry: () => void load() };
}
