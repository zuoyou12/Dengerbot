import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { Effect } from "effect";
import type { RemoteWorkflowError } from "../remote-service-effects";
// The providers of one server's host: API keys, managed CLI runtimes and custom
// endpoints. On a joined server they belong to the host, so the request goes there, and the host
// answers only an owner or admin. A key only travels towards the host; no result carries one.

import type { ManagedProviderId } from "@openbot/contracts/agent-providers";
import {
  type AgentStatus,
  decodeCustomProviderResult,
  decodeCustomProviderSummaries,
  decodeHostProviderAccountUsage,
  decodeProviderApiKeyStatus,
  decodeProviderRuntimeSnapshot,
  decodeProviderRuntimeSnapshotV8,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import {
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_ACCOUNTS_ROUTES,
} from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import {
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_ROUTES,
} from "@openbot/contracts/team-protocol/providers-v2";
import { PROVIDERS_V4_CAPABILITY, PROVIDERS_V4_ROUTES } from "@openbot/contracts/team-protocol/providers-v4";
import { sourceText } from "@openbot/i18n/source";
import { AgentLifecycleFailed, type AgentService } from "../../backend/agent-service";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { PeerCustomProviderChanges } from "../custom-provider-changes";
import type { ProviderCredentialStore } from "../provider-credential-store";
import type { ProviderRuntimeManager } from "../provider-runtime-manager";
import {
  decodeAgentStatusFromHost,
  decodeHostProviderAccountsFromHost,
  decodeProviderUsageResetOutcomeFromHost,
  decodeProviderUsageResetsFromHost,
} from "../remote-agent-decoding";
import { acceptEmpty, type ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import { parseProviderId } from "./app-inputs";
import { parseDeleteCustomProvider, parseSaveCustomProvider } from "./custom-provider-inputs";
import type { IpcGroupHandlers } from "./define-ipc-group";
import {
  parseManagedProviderId,
  parseProviderApiKeyInput,
  parseRemoveProviderAccountInput,
  parseRenameProviderAccountInput,
  parseResetProviderUsageInput,
  signInCodexWithApiKey,
} from "./provider-handlers";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

interface ProviderAdminRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

interface ProviderAdminIpcDependencies {
  service: Pick<AgentService, "changeProviderCredential" | "clearProviderCredential" | "signInCodexWithApiKey">;
  credentials: Pick<ProviderCredentialStore, "status" | "set" | "clear">;
  runtimes: Pick<
    ProviderRuntimeManager,
    "getStatus" | "download" | "cancel" | "checkForUpdates" | "ensureKeyProviderCli"
  >;
  customProviders: PeerCustomProviderChanges;
  remoteServers: ProviderAdminRemoteServers;
}

export function providerAdminIpcHandlers({
  service,
  credentials,
  runtimes,
  customProviders,
  remoteServers,
}: ProviderAdminIpcDependencies): Pick<IpcGroupHandlers, "providerAdmin"> {
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, PROVIDERS_ADMIN_CAPABILITY))
      throw new Error(sourceText("error.provider.localOnly"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }

  /** A change, then the host's status, so the result is the same `AgentStatus` the local change gives. */
  async function remoteChange(serverId: string, path: string, body: unknown): Promise<AgentStatus> {
    await remote(serverId, path, body, acceptEmpty);
    return runCauseEffect(remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost));
  }

  /**
   * The runtime routes of the host: `providers-v8` names any provider, `providers-v4` includes Cursor
   * and Cline, `providers-v2` Gemini, and `providers-v1` none of them.
   */
  function keyRoutes(serverId: string) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)) return PROVIDERS_V8_ROUTES;
    return remoteServers.supportsCapability(serverId, PROVIDERS_V5_CAPABILITY)
      ? PROVIDERS_V5_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  }
  function runtimeRoutes(serverId: string) {
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)) return PROVIDERS_V8_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V5_CAPABILITY)) return PROVIDERS_V5_ROUTES;
    if (remoteServers.supportsCapability(serverId, PROVIDERS_V4_CAPABILITY)) return PROVIDERS_V4_ROUTES;
    return remoteServers.supportsCapability(serverId, PROVIDERS_RUNTIMES_V2_CAPABILITY)
      ? PROVIDERS_RUNTIMES_V2_ROUTES
      : PROVIDERS_ADMIN_ROUTES;
  }

  /** The accounts of a joined server's host's providers, which only a host with `provider-accounts-v1` holds. */
  function requireAccounts(serverId: string): void {
    if (!remoteServers.supportsCapability(serverId, PROVIDER_ACCOUNTS_CAPABILITY))
      throw new Error(sourceText("error.team.providersUnsupported"));
  }
  const accountsQuery = <T>(path: string, decoder: ResponseDecoder<T>) =>
    scopedQueryHandler({
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (serverId) => {
        requireAccounts(serverId);
        return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: {} }));
      },
    });
  const accountsRequest = <I, T>(
    parse: (value: unknown) => I,
    path: string,
    decoder: ResponseDecoder<T>,
    body: (input: I) => unknown = (input) => input,
  ) =>
    scopedHandler(parse, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (input: I, serverId: string) => {
        requireAccounts(serverId);
        return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: body(input) }));
      },
    });

  /**
   * The usage reset credits of a joined server's host's accounts, which only a host with
   * `provider-usage-reset-v1` spends. This computer's own go through `providers`.
   */
  const usageResetRequest = <I, T>(
    parse: (value: unknown) => I,
    path: string,
    decoder: ResponseDecoder<T>,
    body: (input: I) => unknown = (input) => input,
  ) =>
    scopedHandler(parse, {
      local: () => Promise.reject(new Error(sourceText("error.team.providersUnsupported"))),
      remote: (input: I, serverId: string) => {
        if (!remoteServers.supportsCapability(serverId, PROVIDER_USAGE_RESET_CAPABILITY))
          throw new Error(sourceText("error.team.providersUnsupported"));
        return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body: body(input) }));
      },
    });

  /** `providers-v8` lists the runtimes as rows; the older route sets give the IPC record. */
  function runtimeDecoder(serverId: string) {
    return remoteServers.supportsCapability(serverId, PROVIDERS_V8_CAPABILITY)
      ? decodeProviderRuntimeSnapshotV8
      : decodeProviderRuntimeSnapshot;
  }
  /**
   * The admin runtime routes name a managed provider CLI. No provider is managed in this build, so
   * the decoder rejects every id and returns `never`, which is the payload type the route declares.
   */
  function parseNoManagedProvider(value: unknown): never {
    parseManagedProviderId(value);
    throw new Error("Dengerbot does not manage this provider's CLI.");
  }
  const runtime = (route: "runtimesDownload" | "runtimesCancel") => (provider: ManagedProviderId, serverId: string) =>
    remote(serverId, runtimeRoutes(serverId)[route], { provider }, runtimeDecoder(serverId));

  return {
    providerAdmin: {
      accounts: accountsQuery(PROVIDER_ACCOUNTS_ROUTES.list, decodeHostProviderAccountsFromHost),
      accountUsage: accountsQuery(PROVIDER_ACCOUNTS_ROUTES.usage, decodeHostProviderAccountUsage),
      renameAccount: accountsRequest(parseRenameProviderAccountInput, PROVIDER_ACCOUNTS_ROUTES.rename, acceptEmpty),
      removeAccount: accountsRequest(parseRemoveProviderAccountInput, PROVIDER_ACCOUNTS_ROUTES.remove, acceptEmpty),
      usageResets: usageResetRequest(
        parseProviderId,
        PROVIDER_USAGE_RESET_ROUTES.list,
        decodeProviderUsageResetsFromHost,
        (provider) => ({ provider }),
      ),
      resetUsage: usageResetRequest(
        parseResetProviderUsageInput,
        PROVIDER_USAGE_RESET_ROUTES.consume,
        decodeProviderUsageResetOutcomeFromHost,
      ),
      getApiKeyState: scopedHandler(parseProviderId, {
        local: (provider) => ({ provider, status: credentials.status(provider) }),
        remote: async (provider, serverId) => ({
          provider,
          status: await remote(serverId, keyRoutes(serverId).apiKeyState, { provider }, decodeProviderApiKeyStatus),
        }),
      }),
      setApiKey: scopedHandler(parseProviderApiKeyInput, {
        local: async ({ provider, key }) => {
          if (provider === "codex") return signInCodexWithApiKey(service, key);
          await runCauseEffect(runtimes.ensureKeyProviderCli(provider));
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
        },
        remote: (input, serverId) => remoteChange(serverId, keyRoutes(serverId).apiKeySet, input),
      }),
      clearApiKey: scopedHandler(parseProviderId, {
        local: (provider) =>
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
        remote: (provider, serverId) => remoteChange(serverId, keyRoutes(serverId).apiKeyClear, { provider }),
      }),
      getRuntimes: scopedQueryHandler({
        local: () => runtimes.getStatus(),
        remote: (serverId) => remote(serverId, runtimeRoutes(serverId).runtimesStatus, {}, runtimeDecoder(serverId)),
      }),
      downloadRuntime: scopedHandler(parseNoManagedProvider, {
        local: (provider) => runCauseEffect(runtimes.download(provider)),
        remote: runtime("runtimesDownload"),
      }),
      cancelRuntime: scopedHandler(parseNoManagedProvider, {
        local: (provider) => runCauseEffect(runtimes.cancel(provider)),
        remote: runtime("runtimesCancel"),
      }),
      checkRuntimeUpdates: scopedQueryHandler({
        local: () => runCauseEffect(runtimes.checkForUpdates()),
        remote: (serverId) => remote(serverId, runtimeRoutes(serverId).runtimesCheck, {}, runtimeDecoder(serverId)),
      }),
      listCustomProviders: scopedQueryHandler({
        local: () => customProviders.list(),
        remote: (serverId) => remote(serverId, PROVIDERS_ADMIN_ROUTES.customList, {}, decodeCustomProviderSummaries),
      }),
      saveCustomProvider: scopedHandler(parseSaveCustomProvider, {
        local: (input) => runCauseEffect(customProviders.save(input)),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customSave, input, decodeCustomProviderResult),
      }),
      deleteCustomProvider: scopedHandler(parseDeleteCustomProvider, {
        local: ({ id }) => runCauseEffect(customProviders.remove(id)),
        remote: (input, serverId) =>
          remote(serverId, PROVIDERS_ADMIN_ROUTES.customDelete, input, decodeCustomProviderResult),
      }),
    },
  };
}
