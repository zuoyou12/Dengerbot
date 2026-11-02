// A custom provider is an OpenAI-compatible endpoint the user names themselves. OpenBot serves it by
// merging a `provider` entry into the OpenCode CLI's config, so the wire identity stays `opencode`
// and no new `AgentProviderId` exists. What makes this file a contract rather than renderer state is
// the API key: it travels renderer-to-main on `save` and must never come back, so both directions
// need one agreed shape and the guard below is what enforces the asymmetry.

import { AGENT_PROVIDERS } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * A custom provider is served by the OpenCode CLI, so its bounds are OpenCode's config shape rather
 * than an OpenBot object: the id becomes a `provider` key, and `<id>/<model id>` becomes the model id
 * OpenCode reports back. `INPUT_LIMITS` has no entry for a key or an endpoint because no other
 * OpenBot payload has ever carried one.
 */
export const CUSTOM_PROVIDER_LIMITS = {
  apiKey: 4_096,
  baseUrl: 2_048,
  models: 256,
  headers: 32,
} as const;

/** A `provider` key in OpenCode's config, so lowercase and free of separators. */
export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** RFC 9110 field-name token characters. */
export const CUSTOM_PROVIDER_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export interface CustomProviderModel {
  id: string;
  name: string;
}

export interface CustomProviderHeader {
  name: string;
  value: string;
}

/**
 * Renderer to main. This is the one renderer-to-main payload that carries a secret, so nothing on
 * this path may log it.
 *
 * `apiKey: null` means "this endpoint needs no key". It never means "keep the one you have": a save
 * adds a new endpoint. `UpdateCustomProviderInput` is the edit path.
 */
export interface SaveCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: CustomProviderModel[];
  headers: CustomProviderHeader[];
}

/**
 * Renderer to main, on this computer only: the Team API has no edit route. The id names a saved
 * endpoint and does not change. A field that is absent keeps its stored value, so the form can send
 * a blank key and no headers without discarding the credentials that the user does not type again.
 * There is no way to clear a stored key here: remove the endpoint and add it again for that.
 */
export interface UpdateCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  models: CustomProviderModel[];
  apiKey?: string;
  headers?: CustomProviderHeader[];
}

export interface DeleteCustomProviderInput {
  id: string;
}

/** Main to renderer. The key never comes back; `hasApiKey` is all the renderer may know about it. */
export interface CustomProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  /** True when the host can read an API key or configured authentication headers. */
  hasCredentials?: boolean;
  /**
   * The models the user listed for this endpoint, which is how the renderer names one before the
   * CLI has listed it: onboarding must record a custom model for a custom choice, and the endpoint
   * may have been saved in an earlier run. A model id and its label are not credentials.
   */
  models: CustomProviderModel[];
}

/**
 * Why a saved endpoint's models may not have appeared yet. One `opencode acp` process serves every
 * OpenCode agent, and it reads the config only at spawn, so a change needs a respawn that OpenBot
 * will not force through a turn in progress.
 */
export const CUSTOM_PROVIDER_RESTARTS = ["restarted", "skipped-busy", "not-running"] as const;
export type CustomProviderRestart = (typeof CUSTOM_PROVIDER_RESTARTS)[number];

export interface CustomProviderResult {
  providers: CustomProviderSummary[];
  restart: CustomProviderRestart;
}

/**
 * The provider ids that no endpoint could have when endpoints shipped. A provider added later is
 * refused only for a new endpoint (`isNewCustomProviderId`): an endpoint saved under that name
 * before the upgrade must stay readable and removable, because one bad row empties the whole list.
 */
const RESERVED_AT_RELEASE = ["codex", "claude", "grok"] as const;

/** A saved endpoint id: what the list decoders and a delete accept. */
export function isCustomProviderId(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.identifier) &&
    CUSTOM_PROVIDER_ID_PATTERN.test(value) &&
    !isOneOf(RESERVED_AT_RELEASE, value)
  );
}

/** The id of an endpoint to save. It must not be the name of a built-in provider. */
export function isNewCustomProviderId(value: unknown): value is string {
  return isCustomProviderId(value) && !isOneOf(AGENT_PROVIDERS, value);
}

/**
 * Rejects a record that carries an `apiKey` key at all, not merely one whose key is a string. That
 * makes "the renderer never sees the key" a fact the boundary checks rather than a habit the main
 * process is trusted to keep, and it costs one assertion to prove. Like `isAgentModelOption`, it
 * fails closed: one bad row empties the whole list rather than hiding itself.
 */
export function isCustomProviderSummary(value: unknown): value is CustomProviderSummary {
  return (
    isDynamicRecord(value) &&
    !("apiKey" in value) &&
    !("headers" in value) &&
    isCustomProviderId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.baseUrl, CUSTOM_PROVIDER_LIMITS.baseUrl) &&
    typeof value.hasApiKey === "boolean" &&
    (value.hasCredentials === undefined || typeof value.hasCredentials === "boolean") &&
    Array.isArray(value.models) &&
    value.models.length <= CUSTOM_PROVIDER_LIMITS.models &&
    value.models.every(isCustomProviderModel)
  );
}

function isCustomProviderModel(value: unknown): value is CustomProviderModel {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.name, INPUT_LIMITS.modelName)
  );
}

export function isCustomProviderResult(value: unknown): value is CustomProviderResult {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.providers) &&
    value.providers.every(isCustomProviderSummary) &&
    isOneOf(CUSTOM_PROVIDER_RESTARTS, value.restart)
  );
}

/**
 * Extracts `{ providerId, modelId }` from either DSH's JSON tuple id (`["<providerId>","<modelId>"]`)
 * or the legacy `<providerId>/<modelId>` format.
 */
export function parseCustomModelId(modelId: string | null | undefined): { providerId: string; modelId: string } | null {
  if (!modelId) return null;
  if (modelId.startsWith("[")) {
    try {
      const parsed = JSON.parse(modelId);
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "string" &&
        parsed[0].length > 0 &&
        typeof parsed[1] === "string" &&
        parsed[1].length > 0
      ) {
        return { providerId: parsed[0], modelId: parsed[1] };
      }
    } catch {
      return null;
    }
    return null;
  }
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator >= modelId.length - 1) return null;
  return {
    providerId: modelId.slice(0, separator),
    modelId: modelId.slice(separator + 1),
  };
}

/**
 * The id DSH reports a custom model as (`["<providerId>","<modelId>"]`).
 *
 * Both the IPC and the Team API list decoders fail closed on a whole model array when one id is
 * malformed, so every caller that accepts a custom model id checks the composed form with
 * `isAgentModel` rather than the two halves on their own.
 */
export function composedCustomModelId(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

/** Whether a model id came from a custom provider rather than from a built-in provider's own catalogue. */
export function isCustomProviderModelId(modelId: string, providerIds: ReadonlySet<string>): boolean {
  const parsed = parseCustomModelId(modelId);
  return parsed !== null && providerIds.has(parsed.providerId);
}

/** The custom provider that a model id names, as `composedCustomModelId` makes it. */
export function customProviderOfModel<T extends { readonly id: string; readonly name?: string }>(
  modelId: string | null | undefined,
  providers: readonly T[],
): T | undefined {
  const parsed = parseCustomModelId(modelId);
  if (!parsed) return undefined;
  const found = providers.find((provider) => provider.id === parsed.providerId);
  if (found) return found;
  const preset = DOMESTIC_PROVIDER_PRESETS.find((p) => p.id === parsed.providerId);
  if (preset) return preset as unknown as T;
  const subscribed = SUBSCRIBED_PROVIDER_PRESETS.find((p) => p.id === parsed.providerId);
  if (subscribed) return subscribed as unknown as T;
  return undefined;
}

/** A header name is compared case-insensitively, the way HTTP does. */
export function isCustomProviderHeaderName(value: unknown): value is string {
  return isString(value) && value.length > 0 && CUSTOM_PROVIDER_HEADER_NAME_PATTERN.test(value);
}

/** Region and plan endpoints verified against refs/magpie/internal/provider/presets.go.
 * Only OpenAI-compatible chat endpoints are exposed by this application's current adapter.
 */
export interface ProviderPresetRegion {
  readonly name:
    | "china"
    | "international"
    | "payAsYouGo"
    | "codingPlan"
    | "agentPlan"
    | "planChina"
    | "planSingapore"
    | "planEurope";
  readonly baseUrl: string;
  readonly keysUrl?: string;
  readonly noList?: boolean;
}

export interface DomesticProviderPreset {
  readonly regions?: readonly ProviderPresetRegion[];
  readonly regionKind?: "region" | "plan";
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly models: readonly CustomProviderModel[];
  readonly authKind?: "api-key" | "none";
  readonly docsUrl?: string;
  readonly keysUrl?: string;
  readonly note?: string;
}

/**
 * Pre-configured domestic model provider presets aligned with Magpie reference presets:
 * - Kimi (Moonshot): api.moonshot.cn/v1
 * - Z.ai: api.z.ai/api/paas/v4
 * - Zhipu GLM: open.bigmodel.cn/api/paas/v4
 * - MiniMax: api.minimaxi.com/v1
 * - Xiaomi MiMo: token-plan-cn.xiaomimimo.com/v1
 * - StepFun: api.stepfun.com/step_plan/v1
 * - Volcengine Ark: ark.cn-beijing.volces.com/api/coding/v3
 * - Qwen: dashscope.aliyuncs.com/compatible-mode/v1
 * - OpenCode: opencode.ai/zen/v1
 */
export const DOMESTIC_PROVIDER_PRESETS: readonly DomesticProviderPreset[] = [
  {
    id: "kimi-code",
    name: "Kimi Code",
    baseUrl: "https://api.kimi.ai/coding/v1",
    regionKind: "region",
    regions: [
      { name: "international", baseUrl: "https://api.kimi.ai/coding/v1" },
      { name: "china", baseUrl: "https://api.kimi.com/coding/v1" },
    ],
    models: [],
    authKind: "api-key",
    docsUrl: "https://www.kimi.com/code",
    keysUrl: "https://www.kimi.com/code/console",
    note: "Kimi Code Membership",
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    models: [],
    authKind: "api-key",
    docsUrl: "https://opencode.ai/docs/go",
    keysUrl: "https://opencode.ai/auth",
  },
  {
    id: "commandcode",
    name: "Command Code",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    models: [],
    authKind: "api-key",
    docsUrl: "https://commandcode.ai/docs/provider",
    keysUrl: "https://commandcode.ai/settings/keys",
  },
  {
    id: "moonshot",
    regionKind: "region",
    regions: [
      {
        name: "china",
        baseUrl: "https://api.moonshot.cn/v1",
        keysUrl: "https://platform.moonshot.cn/console/api-keys",
      },
      {
        name: "international",
        baseUrl: "https://api.moonshot.ai/v1",
        keysUrl: "https://platform.moonshot.ai/console/api-keys",
      },
    ],
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [],
    authKind: "api-key",
    keysUrl: "https://platform.moonshot.cn/console/api-keys",
    note: "Moonshot AI / Kimi",
  },
  {
    id: "zai",
    regionKind: "plan",
    regions: [
      { name: "payAsYouGo", baseUrl: "https://api.z.ai/api/paas/v4" },
      { name: "codingPlan", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
    ],
    name: "Z.ai",
    baseUrl: "https://api.z.ai/api/paas/v4",
    models: [],
    authKind: "api-key",
    keysUrl: "https://z.ai/manage-apikey/apikey-list",
    note: "Z.ai (Coding: /api/coding/paas/v4)",
  },
  {
    id: "zhipu",
    regionKind: "plan",
    regions: [
      { name: "payAsYouGo", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
      { name: "codingPlan", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4" },
    ],
    name: "Zhipu GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [],
    authKind: "api-key",
    keysUrl: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys",
    note: "Zhipu AI (Coding: /api/coding/paas/v4)",
  },
  {
    id: "minimax",
    regionKind: "region",
    regions: [
      {
        name: "china",
        baseUrl: "https://api.minimaxi.com/v1",
        keysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
      },
      {
        name: "international",
        baseUrl: "https://api.minimax.io/v1",
        keysUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
      },
    ],
    name: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    models: [],
    authKind: "api-key",
    keysUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    note: "MiniMax (China)",
  },
  {
    id: "xiaomi",
    regionKind: "region",
    regions: [
      { name: "planChina", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1" },
      { name: "planSingapore", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1" },
      { name: "planEurope", baseUrl: "https://token-plan-ams.xiaomimimo.com/v1" },
      { name: "payAsYouGo", baseUrl: "https://api.xiaomimimo.com/v1" },
    ],
    name: "Xiaomi MiMo",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    models: [],
    authKind: "api-key",
    keysUrl: "https://platform.xiaomimimo.com/token-plan",
    note: "Xiaomi MiMo (API: api.xiaomimimo.com)",
  },
  {
    id: "stepfun",
    regionKind: "plan",
    regions: [
      { name: "codingPlan", baseUrl: "https://api.stepfun.com/step_plan/v1" },
      { name: "payAsYouGo", baseUrl: "https://api.stepfun.com/v1" },
      {
        name: "international",
        baseUrl: "https://api.stepfun.ai/step_plan/v1",
        keysUrl: "https://platform.stepfun.ai/interface-key",
      },
    ],
    name: "StepFun",
    baseUrl: "https://api.stepfun.com/step_plan/v1",
    models: [],
    authKind: "api-key",
    keysUrl: "https://platform.stepfun.com/interface-key",
    note: "StepFun 阶跃星辰 (API: /v1)",
  },
  {
    id: "volcengine",
    regionKind: "plan",
    regions: [
      { name: "codingPlan", baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3", noList: true },
      { name: "agentPlan", baseUrl: "https://ark.cn-beijing.volces.com/api/plan/v3", noList: true },
      { name: "payAsYouGo", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
    ],
    name: "Volcengine Ark",
    baseUrl: "https://ark.cn-beijing.volces.com/api/coding/v3",
    models: [],
    authKind: "api-key",
    keysUrl: "https://ark.volcengine.com/region:cn-beijing/apikey",
    note: "Volcengine 火山方舟 (Agent: /api/plan/v3)",
  },
  {
    id: "qwen",
    regionKind: "region",
    regions: [
      {
        name: "china",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        keysUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
      },
      {
        name: "international",
        baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        keysUrl: "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key",
      },
    ],
    name: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [],
    authKind: "api-key",
    keysUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
    note: "Qwen / DashScope (Plan: token-plan.cn-beijing.maas.aliyuncs.com)",
  },
  {
    id: "opencode",
    name: "OpenCode",
    baseUrl: "https://opencode.ai/zen/v1",
    models: [],
    authKind: "none",
    keysUrl: "https://opencode.ai/auth",
    note: "OpenCode Zen",
  },
];

export function isDomesticProviderPreset(id: string): boolean {
  return DOMESTIC_PROVIDER_PRESETS.some((preset) => preset.id === id);
}

export function getDomesticProviderPreset(id: string): DomesticProviderPreset | undefined {
  return DOMESTIC_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

export interface SubscribedProviderPreset {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly models: readonly CustomProviderModel[];
  readonly note?: string;
}

/**
 * Pre-configured presets for subscribed internal providers:
 * - WorkBuddy CN: copilot.tencent.com
 * - WorkBuddy AI: www.workbuddy.ai
 * - Qoder Global: openapi.qoder.sh/v1
 * - Qoder CN: openapi.qoder.com.cn/v1
 * - ZCode: open.bigmodel.cn/api/coding/paas/v4
 * - Trae CN: api.trae.cn/v1
 */
export const SUBSCRIBED_PROVIDER_PRESETS: readonly SubscribedProviderPreset[] = [
  {
    id: "workbuddy",
    name: "WorkBuddy",
    baseUrl: "https://copilot.tencent.com",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3 (WorkBuddy CN)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (WorkBuddy CN)" },
      { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (WorkBuddy CN)" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (WorkBuddy CN)" },
      { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (WorkBuddy CN)" },
    ],
    note: "WorkBuddy CN (Tencent CodeBuddy)",
  },
  {
    id: "workbuddy-ai",
    name: "WorkBuddy AI",
    baseUrl: "https://www.workbuddy.ai",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3 (WorkBuddy)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (WorkBuddy)" },
      { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (WorkBuddy)" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (WorkBuddy)" },
      { id: "gpt-4o", name: "GPT-4o (WorkBuddy)" },
    ],
    note: "WorkBuddy International AI",
  },
  {
    id: "qoder",
    name: "Qoder",
    baseUrl: "https://openapi.qoder.sh/v1",
    models: [
      { id: "qoder/fast", name: "Qoder Fast (0.8x)" },
      { id: "qoder/ultimate", name: "Qoder Ultimate" },
      { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Qoder)" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Qoder)" },
      { id: "gpt-4o", name: "GPT-4o (Qoder)" },
      { id: "deepseek-chat", name: "DeepSeek V3 (Qoder)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (Qoder)" },
    ],
    note: "Qoder Global",
  },
  {
    id: "qoder-cn",
    name: "Qoder CN",
    baseUrl: "https://openapi.qoder.com.cn/v1",
    models: [
      { id: "qoder/fast", name: "Qoder Fast (0.8x)" },
      { id: "qoder/ultimate", name: "Qoder Ultimate" },
      { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Qoder CN)" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Qoder CN)" },
      { id: "deepseek-chat", name: "DeepSeek V3 (Qoder CN)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (Qoder CN)" },
      { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (Qoder CN)" },
    ],
    note: "Qoder CN (Lingma Copilot)",
  },
  {
    id: "zcode",
    name: "ZCode",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    models: [
      { id: "glm-5.3", name: "GLM-5.3" },
      { id: "GLM-5.3", name: "GLM-5.3 (Uppercase)" },
      { id: "glm-5.2", name: "GLM-5.2" },
      { id: "glm-5.1", name: "GLM-5.1" },
      { id: "glm-5", name: "GLM-5" },
      { id: "glm-4-plus", name: "GLM-4 Plus" },
      { id: "glm-4-air", name: "GLM-4 Air" },
      { id: "glm-4-flash", name: "GLM-4 Flash" },
      { id: "glm-4-long", name: "GLM-4 Long" },
      { id: "codegeex-4", name: "CodeGeeX-4" },
    ],
    note: "ZCode (GLM Coding Plan)",
  },
  {
    id: "trae-cn",
    name: "Trae",
    baseUrl: "https://api.trae.cn/v1",
    models: [
      { id: "kimi-k3-max", name: "Kimi K3 Max (Trae)" },
      { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Trae)" },
      { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Trae)" },
      { id: "gpt-4o", name: "GPT-4o (Trae)" },
      { id: "deepseek-chat", name: "DeepSeek V3 (Trae)" },
      { id: "deepseek-reasoner", name: "DeepSeek R1 (Trae)" },
    ],
    note: "Trae CN",
  },
];

export function isSubscribedProviderPreset(id: string): boolean {
  return SUBSCRIBED_PROVIDER_PRESETS.some((preset) => preset.id === id);
}

export function getSubscribedProviderPreset(id: string): SubscribedProviderPreset | undefined {
  return SUBSCRIBED_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/**
 * Returns all custom provider IDs including domestic and subscribed presets.
 */
export function customProviderIds(providers?: readonly { readonly id: string }[]): ReadonlySet<string> {
  const ids = new Set((providers ?? []).map((provider) => provider.id));
  for (const preset of DOMESTIC_PROVIDER_PRESETS) {
    ids.add(preset.id);
  }
  for (const preset of SUBSCRIBED_PROVIDER_PRESETS) {
    ids.add(preset.id);
  }
  return ids;
}
