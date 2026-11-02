import type { CustomProviderHeader, CustomProviderModel } from "@openbot/contracts/ipc";

/**
 * A saved endpoint or an internally managed subscription endpoint consumed by DSH.
 */
export interface CustomProviderConfig {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  /** Native subscription transport protocol. User-defined endpoints use OpenAI completions. */
  readonly api?: "openai-completions" | "openai-responses" | "anthropic-messages";
  readonly apiKey: string | null;
  readonly models: readonly CustomProviderModel[];
  readonly headers: readonly CustomProviderHeader[];
}

/** Read at spawn, never captured. A getter because the endpoint list can change while the app runs. */
export type CustomProviderSource = () => readonly CustomProviderConfig[];
