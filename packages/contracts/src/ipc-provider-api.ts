import type { AgentProviderId } from "./agent-providers";
import { isAgentProvider } from "./agent-providers";
import { isDynamicRecord, isString } from "./runtime-values";

export interface TestProviderApiKeyInput {
  provider: AgentProviderId;
  key: string;
}

export type TestProviderApiKeyResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string };

export function isTestProviderApiKeyInput(value: unknown): value is TestProviderApiKeyInput {
  return (
    isDynamicRecord(value) &&
    isAgentProvider(value.provider) &&
    isString(value.key) &&
    value.key.trim().length > 0
  );
}

export interface ProviderIpcApi {
  testProviderApiKey: (input: TestProviderApiKeyInput) => Promise<TestProviderApiKeyResult>;
}
