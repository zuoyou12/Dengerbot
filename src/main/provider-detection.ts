// Discovers models only for an explicit custom API endpoint. Legacy local scan requests return no results.
import type {
  DetectedModelServer,
  DiscoverModelsInput,
  DiscoverModelsResult,
  ProviderDetectionSettings,
} from "@openbot/contracts/ipc";
import { arkPlanKind, sameCustomProviderOrigin } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import type { CustomProviderConfig } from "../backend/custom-provider-types";
import { ArkPlanModelFailure, probeArkPlanModels } from "./ark-plan-models";
import { ModelServerProbe, type ProbeError } from "./model-server-probe";

/** The user asked for this list, and a remote server can be slow. */
const DISCOVER_TIMEOUT_MS = 8_000;

export interface ProviderDetectionDependencies {
  settings: { get(): ProviderDetectionSettings };
  customProviders: { configs(): readonly CustomProviderConfig[] };
  probe?: Context.Service.Shape<typeof ModelServerProbe>["probe"];
}

export type ProviderDetection = Context.Service.Shape<typeof ProviderDiscovery>;

class ProviderDiscovery extends Context.Service<
  ProviderDiscovery,
  {
    scanModelServers(): Effect.Effect<DetectedModelServer[]>;
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
