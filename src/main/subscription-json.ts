import { isDynamicRecord } from "@openbot/contracts/runtime-values";

export type PluginJsonValue = string | number | boolean | null | PluginJsonObject | PluginJsonValue[];
export interface PluginJsonObject {
  [key: string]: PluginJsonValue;
}

/** Normalize external plugin JSON once; functions, undefined and non-finite values are discarded. */
export function pluginJson(value: unknown): PluginJsonValue {
  if (typeof value === "string" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(pluginJson);
  if (isDynamicRecord(value)) {
    const result: PluginJsonObject = {};
    for (const [key, item] of Object.entries(value)) result[key] = pluginJson(item);
    return result;
  }
  return null;
}

export function pluginRecord(value: unknown): PluginJsonObject {
  const parsed = pluginJson(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
