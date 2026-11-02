import type { SubscriptionPluginListing } from "./subscription-catalog";

/** Subscription credentials and plugin request headers never cross this interface. */
export interface SubscriptionModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  reasoning?: boolean;
  image?: boolean;
  creditRate?: number;
}

export interface SubscriptionLoginMethod {
  index: number;
  type: "oauth" | "api";
  label: string;
}

export interface SubscriptionPrompt {
  key: string;
  type: "text" | "select";
  message: string;
  placeholder?: string;
  secret?: boolean;
  options?: readonly { label: string; value: string; hint?: string }[];
}

export interface SubscriptionUsage {
  plan?: string;
  user?: string;
  balance?: string;
  windows: readonly {
    label: string;
    used?: number;
    limit?: number;
    remaining?: number;
    unit?: string;
    resetsAt?: string;
  }[];
  error?: string;
}

export interface SubscriptionOption {
  key: string;
  label: string;
  type: "text" | "select" | "boolean" | "number";
  value?: string | number | boolean;
  options?: readonly { label: string; value: string }[];
  description?: string;
}

export interface SubscriptionAccount {
  id: string;
  label: string;
  models: readonly string[];
  usage?: SubscriptionUsage;
  error?: string;
}

export interface SubscriptionProvider {
  id: string;
  packageName: string;
  name: string;
  signedIn: boolean;
  enabled: boolean;
  methods: readonly SubscriptionLoginMethod[];
  accounts: readonly SubscriptionAccount[];
  models: readonly SubscriptionModel[];
  options: readonly SubscriptionOption[];
  supportsUsage: boolean;
  supportsCheckIn: boolean;
  singleAccount: boolean;
  error?: string;
}

export interface SubscriptionPlugin {
  packageName: string;
  installedVersion: string | null;
  latestVersion?: string | null;
  enabled: boolean;
  error?: string;
}

export interface SubscriptionLogin {
  id: string;
  providerId: string;
  methodIndex: number;
  status: "input" | "waiting" | "connected" | "error" | "cancelled";
  prompt?: SubscriptionPrompt;
  url?: string;
  code?: string;
  instructions?: string;
  manualCode?: boolean;
  error?: string;
}

export interface SubscriptionState {
  catalog?: readonly SubscriptionPluginListing[];
  runtimeAvailable: boolean;
  runtimeError?: string;
  plugins: readonly SubscriptionPlugin[];
  providers: readonly SubscriptionProvider[];
  logins: readonly SubscriptionLogin[];
  domesticMirror: boolean;
}

export interface SubscriptionPackageInput {
  packageName: string;
}
export interface SubscriptionEnabledInput extends SubscriptionPackageInput {
  enabled: boolean;
}
export interface SubscriptionRefreshInput {
  checkUpdates?: boolean;
  discover?: boolean;
  query?: string;
}
export interface SubscriptionPreferencesInput {
  domesticMirror: boolean;
}
export interface SubscriptionAccountInput {
  providerId: string;
  accountId?: string;
}
export interface SubscriptionStartLoginInput extends SubscriptionAccountInput {
  methodIndex: number;
  inputs?: Readonly<Record<string, string>>;
  apiKey?: string;
}
export interface SubscriptionSubmitLoginInput {
  loginId: string;
  value: string;
}
export interface SubscriptionCancelLoginInput {
  loginId: string;
}
export interface SubscriptionOptionsInput extends SubscriptionAccountInput {
  values: Readonly<Record<string, string | number | boolean>>;
}
