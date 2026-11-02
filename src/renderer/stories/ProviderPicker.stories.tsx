import type { AgentProviderId } from "@openbot/contracts/ipc";
import { Toaster } from "@openbot/ui";
import type { ProviderPickerOption } from "@openbot/ui/components/ProviderPicker";
import { ProviderPicker } from "@openbot/ui/components/ProviderPicker";
import { createSignal } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const options: ProviderPickerOption[] = [
  {
    id: "deepseek",
    name: "Codex",
    state: "available",
    email: "person@example.com",
  },
  {
    id: "deepseek",
    name: "Claude",
    state: "sign-in-required",
    email: "person@example.com",
    message: "Sign in to Claude to use this provider.",
  },
  {
    id: "deepseek",
    name: "Grok",
    state: "available",
    email: null,
  },
];

const args: Parameters<typeof ProviderPicker>[0] = {
  value: "deepseek",
  options,
  ariaLabel: "Default provider",
  label: "Default provider",
  hint: "You can change this later in settings.",
  onChange: fn(),
};

const meta = {
  title: "Setup/ProviderPicker",
  component: ProviderPicker,
  args,
  parameters: { layout: "centered" },
} satisfies Meta<typeof ProviderPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Available: Story = {};

export const Embedded: Story = {
  args: { embedded: true, label: undefined },
};

export const ProviderUnavailable: Story = {
  args: {
    value: null,
    options: options.map((option) => ({
      ...option,
      state: "not-installed",
      message: "Install this provider to continue.",
    })),
  },
};

/**
 * The three isolated update states. An update is a re-download of a newer runtime, so the
 * in-flight and failed rows reuse the Cancel and Retry buttons a first download already has.
 */
const claudeReady: ProviderPickerOption["runtimeStatus"] = {
  phase: "ready",
  progress: 100,
  message: null,
  version: "2.1.246",
};

function withClaudeUpdate(runtimeStatus: ProviderPickerOption["runtimeStatus"]): ProviderPickerOption[] {
  // One provider id in this build, so the row an update story exercises is matched by its name.
  return options.map((option) =>
    option.name === "Claude"
      ? { ...option, state: "available", message: null, runtimeStatus, availableVersion: "2.1.250" }
      : option,
  );
}

export const UpdateAvailable: Story = {
  args: { value: "deepseek", options: withClaudeUpdate(claudeReady), onUpdateProvider: fn() },
};

export const UpdateInProgress: Story = {
  args: {
    value: "deepseek",
    options: withClaudeUpdate({ phase: "downloading", progress: 42, message: null, version: "2.1.246" }),
    onCancelProviderDownload: fn(),
  },
};

export const UpdateFailed: Story = {
  args: {
    value: "deepseek",
    options: withClaudeUpdate({
      phase: "download-error",
      progress: 55,
      message: "The update was interrupted.",
      version: "2.1.246",
    }),
    onDownloadProvider: fn(),
  },
};

/**
 * A CLI the user installed themselves, with a newer version pinned by this OpenBot release. The row
 * reads exactly like a managed update - same badge, same button - because only the work behind the
 * button differs, and the row does not choose it.
 */
export const UserOwnedCliUpdate: Story = {
  args: {
    value: "deepseek",
    options: options.map((option) =>
      option.name === "Codex"
        ? {
            ...option,
            runtimeStatus: { phase: "ready", progress: null, message: null, version: "0.146.0" },
            availableVersion: "0.153.4",
          }
        : option,
    ),
    onUpdateProvider: fn(),
  },
};

export const AllowUnavailableSelection: Story = {
  args: {
    value: "deepseek",
    allowUnavailableSelection: true,
  },
};

/**
 * A custom endpoint runs as OpenCode, so its row follows OpenCode's row: it offers OpenCode's install
 * until the CLI is there, and Add from then on, with or without an OpenCode account.
 */
function withOpenCode(state: ProviderPickerOption["state"]): ProviderPickerOption[] {
  return [...options, { id: "deepseek", name: "OpenCode", state, description: "Use your installed OpenCode CLI" }];
}

export const CustomProviderNotInstalled: Story = {
  args: { options: withOpenCode("not-installed"), onAddCustomProvider: fn(), onInstallProvider: fn() },
};

/**
 * Two saved endpoints in the one row that stands for them all. The row is a choice now, so it joins
 * the group and takes the check mark from the provider that serves it, and the count is the button
 * that opens the list. The button sits beside Add, outside the label: a button inside a `<label>`
 * would answer the radio instead.
 */
export const CustomProviderEndpoints: Story = {
  args: {
    value: "deepseek",
    options: withOpenCode("available"),
    customProviders: [
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
    ],
    customSelected: false,
    onAddCustomProvider: fn(),
    onSelectCustomProvider: fn(),
    onManageCustomProviders: fn(),
  },
};

/**
 * One endpoint, chosen, and no list to open. Without `onManageCustomProviders` the count stays a
 * badge inside the label and counts in the singular. No provider row holds the check.
 */
export const CustomProviderSelected: Story = {
  args: {
    value: "deepseek",
    options: withOpenCode("available"),
    customProviders: [
      {
        id: "studio-local",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        hasApiKey: false,
        models: [{ id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" }],
      },
    ],
    customSelected: true,
    onAddCustomProvider: fn(),
    onSelectCustomProvider: fn(),
  },
};

export const CustomProviderReady: Story = {
  args: { options: withOpenCode("sign-in-required"), onAddCustomProvider: fn() },
};

/**
 * Every provider row has a switch that turns the provider on or off in OpenBot. An off row shows
 * only "Off" and the switch: OpenBot does not start, check or list that provider.
 */
const switchOptions: ProviderPickerOption[] = [
  ...options,
  { id: "deepseek", name: "Cursor", state: "error", checkError: "The model list could not be read." },
  { id: "deepseek", name: "OpenCode", state: "available", email: null },
];

function ProviderSwitchStory(props: {
  off: readonly AgentProviderId[];
  usedBy?: Partial<Record<AgentProviderId, string[]>>;
  save?: () => Promise<void>;
}) {
  const [off, setOff] = createSignal<readonly AgentProviderId[]>(props.off);
  return (
    <>
      <ProviderPicker
        {...args}
        embedded
        label={undefined}
        hint={undefined}
        allowUnavailableSelection
        options={switchOptions.map((option) => ({
          ...option,
          off: off().includes(option.id),
          usedBy: props.usedBy?.[option.id],
        }))}
        onSetProviderOn={async (provider, on) => {
          await props.save?.();
          setOff((current) => (on ? current.filter((id) => id !== provider) : [...current, provider]));
        }}
      />
      <Toaster />
    </>
  );
}

export const ProvidersOff: Story = {
  render: () => <ProviderSwitchStory off={["deepseek"]} />,
};

/** Agents use Codex and Claude, so their switches stay on. Turning one off shows a toast that tells why. */
// One provider id in this build, so every row reads the same `off` and `usedBy` entry.
export const ProviderInUse: Story = {
  render: () => <ProviderSwitchStory off={[]} usedBy={{ deepseek: ["Ada", "Rex", "Mila"] }} />,
};

/** Click a switch to see the pending state while storage has not answered. */
export const ProviderSwitchPending: Story = {
  render: () => <ProviderSwitchStory off={[]} save={() => new Promise<void>(() => undefined)} />,
};

/** A failed save keeps the previous switch value and shows its error below the row. */
export const ProviderSwitchError: Story = {
  render: () => (
    <ProviderSwitchStory
      off={[]}
      save={() => Promise.reject(new Error("OpenBot could not change the provider setting."))}
    />
  ),
};

/**
 * Codex has two accounts, so its row lists them under the provider with the agents that use each.
 * Claude has one, so its row shows the provider name and offers Add account.
 */
export const ProviderAccounts: Story = {
  args: {
    embedded: true,
    label: undefined,
    hint: undefined,
    options: [
      {
        id: "deepseek",
        name: "Codex",
        state: "available",
        accounts: [
          {
            id: "default",
            label: "Work",
            email: "person@example.com",
            state: "connected",
            message: null,
            usedBy: ["Ada"],
          },
          {
            id: "a0123456789abcdef",
            label: null,
            email: "person@home.example",
            state: "connected",
            message: null,
            usedBy: ["Rex", "Mila"],
          },
        ],
      },
      {
        id: "deepseek",
        name: "Claude",
        state: "available",
        email: "person@example.com",
        accounts: [
          { id: "default", label: null, email: "person@example.com", state: "connected", message: null },
          { id: "a00000000000000002", label: null, email: null, state: "connecting", message: null },
        ],
      },
    ],
    accountActions: {
      connect: fn(async () => undefined),
      cancel: fn(async () => undefined),
      rename: fn(async () => undefined),
      remove: fn(async () => undefined),
    },
  },
};
