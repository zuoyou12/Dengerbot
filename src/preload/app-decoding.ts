// What main answers for the app shell, the updater, notifications, voice, exports,
// custom providers and remote desktop.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  AGENT_DEFAULT_KEYS,
  type AgentDefaults,
  type AgentMemoryLimitPreference,
  type AnalyticsPreference,
  type AppAppearancePreference,
  type AppBehaviorPreference,
  type AppInfo,
  type AppInterfaceSizePreference,
  type AppLanguagePreference,
  type AppLogoColorPreference,
  type ApprovalAutomationPreference,
  type AppSetupState,
  type BitwardenConnectorStatus,
  type BusyMessageModePreference,
  type ChatWindowTarget,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_AGENT_DEFAULTS,
  type DetectedModelServer,
  type DiscoverModelsResult,
  decodeExternalLinkTarget,
  decodeScheduledUpdateRestart,
  type ExportResult,
  type ExternalLinkBrowser,
  type ExternalLinkBrowsers,
  type ExternalLinkFallback,
  type ExternalLinkPreference,
  type GitHubConnectorRepositories,
  type GitHubConnectorStatus,
  IDLE_RESTART_TARGETS,
  type IdleRestart,
  isAgentMemoryLimit,
  isAgentModel,
  isAgentProvider,
  isAppAppearance,
  isAppInterfaceSize,
  isAppLanguage,
  isAppLogoColor,
  isApprovalAutomationPreference,
  isBusyMessageMode,
  isCustomProviderResult,
  isCustomProviderSummary,
  isDetectedModelServer,
  isDiscoverModelsResult,
  isProviderDetectionSettings,
  isRemoteDesktopSetupStatus,
  isRemoteDesktopTestStatus,
  isRemoteNetworkRoute,
  isSpeechVoice,
  isVoiceLanguage,
  isVoiceModelId,
  type NotificationOpenedEvent,
  type NotificationPreference,
  type OnePasswordConnectorStatus,
  type ProviderDetectionSettings,
  type TestProviderApiKeyResult,
  parseGitHubConnectorRepositories,
  parseGitHubConnectorStatus,
  parseOnePasswordConnectorStatus,
  type RemoteDesktopSetupStatus,
  type RemoteDesktopTestStatus,
  type RemoteNetworkRouteState,
  type RemoteSessionReusePreference,
  SPEECH_MODEL_ID,
  type SpeechAudio,
  type SpeechModelStatus,
  type SpeechSettings,
  UPDATE_PHASES,
  type UpdatePreference,
  type UpdateStatus,
  type VoiceModelStatus,
  type VoiceSettings,
  type VoiceStream,
  type VoiceStreamTranscript,
  type VoiceTranscriptionResult,
} from "@openbot/contracts/ipc";
import {
  decodeList,
  decodeRecord,
  emptyDecoder,
  guardedDecoder,
  nullableBoolean,
  nullableNumber,
  nullableString,
  requiredBoolean,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isPluginSlug } from "@openbot/contracts/plugin-links";
import { isBoolean, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeAppInfo(value: unknown): AppInfo {
  const info = decodeRecord(value, "app info");
  const { platform, variant, analyticsCaptureUrl } = info;
  if (!isOneOf(["darwin", "win32", "linux"] as const, platform)) throw new Error("Invalid platform.");
  if (!isOneOf(["production", "dev", "preview"] as const, variant)) throw new Error("Invalid variant.");
  if (analyticsCaptureUrl !== undefined && !isString(analyticsCaptureUrl))
    throw new Error("Invalid analytics capture URL.");
  return {
    name: requiredString(info, "name"),
    version: requiredString(info, "version"),
    platform,
    variant,
    ...(analyticsCaptureUrl === undefined ? {} : { analyticsCaptureUrl }),
  };
}

export function decodeAppSetupState(value: unknown): AppSetupState {
  const state = decodeRecord(value, "setup state");
  const { preferredProvider, preferredModel } = state;
  if (preferredProvider !== null && !isAgentProvider(preferredProvider)) throw new Error("Invalid preferredProvider.");
  if (preferredModel !== null && !isAgentModel(preferredModel)) throw new Error("Invalid preferredModel.");
  return { completed: requiredBoolean(state, "completed"), preferredProvider, preferredModel };
}

export function decodeAnalyticsPreference(value: unknown): AnalyticsPreference {
  return { enabled: requiredBoolean(decodeRecord(value, "analytics preference"), "enabled") };
}

export const decodeApprovalAutomationPreference: (value: unknown) => ApprovalAutomationPreference = guardedDecoder(
  isApprovalAutomationPreference,
  "approval automation preference",
);

export function decodeBusyMessageModePreference(value: unknown): BusyMessageModePreference {
  const preference = decodeRecord(value, "busy message mode preference");
  if (!isBusyMessageMode(preference.mode)) throw new Error("Invalid busy message mode.");
  return { mode: preference.mode };
}

export function decodeAgentDefaults(value: unknown): AgentDefaults {
  const defaults = decodeRecord(value, "agent defaults");
  const decoded = { ...DEFAULT_AGENT_DEFAULTS };
  for (const key of AGENT_DEFAULT_KEYS) decoded[key] = requiredBoolean(defaults, key);
  return decoded;
}

export function decodeAgentMemoryLimitPreference(value: unknown): AgentMemoryLimitPreference {
  const preference = decodeRecord(value, "agent memory limit preference");
  if (!isAgentMemoryLimit(preference.limit)) throw new Error("Invalid agent memory limit.");
  return { limit: preference.limit };
}

export function decodeAppLanguagePreference(value: unknown): AppLanguagePreference {
  const preference = decodeRecord(value, "language preference");
  if (!isAppLanguage(preference.language)) throw new Error("Invalid language.");
  return { language: preference.language };
}

export function decodeAppLogoColorPreference(value: unknown): AppLogoColorPreference {
  const preference = decodeRecord(value, "logo color preference");
  if (!isAppLogoColor(preference.color)) throw new Error("Invalid logo color.");
  return { color: preference.color };
}

export function decodeAppAppearancePreference(value: unknown): AppAppearancePreference {
  const preference = decodeRecord(value, "appearance preference");
  if (!isAppAppearance(preference.appearance)) throw new Error("Invalid appearance.");
  if (typeof preference.transparentWindow !== "boolean") throw new Error("Invalid transparent window.");
  return { appearance: preference.appearance, transparentWindow: preference.transparentWindow };
}

export function decodeAppInterfaceSizePreference(value: unknown): AppInterfaceSizePreference {
  const preference = decodeRecord(value, "interface size preference");
  if (!isAppInterfaceSize(preference.percent)) throw new Error("Invalid interface size.");
  return { percent: preference.percent };
}

export function decodeChatWindowTargets(value: unknown): ChatWindowTarget[] {
  if (!Array.isArray(value)) throw new Error("Invalid chat windows.");
  return value.map((item) => {
    const target = decodeRecord(item, "chat window");
    if (!isString(target.serverId) || !isString(target.agentId)) throw new Error("Invalid chat window.");
    return { serverId: target.serverId, agentId: target.agentId };
  });
}

export function decodeReleaseText(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000_000) throw new Error("Invalid release data.");
  return value;
}

export function decodeUpdateStatus(value: unknown): UpdateStatus {
  const status = decodeRecord(value, "update status");
  const { phase, errorCode, managedByHost, scheduledRestart, idleRestart } = status;
  if (!isOneOf(UPDATE_PHASES, phase)) throw new Error("Invalid phase.");
  if (errorCode !== null && !isOneOf(["check_failed", "download_failed", "install_failed"] as const, errorCode)) {
    throw new Error("Invalid errorCode.");
  }
  if (managedByHost !== undefined && !isBoolean(managedByHost)) throw new Error("Invalid managedByHost.");
  return {
    phase,
    currentVersion: requiredString(status, "currentVersion"),
    availableVersion: nullableString(status, "availableVersion"),
    progress: nullableNumber(status, "progress"),
    checkedAt: nullableString(status, "checkedAt"),
    message: nullableString(status, "message"),
    errorCode,
    ...(managedByHost === undefined ? {} : { managedByHost }),
    ...(scheduledRestart === undefined ? {} : { scheduledRestart: decodeScheduledUpdateRestart(scheduledRestart) }),
    ...(idleRestart === undefined ? {} : { idleRestart: decodeIdleRestart(idleRestart) }),
  };
}

function decodeIdleRestart(value: unknown): IdleRestart {
  const restart = decodeRecord(value, "idle restart");
  const { target, waitingFor, error } = restart;
  if (!isOneOf(IDLE_RESTART_TARGETS, target)) throw new Error("Invalid target.");
  if (!Array.isArray(waitingFor) || !waitingFor.every(isString)) throw new Error("Invalid waitingFor.");
  if (error !== undefined && !isString(error)) throw new Error("Invalid error.");
  return { target, waitingFor: [...waitingFor], ...(error === undefined ? {} : { error }) };
}

export function decodeUpdatePreference(value: unknown): UpdatePreference {
  const preference = decodeRecord(value, "update preference");
  return {
    autoDownload: requiredBoolean(preference, "autoDownload"),
    allowRemoteUpdates: requiredBoolean(preference, "allowRemoteUpdates"),
    autoInstall: requiredBoolean(preference, "autoInstall"),
  };
}

export function decodeAppBehaviorPreference(value: unknown): AppBehaviorPreference {
  const preference = decodeRecord(value, "app behavior preference");
  return {
    launchAtLogin: nullableBoolean(preference, "launchAtLogin"),
    keepRunningInBackground: nullableBoolean(preference, "keepRunningInBackground"),
    keepAwake: nullableBoolean(preference, "keepAwake"),
    keepAwakeOnBattery: nullableBoolean(preference, "keepAwakeOnBattery"),
  };
}

export function decodeExternalLinkPreference(value: unknown): ExternalLinkPreference {
  const target = decodeExternalLinkTarget(decodeRecord(value, "external link preference").target);
  if (!target) throw new Error("Invalid external link target.");
  return { target };
}

function decodeExternalLinkBrowser(value: unknown): ExternalLinkBrowser {
  const browser = decodeRecord(value, "browser");
  return { name: requiredString(browser, "name"), path: requiredString(browser, "path") };
}

export function decodeExternalLinkBrowserOrNull(value: unknown): ExternalLinkBrowser | null {
  return value === null ? null : decodeExternalLinkBrowser(value);
}

export function decodeExternalLinkBrowsers(value: unknown): ExternalLinkBrowsers {
  const list = decodeRecord(value, "browser list");
  if (!Array.isArray(list.browsers)) throw new Error("Invalid browser list.");
  return {
    defaultBrowser: decodeExternalLinkBrowserOrNull(list.defaultBrowser),
    browsers: list.browsers.map(decodeExternalLinkBrowser),
  };
}

export function decodeExternalLinkFallback(value: unknown): ExternalLinkFallback {
  return { name: requiredString(decodeRecord(value, "external link fallback"), "name") };
}

export function decodeRemoteSessionReusePreference(value: unknown): RemoteSessionReusePreference {
  return {
    keepBetweenRuns: requiredBoolean(decodeRecord(value, "remote session preference"), "keepBetweenRuns"),
  };
}

export function decodeRemoteNetworkRouteState(value: unknown): RemoteNetworkRouteState {
  const state = decodeRecord(value, "remote network route");
  if (!isRemoteNetworkRoute(state.route)) throw new Error("Invalid remote network route.");
  return { route: state.route, tailscaleConnected: requiredBoolean(state, "tailscaleConnected") };
}

export function decodeNotificationPreference(value: unknown): NotificationPreference {
  const preference = decodeRecord(value, "notification preference");
  return {
    desktopNotifications: requiredBoolean(preference, "desktopNotifications"),
    messagePreview: requiredBoolean(preference, "messagePreview"),
  };
}

export function decodeNotificationOpenedEvent(value: unknown): NotificationOpenedEvent {
  const opened = decodeRecord(value, "opened notification");
  return {
    serverId: requiredString(opened, "serverId"),
    agentId: requiredString(opened, "agentId"),
    threadId: nullableString(opened, "threadId"),
    ...(opened.channelId === undefined ? {} : { channelId: requiredString(opened, "channelId") }),
  };
}

const VOICE_MODEL_PHASES: readonly VoiceModelStatus["phase"][] = ["missing", "downloading", "ready", "error"];

export function decodeVoiceModelStatus(value: unknown): VoiceModelStatus {
  const status = decodeRecord(value, "voice model status");
  const { modelId, phase, progress } = status;
  if (!isVoiceModelId(modelId) || !isOneOf(VOICE_MODEL_PHASES, phase) || (progress !== null && !isNumber(progress))) {
    throw new Error("Invalid voice model status.");
  }
  return { modelId, phase, progress, message: nullableString(status, "message") };
}

export function decodeVoiceModelStatuses(value: unknown): VoiceModelStatus[] {
  return decodeList(value, "voice model status list", decodeVoiceModelStatus);
}

export function decodeVoiceSettings(value: unknown): VoiceSettings {
  const { modelId, language } = decodeRecord(value, "voice settings");
  if (!isVoiceModelId(modelId) || !isVoiceLanguage(language)) throw new Error("Invalid voice settings.");
  return { modelId, language };
}

export function decodeVoiceTranscriptionResult(value: unknown): VoiceTranscriptionResult {
  return { text: requiredString(decodeRecord(value, "voice transcription"), "text") };
}

export function decodeVoiceStream(value: unknown): VoiceStream {
  return { streamId: requiredString(decodeRecord(value, "voice stream"), "streamId") };
}

export function decodeVoiceStreamTranscript(value: unknown): VoiceStreamTranscript {
  const transcript = decodeRecord(value, "voice stream transcript");
  return { streamId: requiredString(transcript, "streamId"), text: requiredString(transcript, "text") };
}

export function decodeSpeechModelStatus(value: unknown): SpeechModelStatus {
  const status = decodeRecord(value, "speech model status");
  const { modelId, phase, progress } = status;
  if (
    modelId !== SPEECH_MODEL_ID ||
    !isOneOf(VOICE_MODEL_PHASES, phase) ||
    (progress !== null && !isNumber(progress))
  ) {
    throw new Error("Invalid speech model status.");
  }
  return { modelId, phase, progress, message: nullableString(status, "message") };
}

export function decodeSpeechSettings(value: unknown): SpeechSettings {
  const settings = decodeRecord(value, "speech settings");
  const { voice } = settings;
  if (!isSpeechVoice(voice)) throw new Error("Invalid speech settings.");
  return { readReplies: requiredBoolean(settings, "readReplies"), voice };
}

export function decodeSpeechAudio(value: unknown): SpeechAudio {
  const audio = decodeRecord(value, "speech audio");
  const { pcm, sampleRate } = audio;
  if (!(pcm instanceof Uint8Array) || pcm.byteLength % 2 !== 0 || !isNumber(sampleRate) || sampleRate <= 0) {
    throw new Error("Invalid speech audio.");
  }
  return { pcm, sampleRate };
}

export function decodeExportResult(value: unknown): ExportResult {
  return { saved: requiredBoolean(decodeRecord(value, "export result"), "saved") };
}

// The slug is checked again on arrival rather than trusted because it came from main. It began life
// in a URL a web page chose, and this is the last point before the renderer looks it up.
export function decodePendingListing(value: unknown): string | null {
  return typeof value === "string" && isPluginSlug(value) ? value : null;
}

/** The export skill's text, shown for the user to copy. It is Markdown, never markup. */
export function decodeAgentImportSkill(value: unknown): string {
  if (!isString(value) || !value) throw new Error("Invalid export skill response.");
  return value;
}

export const decodeVoid = emptyDecoder("IPC returned unexpected data.");

export function decodeGitHubConnectorStatus(value: unknown): GitHubConnectorStatus {
  const status = parseGitHubConnectorStatus(value);
  if (!status) throw new Error("Invalid GitHub connector response.");
  return status;
}

export function decodeGitHubConnectorRepositories(value: unknown): GitHubConnectorRepositories {
  const repositories = parseGitHubConnectorRepositories(value);
  if (!repositories) throw new Error("Invalid GitHub repository list response.");
  return repositories;
}

export function decodeOnePasswordConnectorStatus(value: unknown): OnePasswordConnectorStatus {
  const status = parseOnePasswordConnectorStatus(value);
  if (!status) throw new Error("Invalid 1Password connector response.");
  return status;
}

/**
 * The guard, not a decoder of its own: it is the assertion that a summary carries no `apiKey`, and a
 * second implementation here could disagree with it. It fails closed on the whole list, so a main
 * process that ever put a key in a row empties the picker rather than leaking one.
 */
export function decodeCustomProviders(value: unknown): CustomProviderSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomProviderSummary)) {
    throw new Error("Invalid custom provider list response.");
  }
  return value;
}

export function decodeCustomProviderResult(value: unknown): CustomProviderResult {
  if (!isCustomProviderResult(value)) throw new Error("Invalid custom provider response.");
  return value;
}

/** Fails closed on the whole list, like `decodeCustomProviders`: a scan row never carries a key. */
export function decodeDetectedModelServers(value: unknown): DetectedModelServer[] {
  if (!Array.isArray(value) || !value.every(isDetectedModelServer)) {
    throw new Error("Invalid model server list response.");
  }
  return value;
}

export function decodeDiscoverModelsResult(value: unknown): DiscoverModelsResult {
  if (!isDiscoverModelsResult(value)) throw new Error("Invalid model list response.");
  return value;
}

export function decodeProviderDetectionSettings(value: unknown): ProviderDetectionSettings {
  if (!isProviderDetectionSettings(value)) throw new Error("Invalid detection settings response.");
  return value;
}

export function decodeNullablePath(value: unknown): string | null {
  if (value !== null && !isString(value)) throw new Error("Invalid directory response.");
  return value;
}

export function decodeRemoteDesktopSetupFromMain(value: unknown): RemoteDesktopSetupStatus {
  if (!isRemoteDesktopSetupStatus(value)) throw new Error("Invalid remote desktop setup response.");
  return { ...value };
}
export function decodeRemoteDesktopTestFromMain(value: unknown): RemoteDesktopTestStatus {
  if (!isRemoteDesktopTestStatus(value)) throw new Error("Invalid remote desktop test response.");
  return { ...value };
}

export function decodeBitwardenConnectorStatus(value: unknown): BitwardenConnectorStatus {
  if (
    !value ||
    typeof value !== "object" ||
    !("connected" in value) ||
    !isBoolean(value.connected) ||
    !("connecting" in value) ||
    !isBoolean(value.connecting) ||
    !("serverUrl" in value) ||
    !(value.serverUrl === null || isString(value.serverUrl)) ||
    !("error" in value) ||
    !(value.error === null || isString(value.error))
  )
    throw new Error("Invalid Bitwarden connector response.");
  return { connected: value.connected, connecting: value.connecting, serverUrl: value.serverUrl, error: value.error };
}

export function decodeTestProviderApiKeyResult(value: unknown): TestProviderApiKeyResult {
  const record = decodeRecord(value, "test provider API key");
  const ok = requiredBoolean(record, "ok");
  if (ok) {
    if (!Array.isArray(record.models) || !record.models.every(isString)) {
      throw new Error("Invalid models list in test provider API key response.");
    }
    return { ok: true, models: record.models };
  }
  return { ok: false, error: requiredString(record, "error") };
}
