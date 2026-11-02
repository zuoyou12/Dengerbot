import type { AgentProviderId, ClientAgentModelOption, CustomProviderSummary } from "@openbot/contracts/ipc";
import {
  agentProviderName,
  customProviderOfModel,
  DOMESTIC_PROVIDER_PRESETS,
  isAgentProvider,
  isCustomProviderModelId,
  isKnownAgentProvider,
  parseCustomModelId,
  SUBSCRIBED_PROVIDER_PRESETS,
} from "@openbot/contracts/ipc";

export interface PickerModel {
  id: string;
  /** The provider that lists the model. */
  provider: AgentProviderId;
  name: string;
  service: string;
  free: boolean;
  variants: { id: string; name: string }[];
}

export interface PickerModelGroup {
  name: string;
  models: PickerModel[];
}

/**
 * How a provider id inside a custom agent reads in a group heading. An id that is also an OpenBot
 * provider takes its display name; a few other well-known ids keep their brand casing here; any
 * other id falls back to one capitalized word per `-`, `_` or space.
 */
const KNOWN_PROVIDER_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  deepseek: "DeepSeek",
  devin: "Devin",
  gemini: "Gemini",
  github: "GitHub",
  "github-copilot": "GitHub Copilot",
  openai: "OpenAI",
  moonshot: "Kimi",
  zai: "Z.ai",
  zhipu: "Zhipu GLM",
  minimax: "MiniMax",
  xiaomi: "Xiaomi MiMo",
  stepfun: "StepFun",
  volcengine: "Volcengine Ark",
  qwen: "Qwen",
  opencode: "OpenCode",
  workbuddy: "WorkBuddy",
  "workbuddy-ai": "WorkBuddy AI",
  qoder: "Qoder",
  "qoder-cn": "Qoder CN",
  zcode: "ZCode",
  "trae-cn": "Trae",
};

function providerLabel(id: string): string {
  const lower = id.toLowerCase();
  const known = KNOWN_PROVIDER_LABELS[lower];
  if (known) return known;
  if (isAgentProvider(lower)) return agentProviderName(lower);
  return id
    .replace(/[-_\s]+(.)?/g, (_match, letter: string) => (letter ? ` ${letter.toUpperCase()}` : ""))
    .replace(/^./, (letter) => letter.toUpperCase());
}

/** Free tier first; id says nothing about locality. */
function modelTier(model: PickerModel): 0 | 1 {
  return model.free ? 0 : 1;
}

/** Endpoints shown in Settings include unconfigured presets; only configured ones offer models. */
export function connectedCustomProviders(providers: readonly CustomProviderSummary[]): CustomProviderSummary[] {
  return providers.filter((provider) => (provider.hasCredentials ?? provider.hasApiKey) && provider.models.length > 0);
}

export function connectedPickerOptions(
  models: readonly ClientAgentModelOption[],
  providers: readonly CustomProviderSummary[],
): ClientAgentModelOption[] {
  const connected = new Map(
    connectedCustomProviders(providers).map((provider) => [
      provider.id,
      new Set(provider.models.map((model) => model.id)),
    ]),
  );
  return models.filter((model) => {
    const parsed = parseCustomModelId(model.id);
    if (!parsed || parsed.providerId === "deepseek-official") return true;
    return connected.get(parsed.providerId)?.has(parsed.modelId) ?? false;
  });
}

/** The models of the picker, in catalogue order. */
export function pickerModels(
  options: ClientAgentModelOption[],
  customProviders?: readonly CustomProviderSummary[],
): PickerModel[] {
  return connectedPickerOptions(options, customProviders ?? []).flatMap((model) => {
    if (!isKnownAgentProvider(model.provider)) return [];
    const customProvider = customProviderOfModel(model.id, customProviders ?? []);
    return {
      id: model.id,
      provider: model.provider,
      name: model.name.replace(/^[\s:–—-]+/, "") || model.id,
      service: customProvider ? customProvider.name || providerLabel(customProvider.id) : "",
      // The tier badge and the free label described OpenCode's catalogue; this build has neither.
      free: false,
      variants: [],
    };
  });
}

/** One group per service, ordered by best tier; tier orders, badge carries pricing. */
export function groupPickerModels(models: PickerModel[], search: string): PickerModelGroup[] {
  const query = search.trim().toLowerCase();
  const groups = new Map<string, PickerModelGroup>();
  const tiers = new Map<string, number>();
  for (const model of models) {
    if (!`${model.service} ${model.name}`.toLowerCase().includes(query)) continue;
    const name = model.service;
    const group = groups.get(model.service) ?? { name, models: [] };
    group.models.push(model);
    groups.set(model.service, group);
    tiers.set(model.service, Math.min(tiers.get(model.service) ?? modelTier(model), modelTier(model)));
  }
  for (const group of groups.values()) group.models.sort((left, right) => modelTier(left) - modelTier(right));
  // Tiers are keyed by service: an ACP group name is a label that differs from its key.
  return [...groups.entries()]
    .sort(([left], [right]) => (tiers.get(left) ?? 0) - (tiers.get(right) ?? 0))
    .map(([, group]) => group);
}

export function customProviderIds(providers: readonly CustomProviderSummary[]): ReadonlySet<string> {
  const ids = new Set(providers.map((provider) => provider.id));
  for (const preset of DOMESTIC_PROVIDER_PRESETS) {
    ids.add(preset.id);
  }
  for (const preset of SUBSCRIBED_PROVIDER_PRESETS) {
    ids.add(preset.id);
  }
  return ids;
}

/** A model of the Custom tab: a custom endpoint's, which DSH serves. */
export function isCustomModel(model: ClientAgentModelOption, customIds: ReadonlySet<string>): boolean {
  return isCustomProviderModelId(model.id, customIds);
}
