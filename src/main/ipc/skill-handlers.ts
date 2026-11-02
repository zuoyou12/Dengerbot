import { localSkillTools } from "../local-skill-tools";
import {
  parseCreateLocalSkill,
  parseInstallLocalSkill,
  parseInstallPresetSkill,
  parseInstallRemotePlugin,
  parseReadLocalSkill,
  parseReviseLocalSkill,
} from "./local-skill-inputs";
// The skill marketplace, and the skills installed into a workspace.

import type { AppTranslate } from "@openbot/i18n";
import { app, type BrowserWindow, dialog, type OpenDialogOptions } from "electron";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { SkillMarketplaceService } from "../skill-marketplace-service";
import { parseInstallSkill, parseSetEnabledSkill, parseUninstallSkill } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface SkillIpcDependencies {
  skills: SkillMarketplaceService;
  getMainWindow: () => BrowserWindow | null;
  translate: AppTranslate;
}

/** The preset skill packs the catalog build ships beside the other resources. */
function presetSkillsRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "preset-skills")
    : resolve(__dirname, "../../resources/preset-skills");
}

/** A fresh temp directory per remote install; the service cleans it up when it settles. */
function remotePluginTempRoot(): string {
  return join(tmpdir(), `openbot-remote-plugin-${randomUUID()}`);
}

export function skillIpcHandlers({
  skills,
  getMainWindow,
  translate,
}: SkillIpcDependencies): Pick<IpcGroupHandlers, "skills"> {
  return {
    skills: {
      localList: handler(() => runCauseEffect(localSkillTools(skills).list())),
      localGet: payloadHandler(parseReadLocalSkill, (input) => runCauseEffect(localSkillTools(skills).get(input))),
      localCreate: payloadHandler(parseCreateLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).create(input)),
      ),
      localRevise: payloadHandler(parseReviseLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).revise(input)),
      ),
      localInstall: payloadHandler(parseInstallLocalSkill, (input) =>
        runCauseEffect(localSkillTools(skills).install(input)),
      ),
      installPreset: payloadHandler(parseInstallPresetSkill, (input) =>
        runCauseEffect(skills.installPreset(input, presetSkillsRoot())),
      ),
      installRemote: payloadHandler(parseInstallRemotePlugin, (input) =>
        runCauseEffect(skills.installRemote(input, remotePluginTempRoot())),
      ),
      choosePackage: handler(async () => {
        const mainWindow = getMainWindow();
        const options: OpenDialogOptions = {
          title: translate("dialog.chooseSkill"),
          properties: ["openFile", "openDirectory"],
          filters: [{ name: translate("dialog.filter.skillPackages"), extensions: ["zip"] }],
        };
        const result = mainWindow
          ? await dialog.showOpenDialog(mainWindow, options)
          : await dialog.showOpenDialog(options);
        return result.canceled || !result.filePaths[0] ? null : runCauseEffect(skills.stage(result.filePaths[0]));
      }),
      listInstalled: payloadHandler(stringPayload("agentId"), (agentId) =>
        runCauseEffect(skills.listInstalled(agentId)),
      ),
      install: payloadHandler(parseInstallSkill, (installation) => runCauseEffect(skills.install(installation))),
      uninstall: payloadHandler(parseUninstallSkill, (removal) => runCauseEffect(skills.uninstall(removal))),
      setEnabled: payloadHandler(parseSetEnabledSkill, (change) => runCauseEffect(skills.setEnabled(change))),
    },
  };
}
