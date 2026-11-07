import { LOCAL_SERVER_ID } from "@openbot/contracts/ipc";
import { isAgentAccount } from "@openbot/ui/components/provider-accounts";
import type { AcpRegistrySettingsApi } from "@openbot/ui/features/custom-providers/AcpRegistrySettings";
import type { CustomAgentSettingsApi } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import { providerDiagnosticsText } from "@openbot/ui/features/provider-diagnostics/provider-diagnostics";
import { appPort } from "../../app-port";
import { useProviders } from "../../providers";
import { useAgents } from "../agents/agents-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useSetup } from "../onboarding/onboarding-context";
import { usePlanLimitRows } from "../usage/plan-limit-rows";
import type { HostProviderSettings } from "./ProviderSettingsSection";
import { providerKeyApi } from "./provider-key-api";

/** Shared local provider state for application settings and the computer's Providers page. */
export function useLocalProviderSettings(): HostProviderSettings {
  const { agentStatus, agentList } = useAgents();
  const { setupState, saveSetup } = useSetup();
  const providers = useProviders();
  const endpoints = useCustomProviders();
  const agents = useCustomAgents();
  const usage = usePlanLimitRows();
  /** A custom agent is a command on this computer, so only the local server lists or runs one. */
  const customAgents: CustomAgentSettingsApi = {
    get agents() {
      return agents.customAgents();
    },
    save: agents.saveCustomAgent,
    remove: agents.deleteCustomAgent,
    check: agents.checkCustomAgent,
    // One process group runs every custom agent, so its restart is the restart of all of them.
    get restartPending() {
      return agentStatus().providers?.some((provider) => provider.id === "acp" && provider.restartPending) === true;
    },
    get lastError() {
      return agentStatus().providers?.find((provider) => provider.id === "acp")?.lastError;
    },
    get diagnostics() {
      const status = agentStatus().providers?.find((provider) => provider.id === "acp");
      return status ? providerDiagnosticsText(status) : undefined;
    },
    restart: () => providers.restartProvider("acp"),
    cancelRestart: () => providers.cancelProviderRestart("acp"),
  };
  /** The registry installs commands on this computer, so its api reaches only the local server. */
  const acpRegistry: AcpRegistrySettingsApi = {
    search: (query) => appPort().acpRegistry.search(query, LOCAL_SERVER_ID),
    status: () => appPort().acpRegistry.status(LOCAL_SERVER_ID),
    install: async (input) => {
      const result = await appPort().acpRegistry.install(input, LOCAL_SERVER_ID);
      await agents.refreshCustomAgents();
      return result;
    },
    cancel: (id) => appPort().acpRegistry.cancel(id, LOCAL_SERVER_ID),
    remove: (id) => appPort().acpRegistry.remove(id, LOCAL_SERVER_ID),
  };
  return {
    customAgents,
    acpRegistry,
    get defaultProvider() {
      const setup = setupState();
      return setup ? { ...setup, save: saveSetup } : undefined;
    },
    get agentStatus() {
      return agentStatus();
    },
    get providerRuntimeStatuses() {
      return providers.providerRuntimeDownloadsAvailable() ? providers.providerRuntimeStatuses() : undefined;
    },
    get providerAvailableVersions() {
      return providers.providerRuntimeDownloadsAvailable() ? providers.providerAvailableVersions() : undefined;
    },
    get onDownloadProvider() {
      return providers.providerRuntimeDownloadsAvailable() ? providers.downloadProviderRuntime : undefined;
    },
    get onCancelProviderDownload() {
      return providers.providerRuntimeDownloadsAvailable() ? providers.cancelProviderRuntimeDownload : undefined;
    },
    get onUpdateProvider() {
      return providers.providerRuntimeDownloadsAvailable() ? providers.startProviderUpdate : undefined;
    },
    get customProviders() {
      return endpoints.customProviders();
    },
    onAddCustomProvider: endpoints.saveCustomProvider,
    onUpdateCustomProvider: endpoints.updateCustomProvider,
    onDeleteCustomProvider: endpoints.deleteCustomProvider,
    providerKeys: providerKeyApi,
    get connection() {
      return providers.connection;
    },
    onCancelProviderSignIn: providers.cancelProviderSignIn,
    onInstallProvider: providers.openProviderInstallGuide,
    onSetProviderOn: providers.setProviderOn,
    onRestartProvider: providers.restartProvider,
    onCancelProviderRestart: providers.cancelProviderRestart,
    get accountActions() {
      return providers.providerAccounts();
    },
    get usage() {
      return usage();
    },
    get providerUsers() {
      return Object.fromEntries(
        (agentStatus().providers ?? []).map((provider) => [
          provider.id,
          agentList()
            .filter((agent) => agent.provider === provider.id)
            .map((agent) => agent.name),
        ]),
      );
    },
    get providerAccountUsers() {
      return Object.fromEntries(
        (agentStatus().providers ?? []).map((provider) => [
          provider.id,
          Object.fromEntries(
            (provider.accounts ?? []).map((account) => [
              account.id,
              agentList()
                .filter(
                  (agent) => agent.provider === provider.id && isAgentAccount(agent.providerAccountId, account.id),
                )
                .map((agent) => agent.name),
            ]),
          ),
        ]),
      );
    },
  };
}
