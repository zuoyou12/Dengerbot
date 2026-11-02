import type {
  ConnectedAgentInfo,
  ExternalProviderInfo,
  LocalGatewaySourceStatus,
  LocalGatewayStatus,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

export function decodeLocalGatewayStatus(value: unknown): LocalGatewayStatus {
  if (
    !isDynamicRecord(value) ||
    !isBoolean(value.enabled) ||
    !isBoolean(value.running) ||
    (value.url !== null && !isString(value.url)) ||
    (value.token !== null && !isString(value.token)) ||
    !isNumber(value.port) ||
    !Array.isArray(value.sources) ||
    !isNumber(value.requests) ||
    !isNumber(value.errors)
  ) {
    throw new Error("Invalid local gateway status.");
  }
  const sources: LocalGatewaySourceStatus[] = value.sources.map((entry: unknown) => {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.name) ||
      !isNumber(entry.models) ||
      !isBoolean(entry.configured)
    ) {
      throw new Error("Invalid local gateway source status.");
    }
    return {
      id: entry.id,
      name: entry.name,
      models: entry.models,
      configured: entry.configured,
    };
  });
  return {
    enabled: value.enabled,
    running: value.running,
    url: value.url,
    token: value.token,
    port: value.port,
    sources,
    requests: value.requests,
    errors: value.errors,
  };
}

export function decodeConnectedAgents(value: unknown): readonly ConnectedAgentInfo[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid connected agents list.");
  }
  return value.map((entry: unknown) => {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.name) ||
      !isBoolean(entry.installed) ||
      !isBoolean(entry.wired) ||
      !isString(entry.configPath) ||
      !isString(entry.description)
    ) {
      throw new Error("Invalid connected agent info.");
    }
    return {
      id: entry.id,
      name: entry.name,
      installed: entry.installed,
      wired: entry.wired,
      configPath: entry.configPath,
      description: entry.description,
    };
  });
}

export function decodeExternalProviders(value: unknown): readonly ExternalProviderInfo[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid external providers list.");
  }
  return value.map((entry: unknown) => {
    if (
      !isDynamicRecord(entry) ||
      !isString(entry.id) ||
      !isString(entry.name) ||
      !isBoolean(entry.detected) ||
      !isString(entry.status) ||
      !Array.isArray(entry.models) ||
      !isBoolean(entry.enabled)
    ) {
      throw new Error("Invalid external provider info.");
    }
    return {
      id: entry.id,
      name: entry.name,
      detected: entry.detected,
      account: typeof entry.account === "string" ? entry.account : undefined,
      status: entry.status,
      models: entry.models.map((m) => String(m)),
      enabled: entry.enabled,
      configuredKey: typeof entry.configuredKey === "boolean" ? entry.configuredKey : undefined,
      requiresManualKey: typeof entry.requiresManualKey === "boolean" ? entry.requiresManualKey : undefined,
    };
  });
}
