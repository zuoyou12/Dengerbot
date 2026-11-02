import type {
  SubscriptionAccountInput,
  SubscriptionCancelLoginInput,
  SubscriptionEnabledInput,
  SubscriptionOptionsInput,
  SubscriptionPackageInput,
  SubscriptionPreferencesInput,
  SubscriptionRefreshInput,
  SubscriptionStartLoginInput,
  SubscriptionSubmitLoginInput,
} from "@openbot/contracts/ipc-subscriptions";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { requireString } from "./validation";

const reserved = new Set(["__proto__", "constructor", "prototype"]);
function record(value: unknown) {
  if (!isDynamicRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error("Invalid subscription input.");
  if (Object.keys(value).some((key) => reserved.has(key))) throw new Error("Invalid subscription input key.");
  return value;
}
function identifier(value: unknown, field: string, max = 256): string {
  const text = requireString(value, field, max);
  if (reserved.has(text) || !/^[a-zA-Z0-9][a-zA-Z0-9._:#@/-]*$/u.test(text)) throw new Error(`Invalid ${field}.`);
  return text;
}
function flag(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid subscription flag.");
  return value;
}
function method(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 63)
    throw new Error("Invalid subscription login method.");
  return value;
}
function fields(value: unknown): Readonly<Record<string, string>> {
  const source = record(value);
  if (Object.keys(source).length > 64) throw new Error("Too many subscription inputs.");
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(source)) {
    identifier(key, "subscription input key", 128);
    if (typeof entry !== "string" || entry.length > 16_384) throw new Error("Invalid subscription input value.");
    result[key] = entry;
  }
  return result;
}
export function parseSubscriptionPackage(value: unknown): SubscriptionPackageInput {
  const source = record(value);
  const packageName = requireString(source.packageName, "packageName", 214);
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(packageName) || reserved.has(packageName))
    throw new Error("Invalid subscription package name.");
  return { packageName };
}
export function parseSubscriptionEnabled(value: unknown): SubscriptionEnabledInput {
  return { ...parseSubscriptionPackage(value), enabled: flag(record(value).enabled) };
}
export function parseSubscriptionRefresh(value: unknown): SubscriptionRefreshInput {
  const source = record(value);
  if (source.query !== undefined && (typeof source.query !== "string" || source.query.length > 256))
    throw new Error("Invalid subscription search query.");
  return {
    ...(source.checkUpdates === undefined ? {} : { checkUpdates: flag(source.checkUpdates) }),
    ...(source.discover === undefined ? {} : { discover: flag(source.discover) }),
    ...(typeof source.query === "string" ? { query: source.query.trim() } : {}),
  };
}
export function parseSubscriptionPreferences(value: unknown): SubscriptionPreferencesInput {
  return { domesticMirror: flag(record(value).domesticMirror) };
}
export function parseSubscriptionAccount(value: unknown): SubscriptionAccountInput {
  const source = record(value);
  return {
    providerId: identifier(source.providerId, "providerId", 128),
    ...(source.accountId === undefined ? {} : { accountId: identifier(source.accountId, "accountId") }),
  };
}
export function parseSubscriptionStartLogin(value: unknown): SubscriptionStartLoginInput {
  const source = record(value);
  return {
    ...parseSubscriptionAccount(value),
    methodIndex: method(source.methodIndex),
    ...(source.inputs === undefined ? {} : { inputs: fields(source.inputs) }),
    ...(source.apiKey === undefined ? {} : { apiKey: requireString(source.apiKey, "apiKey", 16_384) }),
  };
}
export function parseSubscriptionSubmitLogin(value: unknown): SubscriptionSubmitLoginInput {
  const source = record(value);
  if (typeof source.value !== "string" || source.value.length > 16_384)
    throw new Error("Invalid subscription login value.");
  return { loginId: identifier(source.loginId, "loginId"), value: source.value };
}
export function parseSubscriptionCancelLogin(value: unknown): SubscriptionCancelLoginInput {
  return { loginId: identifier(record(value).loginId, "loginId") };
}
export function parseSubscriptionOptions(value: unknown): SubscriptionOptionsInput {
  const source = record(value);
  const values = record(source.values);
  if (Object.keys(values).length > 64) throw new Error("Too many subscription options.");
  const result: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(values)) {
    identifier(key, "subscription option key", 128);
    if (
      (typeof entry === "string" && entry.length <= 4096) ||
      typeof entry === "boolean" ||
      (typeof entry === "number" && Number.isFinite(entry) && Math.abs(entry) <= 1e12)
    )
      result[key] = entry;
    else throw new Error("Invalid subscription option value.");
  }
  return { ...parseSubscriptionAccount(value), values: result };
}
