import { ComposerUpdateNotice, ComposerUsageLimitNotice } from "@openbot/ui/features/conversation/ComposerNotice";
import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const meta = {
  title: "Conversation/Composer notice",
  component: ComposerUpdateNotice,
  args: {
    provider: "deepseek",
    onUpdate: fn(),
  },
  parameters: { layout: "centered", a11y: { test: "error" } },
} satisfies Meta<typeof ComposerUpdateNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The composer column, so the notice is judged at the width it actually renders at. */
function ComposerStack(props: { children: JSX.Element }) {
  return (
    <div class="composer-wrap" style={{ width: "640px", padding: "16px" }}>
      {props.children}
    </div>
  );
}

/** A fixed moment, so the story reads the same on every run and in every review screenshot. */
const USAGE_RESETS_AT = Date.UTC(2026, 8, 21, 9, 0) / 1_000;

/** A spent plan notice can be dismissed without changing the provider's quota reading. */
export const UsageLimitReached: Story = {
  render: () => {
    const [dismissed, setDismissed] = createSignal(false);
    return (
      <ComposerStack>
        <Show when={!dismissed()}>
          <ComposerUsageLimitNotice
            provider="deepseek"
            resetsAt={USAGE_RESETS_AT}
            onDismiss={() => setDismissed(true)}
          />
        </Show>
      </ComposerStack>
    );
  },
};

/** Some providers report a spent window with no reset time, so the card names the way out instead. */
export const UsageLimitWithoutReset: Story = {
  render: () => {
    const [dismissed, setDismissed] = createSignal(false);
    return (
      <ComposerStack>
        <Show when={!dismissed()}>
          <ComposerUsageLimitNotice provider="deepseek" resetsAt={null} onDismiss={() => setDismissed(true)} />
        </Show>
      </ComposerStack>
    );
  },
};

export const UpdateRequired: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUpdateNotice provider="deepseek" onUpdate={fn()} />
    </ComposerStack>
  ),
};

export const Updating: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUpdateNotice provider="deepseek" onUpdate={fn()} updating />
    </ComposerStack>
  ),
};

export const ManualUpdateRequired: Story = {
  render: () => (
    <ComposerStack>
      <ComposerUpdateNotice provider="deepseek" />
    </ComposerStack>
  ),
};
