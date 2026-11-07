// The folders an agent can change besides its workspace and the shared folder. The native pickers
// show only this computer, so they stay local: this fork registers no `agent-folders-v1`, so a
// request scoped to a joined server is refused before anything leaves.

import { join } from "node:path";
import {
  type AgentExclusionChange,
  parseAddAgentFolderInput,
  parseAgentFolderInput,
  parseBrowseAgentFoldersInput,
  parseChooseAgentFolderInput,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { sourceText } from "@openbot/i18n/source";
import { type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import type { AgentFolders } from "../agent-folders";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

export interface AgentFolderIpcDependencies {
  folders: AgentFolders;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

export function agentFolderIpcHandlers({
  folders,
  getMainWindow,
  translate,
}: AgentFolderIpcDependencies): Pick<IpcGroupHandlers, "agentFolders"> {
  /** The fork registers no `agent-folders-v1`: no joined host can answer these routes. */
  function remote<T>(): Promise<T> {
    throw new Error(sourceText("error.team.agentFoldersUnsupported"));
  }

  /** A second press on + while the picker is open does not open another one. */
  let picking = false;

  /** The picked folder, or undefined when the user cancels or a picker is already open. */
  async function pick(options: OpenDialogOptions): Promise<string | undefined> {
    if (picking) return undefined;
    picking = true;
    const parent = getMainWindow();
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)).finally(
      () => {
        picking = false;
      },
    );
    return result.canceled ? undefined : result.filePaths[0];
  }

  return {
    agentFolders: {
      listAgentFolders: scopedHandler(parseAgentId, {
        local: (agentId) => folders.list(agentId),
        remote: () => remote(),
      }),
      chooseAgentFolder: payloadHandler(parseChooseAgentFolderInput, async ({ agentId, replace }) => {
        const agent = folders.requireAgent(agentId);
        const picked = await pick({
          title: translate("dialog.chooseAgentFolder", { agent: agent.name }),
          properties: ["openDirectory", "createDirectory"],
          ...(replace === undefined ? {} : { defaultPath: join(replace, "..") }),
        });
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(agentId) };
        return folders.add(agentId, picked, replace);
      }),
      addAgentFolder: scopedHandler(parseAddAgentFolderInput, {
        local: ({ agentId, path, replace }) => folders.add(agentId, path, replace),
        remote: () => remote(),
      }),
      chooseAgentExclusion: payloadHandler(parseAgentId, async (agentId): Promise<AgentExclusionChange> => {
        const agent = folders.requireAgent(agentId);
        // The picker opens in the first added folder, else in the workspace.
        const picked = await pick({
          title: translate("dialog.chooseAgentExclusion", { agent: agent.name }),
          properties: ["openDirectory"],
          defaultPath: agent.additionalFolders?.[0] ?? agent.workspacePath,
        });
        if (picked === undefined) return { outcome: "cancelled", list: await folders.list(agentId) };
        return folders.exclude(agentId, picked);
      }),
      addAgentExclusion: scopedHandler(parseAgentFolderInput, {
        local: ({ agentId, path }) => folders.exclude(agentId, path),
        remote: () => remote(),
      }),
      removeAgentExclusion: scopedHandler(parseAgentFolderInput, {
        local: ({ agentId, path }) => folders.include(agentId, path),
        remote: () => remote(),
      }),
      removeAgentFolder: scopedHandler(parseAgentFolderInput, {
        local: ({ agentId, path }) => folders.remove(agentId, path),
        remote: () => remote(),
      }),
      browseAgentFolders: scopedHandler(parseBrowseAgentFoldersInput, {
        // Only a joined server needs this list: this computer has the native folder picker.
        local: () => {
          throw new Error(sourceText("error.team.folderUnavailable"));
        },
        remote: () => remote(),
      }),
    },
  };
}
