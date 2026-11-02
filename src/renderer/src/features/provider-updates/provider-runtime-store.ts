import type { AgentProviderId, ProviderRuntimeSnapshot, ProviderRuntimesDesktopApi } from "@openbot/contracts/ipc";
import { createEffect, createSignal, flush } from "solid-js";
import { FALLBACK_PROVIDER_RUNTIMES } from "../../app-defaults";

export interface ProviderCliOwners {
  systemCliVersion?: (provider: AgentProviderId) => string | null;
  isLocalServer?: () => boolean;
  managesRuntimes?: () => boolean;
}

/** Tracks runtime snapshots for the current host. This build has no managed provider CLIs. */
export function createProviderRuntimeStore(
  api: () => ProviderRuntimesDesktopApi | undefined,
  _owners: ProviderCliOwners = {},
) {
  const [snapshot, setSnapshot] = createSignal<ProviderRuntimeSnapshot>(FALLBACK_PROVIDER_RUNTIMES);
  function applyProviderRuntimeSnapshot(next: ProviderRuntimeSnapshot): void {
    if (next.revision >= snapshot().revision) setSnapshot(next);
  }
  createEffect(api, (source) => {
    setSnapshot(FALLBACK_PROVIDER_RUNTIMES);
    if (!source) return;
    let active = true;
    const apply = (next: ProviderRuntimeSnapshot) => {
      if (active && source === api()) flush(() => applyProviderRuntimeSnapshot(next));
    };
    const unsubscribe = source.onEvent(apply);
    source
      .getStatus()
      .then(apply)
      .catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  });
  const unavailable = async (_provider: AgentProviderId): Promise<void> => {
    throw new Error("Dengerbot does not manage this provider's CLI.");
  };
  return {
    providerRuntimeStatuses: () => snapshot().providers,
    toolRuntimeStatuses: () => snapshot().toolRuntimes,
    providerAvailableVersions: () => ({}),
    providerRuntimeDownloadsAvailable: () => false,
    applyProviderRuntimeSnapshot,
    startProviderUpdate: unavailable,
    downloadProviderRuntime: unavailable,
    cancelProviderRuntimeDownload: unavailable,
  };
}
