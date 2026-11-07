import { parseRegistryId, parseRegistryInstall, parseRegistryQuery } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AcpRegistry } from "../acp-registry";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

// The registry is local to the computer that runs the agents. A remote caller gets the same answer
// on every endpoint: the Team API carries no registry route, and a host must not fetch or install a
// program because a joined server asked it to.
function remoteUnavailable(): never {
  throw new Error(sourceText("error.provider.registryUnavailable"));
}

export function acpRegistryIpcHandlers(registry: AcpRegistry): Pick<IpcGroupHandlers, "acpRegistry"> {
  return {
    acpRegistry: {
      search: scopedHandler(parseRegistryQuery, {
        local: (query) => runCauseEffect(registry.search(query)),
        remote: () => remoteUnavailable(),
      }),
      installed: scopedQueryHandler({
        local: () => runCauseEffect(registry.listInstalled()),
        remote: () => remoteUnavailable(),
      }),
      status: scopedQueryHandler({
        local: () => runCauseEffect(registry.status()),
        remote: () => remoteUnavailable(),
      }),
      install: scopedHandler(parseRegistryInstall, {
        local: (input) => runCauseEffect(registry.install(input)),
        remote: () => remoteUnavailable(),
      }),
      cancel: scopedHandler(parseRegistryId, {
        local: (id) => runCauseEffect(registry.cancel(id)),
        remote: () => remoteUnavailable(),
      }),
      remove: scopedHandler(parseRegistryId, {
        local: (id) => runCauseEffect(registry.uninstall(id)),
        remote: () => remoteUnavailable(),
      }),
    },
  };
}
