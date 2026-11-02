/**
 * The local gateway: one OpenAI-compatible endpoint on 127.0.0.1 that proxies the app's own DeepSeek
 * key and custom endpoints to other tools. It proxies only credentials the user already configured;
 * it never reaches an upstream the app would not reach on its own.
 */
export interface LocalGatewaySourceStatus {
  id: string;
  name: string;
  models: number;
  configured: boolean;
}

export interface LocalGatewayStatus {
  enabled: boolean;
  running: boolean;
  url: string | null;
  token: string | null;
  port: number;
  sources: readonly LocalGatewaySourceStatus[];
  requests: number;
  errors: number;
}

export interface LocalGatewayEnabledInput {
  enabled: boolean;
}

export interface LocalGatewayPortInput {
  port: number;
}

export interface ConnectedAgentInfo {
  id: string;
  name: string;
  installed: boolean;
  wired: boolean;
  configPath: string;
  description: string;
}

export interface WireAgentInput {
  agentId: string;
  enabled: boolean;
}

export interface ExternalProviderInfo {
  id: string;
  name: string;
  detected: boolean;
  account?: string;
  status: string;
  models: readonly string[];
  enabled: boolean;
  configuredKey?: boolean;
  requiresManualKey?: boolean;
}

export interface SetExternalProviderInput {
  providerId: string;
  enabled: boolean;
  apiKey?: string;
}
