import { ProviderModelPicker } from "@openbot/ui/components/ProviderModelPicker";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

const args: Parameters<typeof ProviderModelPicker>[0] = {
  provider: "deepseek",
  value: "gpt-5.6-luna",
  modelOptions: STORY_MODELS,
  agentStatus: STORY_AGENT_STATUS,
  onChange: fn(),
};

const meta = {
  title: "Conversation/ProviderModelPicker",
  component: ProviderModelPicker,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ProviderModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pill: Story = {
  args: { reasoningEffort: "medium", onReasoningEffortChange: fn() },
};

/** A DeepSeek model with every effort level. */
export const AllEffortLevels: Story = {
  args: {
    provider: "deepseek",
    value: "deepseek-reasoner",
    modelOptions: STORY_MODELS.map((model) =>
      model.id === "deepseek-reasoner"
        ? { ...model, supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"] }
        : model,
    ),
    reasoningEffort: "high",
    onReasoningEffortChange: fn(),
  },
};

export const Field: Story = {
  args: { variant: "field", label: "Model" },
};

export const Disabled: Story = {
  args: { disabled: true, disabledReason: "Choose a provider first." },
};

/** Providers that cannot run stay off the rail. The agent's own provider stays, with its message. */
export const UnavailableProvidersOpen: Story = {
  args: {
    modelOptions: STORY_MODELS.filter((model) => model.provider === "deepseek"),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "deepseek"
          ? provider
          : {
              ...provider,
              state: "not-installed" as const,
              version: null,
              message: null,
            },
      ),
    },
  },
};

/** Signed-out providers stay off the rail, and the plus opens the settings. */
export const ConnectedProvidersOnly: Story = {
  args: {
    onManageProviders: fn(),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "deepseek" ? provider : { ...provider, state: "sign-in-required" as const },
      ),
    },
  },
};

export const ProviderDownloadsOpen: Story = {
  args: {
    modelOptions: STORY_MODELS.filter((model) => model.provider === "deepseek"),
    agentStatus: {
      ...STORY_AGENT_STATUS,
      phase: "blocked",
      providers: STORY_AGENT_STATUS.providers?.map((provider) => ({
        ...provider,
        state: "not-installed" as const,
        version: null,
        message: null,
      })),
    },
    // DeepSeek is the only provider this build can download, so one row carries the in-progress state.
    runtimeStatuses: {
      deepseek: { phase: "downloading", progress: 24, message: null, version: null },
    },
    onDownloadProvider: fn(),
    onCancelProviderDownload: fn(),
    onConnectProvider: fn(),
  },
};

export const DiscoveredModels: Story = {
  args: {
    modelOptions: [
      ...STORY_MODELS,
      {
        provider: "deepseek",
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        description: "OpenCode model discovered from the local CLI.",
        defaultReasoningEffort: "medium",
        // "ultra" is not an effort this build's enum carries; "max" is the top level it offers.
        supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
      },
    ],
  },
};

export const OpenCodeCatalog: Story = {
  args: {
    provider: "deepseek",
    value: "deepseek/example-free/low",
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: [{ id: "deepseek", state: "available", version: "1.3.13", message: null }],
    },
    // The pairs are a `[string, string][]`, so each `id` and `name` is a string, not `string | undefined`.
    modelOptions: (
      [
        ["cerebras/qwen", "Cerebras/Qwen"],
        ["openai/gpt", "OpenAI/GPT"],
        ["deepseek/example-free", "DeepSeek/Example Free"],
        ["deepseek/another-free", "DeepSeek/Another Free"],
        ["deepseek/example", "DeepSeek/Example"],
        ["zai/glm", "Z.AI/GLM"],
      ] satisfies [string, string][]
    ).flatMap(([id, name]) =>
      ["", "low", "medium", "high", "xhigh"].map((effort) => ({
        provider: "deepseek" as const,
        id: effort ? `${id}/${effort}` : id,
        name: effort ? `${name} (${effort})` : name,
        description: "Example model catalog",
        defaultReasoningEffort: "medium" as const,
        supportedReasoningEfforts: ["medium" as const],
      })),
    ),
  },
};

const openCodeCatalog = (entries: [string, string][]) =>
  entries.map(([id, name]) => ({
    provider: "deepseek" as const,
    id,
    name,
    description: "Example model catalog",
    defaultReasoningEffort: "medium" as const,
    supportedReasoningEfforts: ["medium" as const],
  }));

export const OpenCodeLocalModels: Story = {
  args: {
    provider: "deepseek",
    value: "ollama/qwen3-coder:30b",
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: [{ id: "deepseek", state: "available", version: "1.3.13", message: null }],
    },
    modelOptions: openCodeCatalog([
      ["ollama/qwen3-coder:30b", "Ollama/Qwen3 Coder 30B"],
      ["ollama/gpt-oss:120b", "Ollama/GPT-OSS 120B"],
      ["lmstudio/glm-5-air", "LM Studio/GLM-5 Air"],
      ["deepseek/example-free", "DeepSeek/Example Free"],
      ["deepseek/example", "DeepSeek/Example"],
      ["zai/glm", "Z.AI/GLM"],
      ["openai/gpt", "OpenAI/GPT"],
    ]),
  },
};

const openCodeStatus = {
  ...STORY_AGENT_STATUS,
  providers: [{ id: "deepseek" as const, state: "available" as const, version: "1.18.27", message: null }],
};

const customProviders = [
  {
    id: "studio-local",
    name: "Studio Local",
    baseUrl: "http://127.0.0.1:11434/v1",
    hasApiKey: false,
    models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
  },
  {
    id: "house-router",
    name: "House Router",
    baseUrl: "https://models.example.com/v1",
    hasApiKey: true,
    models: [{ id: "gpt-oss-120b", name: "GPT OSS 120B" }],
  },
];

/** Nothing configured: the Custom tab is the one entry point, so it must not be a dead end. */
export const CustomTabEmpty: Story = {
  args: {
    provider: "deepseek",
    value: "deepseek/example",
    agentStatus: openCodeStatus,
    modelOptions: openCodeCatalog([["deepseek/example", "DeepSeek/Example"]]),
    onAddCustomProvider: fn(),
  },
};

export const CustomTabWithModels: Story = {
  args: {
    provider: "deepseek",
    value: "studio-local/qwen3-coder:30b",
    agentStatus: openCodeStatus,
    customProviders,
    onAddCustomProvider: fn(),
    modelOptions: openCodeCatalog([
      ["studio-local/qwen3-coder:30b", "Studio Local/Qwen3 Coder 30B"],
      ["studio-local/gpt-oss:120b", "Studio Local/GPT-OSS 120B"],
      ["house-router/glm-5-air", "House Router/GLM-5 Air"],
      ["deepseek/example-free", "DeepSeek/Example Free"],
      ["openai/gpt", "OpenAI/GPT"],
    ]),
  },
};

/** The same catalog on the OpenCode tab, which must not list the two custom endpoints again. */
export const OpenCodeTabExcludesCustom: Story = {
  args: {
    ...CustomTabWithModels.args,
    value: "deepseek/example-free",
  },
};
