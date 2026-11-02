import type { DshRuntimeUpdater } from "../dsh-runtime-updater";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject } from "./validation";

export function dshRuntimeIpcHandlers(updater: DshRuntimeUpdater): Pick<IpcGroupHandlers, "dshRuntime"> {
  return {
    dshRuntime: {
      getStatus: handler(() => updater.status()),
      checkForUpdate: handler(() => updater.checkForUpdate()),
      installUpdate: payloadHandler(parseInstallDshRuntime, (input) => updater.installUpdate(input)),
      rollback: handler(() => updater.rollback()),
    },
  };
}

function parseInstallDshRuntime(input: unknown): { version: string } {
  if (!isObject(input) || typeof input.version !== "string" || input.version.length === 0) {
    throw new Error("Invalid DSH runtime version.");
  }
  return { version: input.version };
}
