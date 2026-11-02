import type { ConnectedAgentInfo, ExternalProviderInfo, LocalGatewayStatus } from "@openbot/contracts/ipc";
import { createEffect, createSignal } from "solid-js";
import { createSimpleContext } from "../../simple-context";

export interface LocalGatewayContextValue {
  status: () => LocalGatewayStatus | null;
  agents: () => readonly ConnectedAgentInfo[];
  externalProviders: () => readonly ExternalProviderInfo[];
  loading: () => boolean;
  error: () => string | null;
  dialogOpen: () => boolean;
  openDialog: () => void;
  closeDialog: () => void;
  setDialogOpen: (open: boolean) => void;
  refresh: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  refreshExternalProviders: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  setPort: (port: number) => Promise<void>;
  rotateToken: () => Promise<void>;
  wireAgent: (agentId: string, enabled: boolean) => Promise<void>;
  setExternalProvider: (providerId: string, enabled: boolean, apiKey?: string) => Promise<void>;
}

const context = createSimpleContext<LocalGatewayContextValue>({
  name: "LocalGatewayProvider",
  init: () => {
    const [status, setStatus] = createSignal<LocalGatewayStatus | null>(null);
    const [agents, setAgents] = createSignal<readonly ConnectedAgentInfo[]>([]);
    const [externalProviders, setExternalProviders] = createSignal<readonly ExternalProviderInfo[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal<string | null>(null);
    const [dialogOpen, setDialogOpen] = createSignal(false);

    async function refresh(): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      try {
        const next = await window.openbot.localGateway.getStatus();
        setStatus(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    async function refreshAgents(): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      try {
        const next = await window.openbot.localGateway.getAgents();
        setAgents(next);
      } catch (cause) {
        loggerWarn("refreshAgents failed", cause);
      }
    }

    async function refreshExternalProviders(): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      try {
        const next = await window.openbot.localGateway.getExternalProviders();
        setExternalProviders(next);
      } catch (cause) {
        loggerWarn("refreshExternalProviders failed", cause);
      }
    }

    async function setEnabled(enabled: boolean): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      setLoading(true);
      try {
        const next = await window.openbot.localGateway.setEnabled({ enabled });
        setStatus(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    }

    async function setPort(port: number): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      setLoading(true);
      try {
        const next = await window.openbot.localGateway.setPort({ port });
        setStatus(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    }

    async function rotateToken(): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      setLoading(true);
      try {
        const next = await window.openbot.localGateway.rotateToken();
        setStatus(next);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    }

    async function wireAgent(agentId: string, enabled: boolean): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      try {
        const next = await window.openbot.localGateway.wireAgent({ agentId, enabled });
        setAgents(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    async function setExternalProvider(providerId: string, enabled: boolean, apiKey?: string): Promise<void> {
      if (typeof window === "undefined" || !window.openbot?.localGateway) return;
      try {
        const next = await window.openbot.localGateway.setExternalProvider({
          providerId,
          enabled,
          ...(apiKey !== undefined ? { apiKey } : {}),
        });
        setExternalProviders(next);
        void refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    // Initial fetch
    void refresh();
    void refreshAgents();
    void refreshExternalProviders();

    // Auto-poll when dialog is open or when gateway is running
    const pollingActive = () => dialogOpen() || (status()?.running ?? false);
    createEffect(pollingActive, (active) => {
      if (!active) return undefined;
      const interval = window.setInterval(() => {
        void refresh();
        if (dialogOpen()) {
          void refreshAgents();
          void refreshExternalProviders();
        }
      }, 3000);
      return () => window.clearInterval(interval);
    });

    return {
      status,
      agents,
      externalProviders,
      loading,
      error,
      dialogOpen,
      openDialog: () => {
        void refresh();
        void refreshAgents();
        void refreshExternalProviders();
        setDialogOpen(true);
      },
      closeDialog: () => setDialogOpen(false),
      setDialogOpen,
      refresh,
      refreshAgents,
      refreshExternalProviders,
      setEnabled,
      setPort,
      rotateToken,
      wireAgent,
      setExternalProvider,
    };
  },
});

function loggerWarn(_msg: string, _error: unknown): void {
  // Silent fallback
}

export const LocalGatewayProvider = context.provider;
export const useLocalGateway = context.use;
