import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";

/**
 * What provider state reaches in main: connecting, signing in and refreshing providers, and the
 * runtimes OpenBot installs for them, on this computer or on a host the account administers.
 */
export interface ProvidersPort {
  connectProvider: OpenBotDesktopApi["connectProvider"];
  cancelProviderSignIn: OpenBotDesktopApi["cancelProviderSignIn"];
  refreshAgentProviders: OpenBotDesktopApi["refreshAgentProviders"];
  setProviderOn: OpenBotDesktopApi["setProviderOn"];
  restartProvider: OpenBotDesktopApi["restartProvider"];
  cancelProviderRestart: OpenBotDesktopApi["cancelProviderRestart"];
  providerRuntimes: OpenBotDesktopApi["providerRuntimes"];
  renameProviderAccount: OpenBotDesktopApi["renameProviderAccount"];
  removeProviderAccount: OpenBotDesktopApi["removeProviderAccount"];
  providerUsageResets: OpenBotDesktopApi["providerUsageResets"];
  resetProviderUsage: OpenBotDesktopApi["resetProviderUsage"];
  /** The same, for the host of a joined server the account administers. */
  providerAdmin: OpenBotDesktopApi["providerAdmin"];
}

/** Read on each call: tests and stories replace `window.openbot` per case. */
export function providersPort(): ProvidersPort {
  return window.openbot;
}
