import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentModelOption } from "@openbot/contracts/ipc";
import { parseCustomModelId } from "@openbot/contracts/ipc";
import type { AgentProvider } from "./../agent-client";
import type { CustomProviderConfig } from "../custom-provider-types";
import type { ModelListResponse } from "./../protocol";

/**
 * A model name the contract guards accept. `isAgentModelOption` bounds the name, and both the IPC
 * and the Team API list decoders reject the whole array when one option fails, so a name that is one
 * character too long does not shorten a label - it empties the model picker.
 */
export function modelDisplayName(name: string): string {
  return name.slice(0, INPUT_LIMITS.modelName);
}

/**
 * This build ships one provider, and its agent takes the model the user picked, so no provider
 * reorders its catalog. The map stays for a caller that reads it.
 */
export const PREFERRED_MODEL_ORDER: ReadonlyMap<AgentProvider, (model: AgentModelOption) => number> = new Map();

/** The first version number in a model name: `[5, 6]` for `GPT-5.6 Sol`, `null` for `gpt-reserve`. */
function modelVersion(name: string): number[] | null {
  const match = /\d+(?:\.\d+)*/u.exec(name);
  return match ? match[0].split(".").map(Number) : null;
}

/**
 * Newest version first, so the picker leads with the latest model. A name with no version goes
 * last, and equal versions compare equal so the CLI's own order stays between them.
 */
export function compareModelVersions(left: AgentModelOption, right: AgentModelOption): number {
  const a = modelVersion(left.name);
  const b = modelVersion(right.name);
  if (!a || !b) return Number(!a) - Number(!b);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/**
 * The tier that Codex names "Fast". Codex lists it in `serviceTiers` (`priority` in 0.163); an older
 * release lists only the deprecated `additionalSpeedTiers`, where it is `fast`.
 */
export function codexFastServiceTier(server: ModelListResponse["data"][number]): { fastServiceTier?: string } {
  const tier =
    server.serviceTiers?.find((candidate) => candidate.name?.trim().toLowerCase() === "fast")?.id ??
    (server.additionalSpeedTiers?.includes("fast") ? "fast" : undefined);
  return tier && tier.length <= INPUT_LIMITS.serviceTier ? { fastServiceTier: tier } : {};
}

/** No preset or public catalogue is evidence that the user connected a provider. */
export const OPENCODE_FREE_MODEL_FALLBACKS: AgentModelOption[] = [];

/** Retain only an existing catalogue after a failed refresh; never invent models. */
export function modelsAfterOpenCodeDiscoveryFailure(previous: AgentModelOption[]): AgentModelOption[] {
  return previous;
}

/** Filter live and cached runtime catalogues against the credentials and models saved by the user. */
export function connectedModelOptions(
  models: readonly AgentModelOption[],
  providers: readonly CustomProviderConfig[],
  hasOfficialKey: boolean,
): AgentModelOption[] {
  const configured = new Map(
    providers
      .filter((provider) => provider.apiKey || provider.headers.length > 0)
      .map((provider) => [provider.id, new Set(provider.models.map((model) => model.id))]),
  );
  return models.filter((model) => {
    if (model.provider !== "deepseek") return true;
    const parsed = parseCustomModelId(model.id);
    if (!parsed || parsed.providerId === "deepseek-official") return hasOfficialKey;
    return configured.get(parsed.providerId)?.has(parsed.modelId) ?? false;
  });
}
