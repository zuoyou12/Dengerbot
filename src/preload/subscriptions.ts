import type {
  SubscriptionAccount,
  SubscriptionLogin,
  SubscriptionLoginMethod,
  SubscriptionModel,
  SubscriptionOption,
  SubscriptionPlugin,
  SubscriptionPrompt,
  SubscriptionProvider,
  SubscriptionState,
  SubscriptionUsage,
} from "@openbot/contracts/ipc-subscriptions";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { isSubscriptionPackageName, type SubscriptionPluginListing } from "@openbot/contracts/subscription-catalog";

function invalid(): never {
  throw new Error("Invalid subscription state.");
}
function record(value: unknown): DynamicRecord {
  if (!isDynamicRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  if (Object.keys(value).some((key) => ["__proto__", "prototype", "constructor"].includes(key))) return invalid();
  return value;
}
function text(value: unknown, max = 16_384): string {
  return typeof value === "string" && value.length <= max ? value : invalid();
}
function optionalText(value: unknown): string | undefined {
  return value === undefined ? undefined : text(value);
}
function flag(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalid();
}
function number(value: unknown, integer = false): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1e15 &&
    (!integer || Number.isInteger(value))
    ? value
    : invalid();
}
function optionalNumber(value: unknown): number | undefined {
  return value === undefined ? undefined : number(value);
}
function optionalFlag(value: unknown): boolean | undefined {
  return value === undefined ? undefined : flag(value);
}
function list<T>(value: unknown, decode: (entry: unknown) => T, max = 2048): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value.map(decode);
}
function loginMethod(value: unknown): SubscriptionLoginMethod {
  const source = record(value);
  const index = number(source.index, true);
  if (index < 0 || index > 63 || (source.type !== "oauth" && source.type !== "api")) return invalid();
  return { index, type: source.type, label: text(source.label, 1024) };
}
function prompt(value: unknown): SubscriptionPrompt {
  const source = record(value);
  if (source.type !== "text" && source.type !== "select") return invalid();
  return {
    key: text(source.key, 128),
    type: source.type,
    message: text(source.message),
    placeholder: optionalText(source.placeholder),
    secret: optionalFlag(source.secret),
    options:
      source.options === undefined
        ? undefined
        : list(
            source.options,
            (entry) => {
              const option = record(entry);
              return { label: text(option.label), value: text(option.value), hint: optionalText(option.hint) };
            },
            256,
          ),
  };
}
function usage(value: unknown): SubscriptionUsage {
  const source = record(value);
  return {
    plan: optionalText(source.plan),
    user: optionalText(source.user),
    balance: optionalText(source.balance),
    error: optionalText(source.error),
    windows: list(
      source.windows,
      (entry) => {
        const window = record(entry);
        return {
          label: text(window.label),
          used: optionalNumber(window.used),
          limit: optionalNumber(window.limit),
          remaining: optionalNumber(window.remaining),
          unit: optionalText(window.unit),
          resetsAt: optionalText(window.resetsAt),
        };
      },
      128,
    ),
  };
}
function model(value: unknown): SubscriptionModel {
  const source = record(value);
  return {
    id: text(source.id, 512),
    name: text(source.name, 1024),
    contextWindow: optionalNumber(source.contextWindow),
    maxOutputTokens: optionalNumber(source.maxOutputTokens),
    reasoning: optionalFlag(source.reasoning),
    image: optionalFlag(source.image),
    creditRate: optionalNumber(source.creditRate),
  };
}
function account(value: unknown): SubscriptionAccount {
  const source = record(value);
  return {
    id: text(source.id, 256),
    label: text(source.label, 1024),
    models: list(source.models, (entry) => text(entry, 512), 8192),
    usage: source.usage === undefined ? undefined : usage(source.usage),
    error: optionalText(source.error),
  };
}
function option(value: unknown): SubscriptionOption {
  const source = record(value);
  if (source.type !== "text" && source.type !== "select" && source.type !== "boolean" && source.type !== "number")
    return invalid();
  const ownValue = source.value;
  if (
    ownValue !== undefined &&
    typeof ownValue !== "string" &&
    typeof ownValue !== "number" &&
    typeof ownValue !== "boolean"
  )
    return invalid();
  return {
    key: text(source.key, 128),
    label: text(source.label, 1024),
    type: source.type,
    value: typeof ownValue === "number" ? number(ownValue) : typeof ownValue === "string" ? text(ownValue) : ownValue,
    description: optionalText(source.description),
    options:
      source.options === undefined
        ? undefined
        : list(
            source.options,
            (entry) => {
              const choice = record(entry);
              return { label: text(choice.label), value: text(choice.value) };
            },
            256,
          ),
  };
}
function provider(value: unknown): SubscriptionProvider {
  const source = record(value);
  return {
    id: text(source.id, 128),
    packageName: text(source.packageName, 214),
    name: text(source.name, 1024),
    signedIn: flag(source.signedIn),
    enabled: flag(source.enabled),
    supportsUsage: flag(source.supportsUsage),
    supportsCheckIn: flag(source.supportsCheckIn),
    singleAccount: flag(source.singleAccount),
    methods: list(source.methods, loginMethod, 64),
    accounts: list(source.accounts, account, 128),
    models: list(source.models, model, 8192),
    options: list(source.options, option, 128),
    error: optionalText(source.error),
  };
}
function plugin(value: unknown): SubscriptionPlugin {
  const source = record(value);
  return {
    packageName: text(source.packageName, 214),
    installedVersion: source.installedVersion === null ? null : text(source.installedVersion, 160),
    latestVersion:
      source.latestVersion === undefined || source.latestVersion === null
        ? source.latestVersion
        : text(source.latestVersion, 160),
    enabled: flag(source.enabled),
    error: optionalText(source.error),
  };
}
function login(value: unknown): SubscriptionLogin {
  const source = record(value);
  const status = source.status;
  if (
    status !== "input" &&
    status !== "waiting" &&
    status !== "connected" &&
    status !== "error" &&
    status !== "cancelled"
  )
    return invalid();
  const methodIndex = number(source.methodIndex, true);
  if (methodIndex < 0 || methodIndex > 63) return invalid();
  const url = optionalText(source.url);
  if (url !== undefined) {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return invalid();
    }
    if (
      (target.protocol !== "https:" &&
        !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) ||
      target.username ||
      target.password
    )
      return invalid();
  }
  return {
    id: text(source.id, 256),
    providerId: text(source.providerId, 128),
    methodIndex,
    status,
    prompt: source.prompt === undefined ? undefined : prompt(source.prompt),
    url,
    code: optionalText(source.code),
    instructions: optionalText(source.instructions),
    manualCode: optionalFlag(source.manualCode),
    error: optionalText(source.error),
  };
}
function listing(value: unknown): SubscriptionPluginListing {
  const source = record(value);
  if (!isSubscriptionPackageName(source.packageName)) return invalid();
  const description = record(source.description);
  return {
    id: text(source.id, 214),
    name: text(source.name, 256),
    packageName: source.packageName,
    icon: text(source.icon, 64),
    providerIds: list(source.providerIds, (entry) => text(entry, 128), 64),
    description: { en: text(description.en, 4096), zh: text(description.zh, 4096) },
    community: flag(source.community),
  };
}
/** Rebuild only documented public fields; plugin credentials and arbitrary nested values cannot cross. */
export function decodeSubscriptionState(value: unknown): SubscriptionState {
  const source = record(value);
  return {
    catalog: source.catalog === undefined ? undefined : list(source.catalog, listing, 4096),
    runtimeAvailable: flag(source.runtimeAvailable),
    runtimeError: optionalText(source.runtimeError),
    plugins: list(source.plugins, plugin, 4096),
    providers: list(source.providers, provider, 512),
    logins: list(source.logins, login, 128),
    domesticMirror: flag(source.domesticMirror),
  };
}
