import type { AgentStatus, ProviderRuntimeStatus } from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { hostSetupProviderProps } from "../src/features/onboarding/host-setup-provider-props";
import { ServerOnboarding } from "../src/features/onboarding/ServerOnboarding";
import type { HostProviderSettings } from "../src/features/settings/ProviderSettingsSection";
import { STORY_AGENT_STATUS } from "./fixtures";

/** A new hosted server: the one CLI this build knows is on the host, and it is not signed in. */
const newHostStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  phase: "blocked",
  providers: [{ id: "deepseek", state: "sign-in-required", version: "1.18.27", message: null }],
  capabilities: { ...STORY_AGENT_STATUS.capabilities, chat: "unavailable" },
};

const connectedHostStatus: AgentStatus = {
  ...newHostStatus,
  phase: "ready",
  providers: (newHostStatus.providers ?? []).map((provider) =>
    provider.id === "deepseek" ? { ...provider, state: "available", email: "person@example.com" } : provider,
  ),
};

const ready = (version: string): ProviderRuntimeStatus => ({ phase: "ready", progress: 100, message: null, version });

function host(agentStatus: AgentStatus): HostProviderSettings {
  return {
    agentStatus,
    providerRuntimeStatuses: {
      deepseek: ready("1.18.27"),
    },
    customProviders: [],
  };
}

type ServerOnboardingProps = Parameters<typeof ServerOnboarding>[0];

function Story(props: {
  agentStatus: AgentStatus;
  onContinue: ServerOnboardingProps["onContinue"];
  onClose: ServerOnboardingProps["onClose"];
}) {
  onCleanup(() => toast.dismiss());
  return (
    <div style={{ height: "100vh" }}>
      <ServerOnboarding
        serverName="Ada’s server"
        setup={hostSetupProviderProps(host(props.agentStatus))}
        onContinue={props.onContinue}
        onClose={props.onClose}
      />
      <Toaster />
    </div>
  );
}

const meta = {
  title: "Setup/ServerOnboarding",
  component: Story,
  args: { agentStatus: newHostStatus, onContinue: fn(), onClose: fn() },
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Story>;

export default meta;
type StoryEntry = StoryObj<typeof meta>;

/** Nothing is signed in on the host. Connect on the DeepSeek row opens the key dialog. */
export const NothingConnected: StoryEntry = {};

/** The host is signed in to DeepSeek, so Continue opens the agent form. */
export const Connected: StoryEntry = {
  args: { agentStatus: connectedHostStatus },
};
