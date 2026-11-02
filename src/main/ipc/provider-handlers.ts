import { Effect } from "effect";
// Storing the optional provider API keys, and downloading the CLI
// runtimes the providers need.

import { isManagedRuntimeProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderId,
  type ConnectProviderAccountInput,
  isProviderAccountId,
  PROVIDER_ACCOUNT_LABEL_MAX_LENGTH,
  type RemoveProviderAccountInput,
  type RenameProviderAccountInput,
  type ResetProviderUsageInput,
  type SetProviderApiKeyInput,
  type TestProviderApiKeyResult,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import { probeModels } from "../model-server-probe";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import { parseProviderId } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { optionalPayload, requireString } from "./validation";

/** Long enough for any key a provider issues, short enough that nothing large reaches the cipher. */
const MAX_API_KEY_LENGTH = 512;

export interface ProviderIpcDependencies {
  service: AgentService;
  providerRuntimes: ProviderRuntimeManager;
  credentials: ProviderCredentialStore;
  /** Opens a web page in the program that the user chose in Settings. */
  openLink: (url: string) => Promise<void>;
}

export function providerIpcHandlers({
  service,
  providerRuntimes,
  credentials,
  openLink,
}: ProviderIpcDependencies): Pick<IpcGroupHandlers, "providers" | "providerRuntimes"> {
  return {
    providers: {
      setProviderOn: payloadHandler(parseProviderUseInput, ({ provider, on }) =>
        runCauseEffect(service.setProviderOn(provider, on)),
      ),
      connectProvider: payloadHandler(parseProviderId, async (provider) => {
        await runCauseEffect(providerRuntimes.ensureKeyProviderCli(provider));
        return runCauseEffect(
          service.connectProvider(provider, async (value) => {
            const url = new URL(value);
            if (url.protocol !== "https:") throw new Error(sourceText("error.provider.httpsSignInLinkOnly"));
            await openLink(url.toString());
          }),
        );
      }),
      cancelProviderSignIn: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(service.cancelProviderSignIn(provider)),
      ),
      // No provider CLI is managed in this build, so `parseManagedProviderId` rejects every id.
      updateProviderCli: payloadHandler(parseManagedProviderId, async () => service.getStatus()),
      refreshAgentProviders: payloadHandler(optionalPayload(parseRefreshProvidersInput), (input) =>
        runCauseEffect(service.refreshProviders({ automatic: input?.automatic === true })),
      ),
      restartProvider: payloadHandler(parseProviderId, (provider) => runCauseEffect(service.restartProvider(provider))),
      cancelProviderRestart: payloadHandler(parseProviderId, async (provider) =>
        service.cancelProviderRestart(provider),
      ),
      // The key and the process that uses it change as one step, because the catalog the CLI
      // advertises is decided at spawn time: the service writes the key only when it can restart
      // the provider on it, and reports success only once the new process is up.
      setProviderApiKey: payloadHandler(parseProviderApiKeyInput, async ({ provider, key }) => {
        if (provider === "codex") return signInCodexWithApiKey(service, key);
        await runCauseEffect(providerRuntimes.ensureKeyProviderCli(provider));
        return runCauseEffect(
          service.changeProviderCredential(provider, () =>
            credentials
              .set(provider, key)
              .pipe(
                Effect.mapError(
                  (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                ),
              ),
          ),
        );
      }),
      clearProviderApiKey: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(
          service.clearProviderCredential(provider, () =>
            credentials
              .clear(provider)
              .pipe(
                Effect.mapError(
                  (error) => new AgentLifecycleFailed({ operation: "changeProviderCredential", cause: error.cause }),
                ),
              ),
          ),
        ),
      ),
      renameProviderAccount: payloadHandler(parseRenameProviderAccountInput, ({ provider, accountId, label }) =>
        runCauseEffect(service.renameProviderAccount(provider, accountId, label)),
      ),
      removeProviderAccount: payloadHandler(parseRemoveProviderAccountInput, ({ provider, accountId }) =>
        runCauseEffect(service.removeProviderAccount(provider, accountId)),
      ),
      providerUsageResets: payloadHandler(parseProviderId, (provider) =>
        runCauseEffect(service.providerUsageResets(provider)),
      ),
      resetProviderUsage: payloadHandler(parseResetProviderUsageInput, ({ provider, accountId }) =>
        runCauseEffect(service.resetProviderUsage(provider, accountId)),
      ),
      // A status, never the key: see `setProviderApiKey` in the desktop API contract.
      getProviderApiKeyState: payloadHandler(parseProviderId, async (provider) => ({
        provider,
        status: credentials.status(provider),
      })),
      testProviderApiKey: payloadHandler(
        parseProviderApiKeyInput,
        async ({ provider, key }): Promise<TestProviderApiKeyResult> => {
          if (provider === "deepseek" || provider === "claude" || provider === "codex") {
            try {
              const target =
                provider === "claude"
                  ? {
                      baseUrl: "https://api.anthropic.com/v1",
                      apiKey: null,
                      headers: [
                        { name: "x-api-key", value: key },
                        { name: "anthropic-version", value: "2023-06-01" },
                      ],
                    }
                  : provider === "codex"
                    ? {
                        baseUrl: "https://api.openai.com/v1",
                        apiKey: null,
                        headers: [{ name: "Authorization", value: `Bearer ${key}` }],
                      }
                    : { baseUrl: "https://api.deepseek.com", apiKey: key, headers: [] };
              const models = await Effect.runPromise(probeModels(target, 10_000));
              return { ok: true, models: models.map((m) => m.id) };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return { ok: false, error: message };
            }
          }
          return { ok: false, error: sourceText("error.provider.sessionSettingUnavailable") };
        },
      ),
    },
    providerRuntimes: {
      getStatus: handler(() => providerRuntimes.getStatus()),
      // No provider CLI is managed in this build, so `parseManagedProviderId` rejects every id.
      download: payloadHandler(parseManagedProviderId, () => providerRuntimes.getStatus()),
      cancel: payloadHandler(parseManagedProviderId, () => providerRuntimes.getStatus()),
      checkForUpdates: handler(() => runCauseEffect(providerRuntimes.checkForUpdates())),
    },
  };
}

/**
 * Codex keeps its key in its own login, not in Dengerbot's store, so the store does not register it
 * for redaction. It is registered here, before Codex can echo it in a log line.
 */
export function signInCodexWithApiKey(service: Pick<AgentService, "signInCodexWithApiKey">, key: string) {
  registerSecretValue(key);
  return runCauseEffect(service.signInCodexWithApiKey(key));
}

/**
 * The decoder every provider key passes through before it reaches the operating system's cipher.
 *
 * Exported for the test that holds it to its limits: this is the one place a renderer-supplied
 * secret enters the main process, and each rule here decides what `safeStorage` is asked to keep.
 */
export function parseProviderApiKeyInput(value: unknown): SetProviderApiKeyInput {
  if (!isDynamicRecord(value)) throw new Error(sourceText("error.provider.keyRequired"));
  const provider = parseProviderId(value.provider);
  if (!isString(value.key) || !value.key.trim()) throw new Error(sourceText("error.provider.keyRequired"));
  if (value.key.length > MAX_API_KEY_LENGTH) throw new Error(sourceText("error.provider.keyTooLong"));
  return { provider, key: value.key.trim() };
}

export function parseManagedProviderId(value: unknown): AgentProviderId {
  const provider = parseProviderId(value);
  if (!isManagedRuntimeProvider(provider)) throw new Error("Dengerbot does not manage this provider's CLI.");
  return provider;
}

function parseRefreshProvidersInput(value: unknown): { automatic: boolean } {
  if (!isDynamicRecord(value) || typeof value.automatic !== "boolean") throw new Error("Invalid provider refresh.");
  return { automatic: value.automatic };
}

function parseProviderUseInput(value: unknown): { provider: AgentProviderId; on: boolean } {
  if (!isDynamicRecord(value) || typeof value.on !== "boolean") throw new Error("Invalid provider switch.");
  const provider = parseProviderId(value.provider);
  return { provider, on: value.on };
}

export function parseConnectProviderAccountInput(value: unknown): ConnectProviderAccountInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid provider account.");
  return {
    provider: parseProviderId(value.provider),
    accountId: value.accountId === null ? null : requireString(value.accountId, "accountId"),
  };
}

export function parseRemoveProviderAccountInput(value: unknown): RemoveProviderAccountInput {
  if (!isDynamicRecord(value)) throw new Error("Invalid provider account.");
  return { provider: parseProviderId(value.provider), accountId: requireString(value.accountId, "accountId") };
}

/** The provider's own sign-in (`default`) or an account after the first. */
export function parseResetProviderUsageInput(value: unknown): ResetProviderUsageInput {
  if (!isDynamicRecord(value) || !isProviderAccountId(value.accountId)) throw new Error("Invalid provider account.");
  return { provider: parseProviderId(value.provider), accountId: value.accountId };
}

export function parseRenameProviderAccountInput(value: unknown): RenameProviderAccountInput {
  if (!isDynamicRecord(value) || (value.label !== null && !isString(value.label)))
    throw new Error("Invalid provider account.");
  const label = value.label?.trim() || null;
  if (label && label.length > PROVIDER_ACCOUNT_LABEL_MAX_LENGTH) throw new Error("Invalid provider account.");
  return { ...parseRemoveProviderAccountInput(value), label };
}
