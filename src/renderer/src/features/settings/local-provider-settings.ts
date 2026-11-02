import { isAgentAccount } from "@openbot/ui/components/provider-accounts";
import { useProviders } from "../../providers";
import { useAgents } from "../agents/agents-context";
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
  const usage = usePlanLimitRows();
  return {
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
