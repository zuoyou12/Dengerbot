import type {
  AgentProviderId,
  AgentStatus,
  AppSetupState,
  CustomProviderRestart,
  CustomProviderSummary,
  ProviderRuntimeSnapshot,
  ServerSummary,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { Toaster, toast } from "@openbot/ui";
import { createSignal, onCleanup } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createProviderRuntimeStore } from "../src/features/provider-updates/provider-runtime-store";
import { ServerSettingsModal } from "../src/features/servers/ServerSettingsModal";
import { STORY_HOST_STATUS, STORY_INVITES, STORY_PRESENCE, STORY_SERVERS } from "../src/preview/fixtures";
import { createMockOpenBot } from "./mock-openbot";
import { SettingsPageStory } from "./settings-page-story";

const localServer = localStoryServer();

const providerAgentStatus: AgentStatus = {
  phase: "blocked",
  cliVersion: null,
  auth: { kind: "unknown" },
  providers: (["deepseek"] as const).map((id) => ({
    id,
    state: "not-installed",
    version: null,
    message: null,
  })),
  capabilities: { chat: "unavailable", browser: "ready", computerUse: "ready" },
  message: null,
  fullAccess: true,
};
const providerRuntimeStatuses: ProviderRuntimeSnapshot["providers"] = {
  pi: { phase: "downloading", progress: 48, message: null, version: null },
};

/** Four connected runtimes, one of which has a newer version waiting. */
const providerUpdateAgentStatus: AgentStatus = {
  ...providerAgentStatus,
  phase: "ready",
  providers: (["deepseek"] as const).map((id) => ({
    id,
    state: "available",
    version: "1.0.0",
    message: null,
  })),
};
/** OpenCode installed with no account of its own: enough to run an endpoint that brings its own key. */
const openCodeInstalledAgentStatus: AgentStatus = {
  ...providerUpdateAgentStatus,
  providers: [...(providerUpdateAgentStatus.providers ?? [])],
};

/** Two saved endpoints: one with a key of its own, one on this computer that asks for none. */
const STORY_CUSTOM_PROVIDERS: readonly CustomProviderSummary[] = [
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
const providerUpdateRuntimeStatuses: ProviderRuntimeSnapshot["providers"] = {
  codex: { phase: "ready", progress: 100, message: null, version: "0.149.1" },
  claude: { phase: "ready", progress: 100, message: null, version: "2.1.246", availableVersion: "2.1.250" },
  grok: { phase: "ready", progress: 100, message: null, version: "1.0.5" },
  antigravity: { phase: "ready", progress: 100, message: null, version: "1.2.1" },
  cursor: { phase: "ready", progress: 100, message: null, version: "2026.09.28-64d2043" },
  cline: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
  pi: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
  muse: { phase: "ready", progress: 100, message: null, version: "3.0.68" },
};

/** The Providers section of Server settings, with the providers of this computer. */
function ServerProvidersStory(props: {
  providerDownloads?: boolean;
  providerUpdate?: boolean;
  providerUpdateFailure?: boolean;
  openCodeInstalled?: boolean;
  customProviderList?: boolean;
  /** The first result of a fake scan. Scan again runs the whole scan. */
  /** Detected IDs that the user hid in an earlier run. */
  /** Where the scan looks. Without it the section has no detection settings. */
  /** A server that the window has not selected: the section offers the switch. */
  inactive?: boolean;
  /** Providers the user turned off. With it every provider row has the switch that turns one on or off. */
  offProviders?: readonly AgentProviderId[];
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>>;
}) {
  const previousApi = window.openbot;
  const mock = createMockOpenBot({
    ...(props.providerUpdate
      ? {
          providerRuntimeSnapshot: {
            revision: 0,
            providers: providerUpdateRuntimeStatuses,
            toolRuntimes: { bun: { phase: "ready", progress: 100, message: null, version: "1.4.2" } },
          },
        }
      : {}),
    ...(props.providerUpdateFailure ? { providerRuntimeFailure: true } : {}),
  });
  const runtimes = createProviderRuntimeStore(() => (props.providerUpdate ? mock.api.providerRuntimes : undefined));
  window.openbot = mock.api;
  onCleanup(() => {
    mock.dispose();
    toast.dismiss();
    window.openbot = previousApi;
  });
  const [preference, setPreference] = createSignal<AppSetupState>({
    completed: true,
    preferredProvider: "deepseek",
    preferredModel: null,
  });
  const [open, setOpen] = createSignal(true);
  const [customProviders, setCustomProviders] = createSignal<CustomProviderSummary[]>(
    props.customProviderList ? [...STORY_CUSTOM_PROVIDERS] : [],
  );
  const [offProviders, setOffProviders] = createSignal(props.offProviders);

  async function addCustomProvider(): Promise<CustomProviderRestart> {
    return "restarted";
  }

  async function deleteCustomProvider(id: string): Promise<CustomProviderRestart> {
    setCustomProviders((current) => current.filter((provider) => provider.id !== id));
    return "restarted";
  }

  /** A key that is not sent stays saved, as in main. */
  async function updateCustomProvider(input: UpdateCustomProviderInput): Promise<CustomProviderRestart> {
    setCustomProviders((current) =>
      current.map((provider) =>
        provider.id === input.id
          ? {
              ...provider,
              name: input.name,
              baseUrl: input.baseUrl,
              models: input.models,
              hasApiKey: provider.hasApiKey || Boolean(input.apiKey),
            }
          : provider,
      ),
    );
    return "restarted";
  }

  return (
    <>
      <SettingsPageStory title="Server settings" onEscape={() => setOpen(false)}>
        {(page) => (
          <ServerSettingsModal
            page={page()}
            open={open()}
            platform="darwin"
            server={props.inactive ? { ...localServer, active: false } : localServer}
            hostStatus={STORY_HOST_STATUS}
            members={STORY_PRESENCE.members}
            invites={STORY_INVITES}
            onRetry={fn(async () => undefined)}
            onSaveIdentity={fn(async () => undefined)}
            onSetPublished={fn(async () => undefined)}
            onCreateInvite={fn(async () => {
              throw new Error("Not used in this story.");
            })}
            onUpdateMember={fn(async () => undefined)}
            onRemoveMember={fn(async () => undefined)}
            onRevokeInvite={fn(async () => undefined)}
            onOpenScreenRecordingSettings={fn(async () => undefined)}
            onRecheckScreenRecording={fn(async () => undefined)}
            initialSection="providers"
            hostPromptCacheTtl={{}}
            onSwitchToManageProviders={props.inactive ? fn() : undefined}
            providers={
              props.inactive
                ? undefined
                : {
                    get defaultProvider() {
                      return {
                        ...preference(),
                        save: async (provider: AgentProviderId, model?: string | null) => {
                          setPreference((current) => ({
                            completed: true,
                            preferredProvider: provider,
                            preferredModel:
                              model === undefined && current.preferredProvider === provider
                                ? current.preferredModel
                                : (model ?? null),
                          }));
                        },
                      };
                    },
                    get agentStatus() {
                      return props.providerUpdate
                        ? providerUpdateAgentStatus
                        : props.openCodeInstalled
                          ? openCodeInstalledAgentStatus
                          : providerAgentStatus;
                    },
                    get providerRuntimeStatuses() {
                      return props.providerUpdate
                        ? runtimes.providerRuntimeStatuses()
                        : props.providerDownloads
                          ? providerRuntimeStatuses
                          : undefined;
                    },
                    get providerAvailableVersions() {
                      return props.providerUpdate ? runtimes.providerAvailableVersions() : undefined;
                    },
                    onUpdateProvider: props.providerUpdate ? runtimes.downloadProviderRuntime : undefined,
                    onDownloadProvider: props.providerUpdate
                      ? runtimes.downloadProviderRuntime
                      : props.providerDownloads
                        ? fn()
                        : undefined,
                    onCancelProviderDownload: props.providerUpdate
                      ? runtimes.cancelProviderRuntimeDownload
                      : props.providerDownloads
                        ? fn()
                        : undefined,
                    onAddCustomProvider: addCustomProvider,
                    onDeleteCustomProvider: deleteCustomProvider,
                    onUpdateCustomProvider: updateCustomProvider,
                    get customProviders() {
                      return customProviders();
                    },
                    get offProviders() {
                      return offProviders();
                    },
                    providerUsers: props.providerUsers,
                    onSetProviderOn: props.offProviders
                      ? (provider: AgentProviderId, on: boolean) => {
                          setOffProviders((current = []) =>
                            on ? current.filter((id) => id !== provider) : [...current, provider],
                          );
                        }
                      : undefined,
                  }
            }
          />
        )}
      </SettingsPageStory>
      <Toaster />
    </>
  );
}

const meta = {
  title: "Settings/ServerSettingsModal/Providers",
  component: ServerProvidersStory,
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
    viewport: {
      options: {
        serverDesktop: {
          name: "Server settings — 1200 × 820",
          styles: { width: "1200px", height: "820px" },
        },
        serverPhone: {
          name: "Server settings — 420 × 760",
          styles: { width: "420px", height: "760px" },
        },
      },
    },
  },
} satisfies Meta<typeof ServerProvidersStory>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The row that adds a self-described endpoint. OpenCode is installed, so the row offers Add. */
export const AddCustomProvider: Story = {
  render: () => <ServerProvidersStory openCodeInstalled />,
};

/**
 * Two saved endpoints. The count on the Custom provider row opens the dialog that lists them, so the
 * Providers section keeps its rows of fixed height.
 */
export const CustomProviderList: Story = {
  render: () => <ServerProvidersStory openCodeInstalled customProviderList />,
};

export const ProviderDownloads: Story = {
  render: () => <ServerProvidersStory providerDownloads />,
  parameters: { viewport: { defaultViewport: "serverPhone" } },
};

/** The durable surface: the update the toast offers is still here after the toast is gone. */
export const ProviderUpdateAvailable: Story = {
  render: () => <ServerProvidersStory providerUpdate />,
};

export const ProviderUpdateRetry: Story = {
  render: () => <ServerProvidersStory providerUpdate providerUpdateFailure />,
};

/**
 * Cursor, Antigravity and Cline are installed for other work, so the user turned them off. Agents use
 * Codex and Claude, so those switches stay on.
 */
export const ProvidersOff: Story = {
  render: () => (
    <ServerProvidersStory providerUpdate offProviders={["deepseek"]} providerUsers={{ deepseek: ["Rex", "Mila"] }} />
  ),
};

/** A server that the window has not selected. Its providers are managed after a switch to it. */
export const NotSelectedServer: Story = {
  render: () => <ServerProvidersStory inactive />,
};

function localStoryServer(): ServerSummary {
  const server = STORY_SERVERS.find((candidate) => candidate.kind === "local");
  if (!server) throw new Error("Story server fixtures need a local server.");
  return server;
}
