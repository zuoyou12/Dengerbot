// Discovers models only for an explicit custom API endpoint. Legacy local scan requests return no results.
import type {
  DetectedAcpAgent,
  DetectedModelServer,
  DiscoverModelsInput,
  DiscoverModelsResult,
  ProviderDetectionSettings,
} from "@openbot/contracts/ipc";
import { arkPlanKind, sameCustomProviderOrigin } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { scanAcpAgents } from "../backend/acp-agent-scan";
import type { CustomProviderConfig } from "../backend/custom-provider-types";
import { ArkPlanModelFailure, probeArkPlanModels } from "./ark-plan-models";
import { ModelServerProbe, type ProbeError } from "./model-server-probe";

/** The user asked for this list, and a remote server can be slow. */
const DISCOVER_TIMEOUT_MS = 8_000;

export interface ProviderDetectionDependencies {
  settings: { get(): ProviderDetectionSettings };
  customProviders: { configs(): readonly CustomProviderConfig[] };
  customAgents: { configs(): readonly { id: string }[] };
  probe?: Context.Service.Shape<typeof ModelServerProbe>["probe"];
  scanAgents?: typeof scanAcpAgents;
}

export type ProviderDetection = Context.Service.Shape<typeof ProviderDiscovery>;

class ProviderDiscovery extends Context.Service<
  ProviderDiscovery,
  {
    scanModelServers(): Effect.Effect<DetectedModelServer[]>;
    scanAgents(): Effect.Effect<DetectedAcpAgent[]>;
    discoverModels(input: DiscoverModelsInput): Effect.Effect<DiscoverModelsResult, ProbeError | ArkPlanModelFailure>;
  }
>()("openbot/main/ProviderDiscovery") {
  static layer(dependencies: ProviderDetectionDependencies) {
    return Layer.effect(
      ProviderDiscovery,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;

        const modelProbe = yield* ModelServerProbe;
        const injectedProbe = dependencies.probe;
        const probe = injectedProbe ?? modelProbe.probe;
        const scan = () => Effect.succeed<DetectedModelServer[]>([]);
        let agentScan: Fiber.Fiber<DetectedAcpAgent[]> | null = null;
        const injectedScanAgents = dependencies.scanAgents;
        // Looks for known agent command names only. It starts no file.
        const scanAgents = Effect.fn("ProviderDiscovery.scanAgents")(function* () {
          if (agentScan) return yield* Fiber.join(agentScan);
          const fiber = yield* Effect.forkIn(
            Effect.gen(function* () {
              const current = dependencies.settings.get();
              if (!current.enabled) return [];
              const input = {
                folders: current.folders,
                takenIds: new Set(dependencies.customAgents.configs().map((config) => config.id)),
              };
              return yield* (injectedScanAgents ?? scanAcpAgents)(input);
            }),
            scope,
            { startImmediately: true },
          );
          agentScan = fiber;
          fiber.addObserver(() => {
            if (agentScan === fiber) agentScan = null;
          });
          return yield* Fiber.join(fiber);
        });
        const discoverModels = Effect.fn("ProviderDiscovery.discoverModels")(function* (input: DiscoverModelsInput) {
          const kind = arkPlanKind(input.baseUrl);
          if (kind) {
            if (!input.arkPlan)
              return yield* Effect.fail(
                new ArkPlanModelFailure({ message: sourceText("error.provider.planAccessKeyRequired") }),
              );
            return { models: yield* probeArkPlanModels(kind, input.arkPlan, DISCOVER_TIMEOUT_MS) };
          }
          if (input.arkPlan)
            return yield* Effect.fail(
              new ArkPlanModelFailure({ message: sourceText("error.provider.planCredentialsInvalid") }),
            );
          let apiKey = input.apiKey;
          let headers = input.headers;
          const saved = input.savedProviderId
            ? dependencies.customProviders.configs().find((config) => config.id === input.savedProviderId)
            : undefined;
          // Blank fields retain credentials only when the destination keeps the stored origin.
          if (saved && sameCustomProviderOrigin(saved.baseUrl, input.baseUrl)) {
            if (!apiKey) apiKey = saved.apiKey;
            if (headers.length === 0) headers = [...saved.headers];
          }
          const request = yield* Effect.forkIn(
            probe({ baseUrl: input.baseUrl, apiKey, headers }, DISCOVER_TIMEOUT_MS),
            scope,
            { startImmediately: true },
          );
          return { models: yield* Fiber.join(request) };
        });
        return ProviderDiscovery.of({
          scanModelServers: scan,
          scanAgents,
          discoverModels,
        });
      }),
    ).pipe(Layer.provide(ModelServerProbe.layer));
  }
}

/** Constructs the service once; the application executes its operations and owns shutdown. */
export const createProviderDetection = Effect.fn("ProviderDiscovery.create")(function* (
  dependencies: ProviderDetectionDependencies,
) {
  const runtime = ManagedRuntime.make(ProviderDiscovery.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  return { ...Context.get(context, ProviderDiscovery), close: () => runtime.disposeEffect };
});
