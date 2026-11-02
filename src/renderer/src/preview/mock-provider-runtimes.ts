import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import type { OpenBotDesktopApi, ProviderRuntimeSnapshot } from "@openbot/contracts/ipc";
import { clone, type Listener, type MockRuntime } from "./mock-support";

export interface MockProviderRuntimeOptions {
  providerRuntimeSnapshot?: ProviderRuntimeSnapshot;
  providerRuntimeFailure?: boolean;
}

/**
 * The runtime snapshot the preview answers with. No provider has a managed runtime in this build,
 * so `providers` is an empty record and a download stays refused, exactly as the desktop handler
 * refuses one. `toolRuntimes` still has `bun`, which the app does download.
 */
export function createMockProviderRuntimes(options: MockProviderRuntimeOptions, _runtime: MockRuntime) {
  const runtimeSnapshot: ProviderRuntimeSnapshot = clone(
    options.providerRuntimeSnapshot ?? {
      revision: 0,
      providers: {},
      toolRuntimes: { bun: { phase: "not-downloaded", progress: null, message: null, version: null } },
    },
  );
  const runtimeListeners = new Set<Listener<ProviderRuntimeSnapshot>>();
  const refuseDownload = () => {
    throw new Error("OpenBot does not manage this provider's CLI.");
  };

  const providerRuntimes: OpenBotDesktopApi["providerRuntimes"] = {
    getStatus: async () => clone(runtimeSnapshot),
    // The preview has no upstream to ask: every offer it makes is already in the snapshot.
    checkForUpdates: async () => clone(runtimeSnapshot),
    download: async (provider) => {
      if (!isManagedRuntimeProvider(provider)) refuseDownload();
      // Narrowed to no provider: nothing in this build can download a CLI.
      return clone(runtimeSnapshot);
    },
    cancel: async (provider) => {
      if (!isManagedRuntimeProvider(provider)) refuseDownload();
      return clone(runtimeSnapshot);
    },
    onEvent: (listener) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  };

  return {
    providerRuntimes,
    dispose: () => {
      runtimeListeners.clear();
    },
  };
}
