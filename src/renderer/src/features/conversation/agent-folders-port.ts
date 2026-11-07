// The bridge calls behind an agent's Folders row, the Folders page and the chat's folder drop. The
// folders also work for a joined server's agent, through `agent-folders-v1`.

import { agentFolderParent } from "@openbot/contracts/ipc";
import type { AgentFolderCalls } from "@openbot/ui/features/conversation/AgentFolders";
import type { HostFolderPickMode } from "@openbot/ui/features/conversation/HostFolderPicker";

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function agentFolderCalls(): AgentFolderCalls {
  return {
    list: (agentId) => window.openbot.agent.listAgentFolders(agentId),
    choose: (agentId, replace) =>
      window.openbot.agent.chooseAgentFolder(replace === undefined ? { agentId } : { agentId, replace }),
    add: (agentId, path) => window.openbot.agent.addAgentFolder({ agentId, path }),
    remove: (agentId, path) => window.openbot.agent.removeAgentFolder({ agentId, path }),
    drop: (agentId, folder) => window.openbot.agent.addDroppedAgentFolder(agentId, folder),
    exclude: (agentId) => window.openbot.agent.chooseAgentExclusion(agentId),
    addExclusion: (agentId, path) => window.openbot.agent.addAgentExclusion({ agentId, path }),
    include: (agentId, path) => window.openbot.agent.removeAgentExclusion({ agentId, path }),
  };
}

/** Opens the host folder browser. The picked folder, or null when the user closes it. */
export type HostFolderPickFn = (
  agentId: string,
  mode: HostFolderPickMode,
  start: string | null,
) => Promise<string | null>;

/**
 * The folders of an agent on a joined server. The native picker shows only this computer, so `pick`
 * lists the folders of the host. A folder dropped from this computer is not on the host: no `drop`.
 */
export function remoteAgentFolderCalls(serverId: string, pick: HostFolderPickFn): AgentFolderCalls {
  const agent = () => window.openbot.agent;
  const list = (agentId: string) => agent().listAgentFolders(agentId, serverId);
  return {
    list,
    choose: async (agentId, replace) => {
      const picked = await pick(
        agentId,
        replace === undefined ? "add" : "locate",
        replace === undefined ? null : agentFolderParent(replace),
      );
      if (picked === null) return { outcome: "cancelled", list: await list(agentId) };
      return agent().addAgentFolder(
        replace === undefined ? { agentId, path: picked } : { agentId, path: picked, replace },
        serverId,
      );
    },
    add: (agentId, path) => agent().addAgentFolder({ agentId, path }, serverId),
    remove: (agentId, path) => agent().removeAgentFolder({ agentId, path }, serverId),
    // The browser opens in the first added folder, else in the workspace, as the native picker does.
    exclude: async (agentId) => {
      const current = await list(agentId);
      const picked = await pick(agentId, "exclude", current.folders[0]?.path ?? current.workspace);
      if (picked === null) return { outcome: "cancelled", list: await list(agentId) };
      return agent().addAgentExclusion({ agentId, path: picked }, serverId);
    },
    addExclusion: (agentId, path) => agent().addAgentExclusion({ agentId, path }, serverId),
    include: (agentId, path) => agent().removeAgentExclusion({ agentId, path }, serverId),
  };
}

/** The folders in one folder of a joined server's computer, for the host folder browser. */
export function browseHostFolders(serverId: string, agentId: string, path: string | null) {
  return window.openbot.agent.browseAgentFolders({ agentId, path }, serverId);
}
