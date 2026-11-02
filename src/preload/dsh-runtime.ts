import type { DshRuntimeStatus } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

export function decodeDshRuntimeStatus(value: unknown): DshRuntimeStatus {
  if (
    !isDynamicRecord(value) ||
    !isDynamicRecord(value.active) ||
    !isString(value.active.version) ||
    !isOneOf(["bundled", "installed", "development"] as const, value.active.source) ||
    !Array.isArray(value.installed) ||
    !isBoolean(value.channelConfigured)
  ) {
    throw new Error("Invalid DSH runtime status.");
  }
  const installed = value.installed.map((entry: unknown) => {
    if (!isDynamicRecord(entry) || !isString(entry.version)) throw new Error("Invalid DSH runtime status.");
    return { version: entry.version };
  });
  let latest: { version: string } | null = null;
  if (value.latest !== null) {
    if (!isDynamicRecord(value.latest) || !isString(value.latest.version)) {
      throw new Error("Invalid DSH runtime status.");
    }
    latest = { version: value.latest.version };
  }
  return {
    active: { version: value.active.version, source: value.active.source },
    installed,
    latest,
    channelConfigured: value.channelConfigured,
  };
}
