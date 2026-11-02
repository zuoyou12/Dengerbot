import type { AgentBackupModels, AgentModelChoice } from "@openbot/contracts/ipc";
import {
  type BackupModelSource,
  BackupModelsPage,
  UsageLimitAskCard,
  usageLimitAskOptions,
} from "@openbot/ui/features/conversation/BackupModels";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENT_STATUS, STORY_MODELS } from "./fixtures";

const meta = {
  title: "Conversation/Backup models",
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// The slim build knows only DeepSeek, so the story's models are ids from `STORY_MODELS`.
const OWN: AgentModelChoice = { provider: "deepseek", model: "deepseek-reasoner" };

/** DeepSeek Reasoner is at its usage limit, so the page marks it and the card does not offer it. */
const SOURCE: BackupModelSource = {
  modelOptions: STORY_MODELS,
  providers: STORY_AGENT_STATUS.providers,
  limited: (choice) => choice.provider === OWN.provider && choice.model === OWN.model,
};

const ORDER: AgentBackupModels = {
  automatic: false,
  order: [
    { provider: "deepseek", model: "gpt-5.6-luna" },
    { provider: "deepseek", model: "deepseek-chat" },
    { provider: "deepseek", model: "deepseek-reasoner" },
  ],
};

/** A fixed moment, so the story reads the same on every run and in every review screenshot. */
const RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;

function Page(props: { value: AgentBackupModels | null }) {
  const [value, setValue] = createSignal(props.value);
  return (
    <div class="agent-settings-page" style={{ width: "420px" }}>
      <BackupModelsPage
        agentName="Chief"
        ownModel="DeepSeek Chat"
        own={{ provider: "deepseek", model: "deepseek-chat" }}
        value={value()}
        source={SOURCE}
        onChange={setValue}
      />
    </div>
  );
}

/** The default: no order, and the agent asks before it switches. */
export const AskFirst: Story = { render: () => <Page value={null} /> };

/** A saved order. The model at its usage limit is skipped. */
export const SavedOrder: Story = { render: () => <Page value={ORDER} /> };

/** The chat card while a usage limit holds a message that has not started. */
export const AskCard: Story = {
  render: () => (
    <div style={{ width: "640px" }}>
      <UsageLimitAskCard
        provider="deepseek"
        resetsAt={RESETS_AT}
        options={usageLimitAskOptions(OWN, ORDER, SOURCE)}
        onSend={fn(async () => undefined)}
        onWait={fn()}
      />
    </div>
  ),
};
