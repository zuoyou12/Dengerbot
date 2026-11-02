import type { AgentStatus } from "@openbot/contracts/ipc";
import { createSignal, Show } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { FirstRunPlanStep } from "../src/features/onboarding/FirstRunPlanStep";
import { createSetupProviders, type SetupProviderProps } from "../src/features/onboarding/SetupProviderPicker";
import { STORY_AGENT_STATUS } from "./fixtures";
import {
  FakeProviderDownloads,
  lazyProviderAgentStatus,
  lazyProviders,
  MockedOnboardingApi,
  noProvidersConnectedAgentStatus,
} from "./onboarding-fixture";

/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...STORY_AGENT_STATUS,
  providers: [
    ...(STORY_AGENT_STATUS.providers ?? []),
    { id: "deepseek", state: "sign-in-required", version: "1.18.27", message: null },
  ],
};

const checkingProvidersAgentStatus: AgentStatus = {
  ...noProvidersConnectedAgentStatus,
  phase: "starting",
  providers: (noProvidersConnectedAgentStatus.providers ?? []).map((provider) => ({
    ...provider,
    state: "checking",
    message: null,
  })),
  message: "Checking local AI providers…",
};

const bothConnectingAgentStatus: AgentStatus = {
  ...noProvidersConnectedAgentStatus,
  providers: (noProvidersConnectedAgentStatus.providers ?? []).map((provider) => ({
    ...provider,
    connectionState: "connecting" as const,
    message: null,
  })),
};

/** Gemini is downloaded and signed in. The others are not downloaded yet. */
const deepseekKeyAddedAgentStatus: AgentStatus = {
  ...lazyProviderAgentStatus,
  providers: lazyProviders.map((provider) =>
    provider.id === "deepseek"
      ? { ...provider, state: "available", version: null, email: "ada@example.com" }
      : provider,
  ),
};

/**
 * The plan step as first run shows it after "Use your … plan". The flow itself opens on the first
 * question, so these stories show the step alone.
 */
function PlanStep(props: SetupProviderProps) {
  const providers = createSetupProviders(props, undefined, { includeFree: () => false });
  const [screen, setScreen] = createSignal<HTMLElement | undefined>();
  return (
    <main class="onboarding-screen first-run-screen" data-step="plan" ref={(element) => setScreen(element)}>
      <div class="onboarding-shell">
        <FirstRunPlanStep providers={providers} disabled={false} menuMount={screen()} />
        <Show when={providers.error()}>
          <p class="onboarding-error" role="alert">
            {providers.error()}
          </p>
        </Show>
      </div>
    </main>
  );
}

function MockedPlanStep(props: { args: SetupProviderProps }) {
  return (
    <MockedOnboardingApi>
      <PlanStep {...props.args} />
    </MockedOnboardingApi>
  );
}

function RefreshResettingPlanStep(props: { args: SetupProviderProps }) {
  const [agentStatus, setAgentStatus] = createSignal(bothConnectingAgentStatus);
  const [refreshingProviders, setRefreshingProviders] = createSignal(false);
  return (
    <MockedPlanStep
      args={{
        ...props.args,
        agentStatus: agentStatus(),
        refreshingProviders: refreshingProviders(),
        onRefreshProviders: async () => {
          setRefreshingProviders(true);
          await props.args.onRefreshProviders?.();
          await new Promise((resolve) => setTimeout(resolve, 100));
          setAgentStatus(noProvidersConnectedAgentStatus);
          setRefreshingProviders(false);
        },
      }}
    />
  );
}

function LazyProviderDownloadsPlanStep(props: {
  args: SetupProviderProps;
  failOpencodeOnce?: boolean;
  initialAgentStatus?: AgentStatus;
}) {
  return (
    <FakeProviderDownloads
      failOpencodeOnce={props.failOpencodeOnce}
      initialAgentStatus={props.initialAgentStatus}
      render={(fake) => <MockedPlanStep args={{ ...props.args, ...fake }} />}
    />
  );
}

const args: SetupProviderProps = {
  agentStatus: STORY_AGENT_STATUS,
  // Every onboarding story offers it: naming your own endpoint is part of choosing a provider,
  // not a variant of the step.
  onAddCustomProvider: fn(async () => "restarted" as const),
  customProviders: [
    {
      id: "studio-local",
      name: "Studio Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      hasApiKey: false,
      models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
    },
  ],
};

const meta = {
  title: "Setup/FirstRunPlanStep",
  component: PlanStep,
  args,
  parameters: {
    layout: "fullscreen",
    viewport: {
      options: {
        onboardingNarrow: {
          name: "Onboarding — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
  render: (storyArgs) => <MockedPlanStep args={storyArgs} />,
} satisfies Meta<typeof PlanStep>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initial: Story = {};

/** The row that adds a self-described endpoint. OpenCode is installed, so the row offers Add. */
export const AddCustomProvider: Story = {
  args: { agentStatus: openCodeInstalledAgentStatus },
};

/** The endpoint is refused, so the form stays with the values, including the key the user typed. */
export const CustomProviderSaveFails: Story = {
  args: {
    agentStatus: openCodeInstalledAgentStatus,
    onAddCustomProvider: fn(async () => {
      throw new Error("House Router refused the API key.");
    }),
  },
};

/**
 * First run looks for local model servers and ACP agents while the user reads the list. Rows appear
 * one by one; the provider rows above them do not move.
 */

/**
 * The scan is done. Add opens the form of its kind, filled from the scan: the endpoint form for a
 * server, the ACP agent form for an agent. X hides a row that the user does not want.
 */

/** The same result on a narrow window. */

export const NarrowProviderVersions: Story = {
  globals: { viewport: "onboardingNarrow" },
  args: {
    providerRuntimeStatuses: {
      // The one provider this build lists, on the version its own status row reports.
      deepseek: { phase: "ready", progress: null, message: null, version: "1.18.27" },
    },
  },
};

export const NoProvidersConnected: Story = {
  args: {
    agentStatus: noProvidersConnectedAgentStatus,
    onRefreshProviders: fn(),
  },
};

export const RefreshingProviders: Story = {
  args: {
    agentStatus: checkingProvidersAgentStatus,
    refreshingProviders: true,
    onRefreshProviders: fn(),
  },
};

export const ConnectedWithRefreshWarning: Story = {
  args: {
    agentStatus: {
      ...STORY_AGENT_STATUS,
      providers: STORY_AGENT_STATUS.providers?.map((provider) =>
        provider.id === "deepseek"
          ? {
              ...provider,
              checkError: "Could not verify DeepSeek. Keeping the existing connection.",
            }
          : provider,
      ),
    },
    onRefreshProviders: fn(),
  },
};

export const ConnectingDeepSeek: Story = {
  args: {
    agentStatus: {
      ...noProvidersConnectedAgentStatus,
      providers: noProvidersConnectedAgentStatus.providers?.map((provider) =>
        provider.id === "deepseek" ? { ...provider, connectionState: "connecting", message: null } : provider,
      ),
    },
    onRefreshProviders: fn(),
  },
};

export const ConnectingBoth: Story = {
  args: {
    agentStatus: bothConnectingAgentStatus,
    onRefreshProviders: fn(),
  },
};

export const RefreshResettingConnections: Story = {
  args: {
    agentStatus: bothConnectingAgentStatus,
    onRefreshProviders: fn(),
  },
  render: (storyArgs) => <RefreshResettingPlanStep args={storyArgs} />,
};

export const ConnectedWithReconnect: Story = {
  args: {
    agentStatus: STORY_AGENT_STATUS,
    onRefreshProviders: fn(),
  },
};

export const LazyProviderDownloads: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
  },
  render: (storyArgs) => <LazyProviderDownloadsPlanStep args={storyArgs} />,
};

/**
 * A new computer with no saved endpoint. The list shows the key providers and OpenCode,
 * and the custom provider is in "More providers".
 */
export const NewComputer: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
    customProviders: [],
  },
  render: (storyArgs) => <LazyProviderDownloadsPlanStep args={storyArgs} />,
};

/** The user added a DeepSeek key, so DeepSeek is the first row. */
export const SignedInToGemini: Story = {
  args: {
    agentStatus: deepseekKeyAddedAgentStatus,
    customProviders: [],
  },
  render: (storyArgs) => (
    <LazyProviderDownloadsPlanStep args={storyArgs} initialAgentStatus={deepseekKeyAddedAgentStatus} />
  ),
};

export const LazyProviderDownloadsWithFailure: Story = {
  args: {
    agentStatus: lazyProviderAgentStatus,
  },
  render: (storyArgs) => <LazyProviderDownloadsPlanStep args={storyArgs} failOpencodeOnce />,
};
