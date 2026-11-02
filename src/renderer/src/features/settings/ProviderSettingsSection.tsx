import {
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type AppSetupState,
  agentProviderName,
  type CustomProviderRestart,
  type CustomProviderSummary,
  composedCustomModelId,
  customProviderOfModel,
  type ProviderApiKeyStatus,
  type ProviderRuntimeStatus,
  type SaveCustomProviderInput,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { Text } from "@openbot/ui";
import type { ProviderConnection } from "@openbot/ui/components/ProviderPicker";
import type { ProviderAccountActions } from "@openbot/ui/components/provider-accounts";
import { connectedCustomProviders } from "@openbot/ui/components/provider-model-options";
import type { AccountUsageProviderRow } from "@openbot/ui/features/account/account-usage-view";
import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { savedCustomProviderDraft } from "@openbot/ui/features/custom-providers/custom-provider-form";
import {
  isKeyDialogProvider,
  type KeyDialogProvider,
  OpenCodeKeyDialog,
  type ProviderKeyApi,
} from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import {
  type ProviderDefaultChoice,
  type ProviderPromptCache,
  type ProviderSettingsDetail,
  ProviderSettingsPage,
} from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, createStore, Show, untrack } from "solid-js";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { savedCustomModel } from "../onboarding/SetupProviderPicker";
import { DshRuntimeSection } from "./DshRuntimeSection";
import { createProviderPromptCache, type ProviderPromptCacheSource } from "./provider-prompt-cache";
import { createSettingsGeneralStore, type SettingsGeneralStore } from "./stores/general-store";

interface DefaultProviderSettings extends Pick<AppSetupState, "preferredProvider" | "preferredModel"> {
  save: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
}

interface ProviderSettingsSectionProps {
  defaultProvider?: DefaultProviderSettings | undefined;
  store: SettingsGeneralStore;
  /** The dialog element the Select popovers portal into, captured when the section was created. */
  selectMount: HTMLElement | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Accepts a described endpoint. Without it the section offers no custom provider at all, which is
   * how a remote server hides the whole feature: these endpoints merge into the OpenCode process on
   * this computer.
   */
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  /** The endpoints already saved, without their keys. Empty until the first list arrives. */
  customProviders?: readonly CustomProviderSummary[] | undefined;
  /** Without it the rows are listed but not removable, which is what a story without the callback shows. */
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  /** Without it the rows have no Edit. This computer only: the Team API has no edit route. */
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** How each row signs in on this computer, when it can open a browser here. */
  connection?: ProviderConnection | undefined;
  /** Adds, names and removes the accounts of each provider that can hold more than one. */
  accountActions?: ProviderAccountActions | undefined;
  usage?: readonly AccountUsageProviderRow[] | undefined;
  onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
  promptCache?: ProviderPromptCache | undefined;
}

/** The provider list of the computer the agents run on, with its custom endpoint dialogs. */
function ProviderSettingsSection(props: ProviderSettingsSectionProps) {
  const i18n = useText();
  const customProviders = () =>
    (props.customProviders ?? []).filter((provider) => !provider.id.startsWith("subscription-"));
  const [saving, setSaving] = createStore<{
    pending: { provider: AgentProviderId; custom: boolean } | null;
    error: string;
  }>({ pending: null, error: "" });
  const [downloadError, setDownloadError] = createSignal("");
  const defaultCustomModel = () => {
    const choice = props.defaultProvider;
    return choice ? savedCustomModel(choice.preferredProvider, choice.preferredModel, customProviders()) : null;
  };

  async function selectProvider(
    provider: AgentProviderId,
    custom = false,
    selectedModel?: AgentModelId | null,
  ): Promise<void> {
    if (saving.pending) return;
    const choice = props.defaultProvider;
    if (!choice) return;
    // A custom row uses its saved model, or the first model of the first saved endpoint.
    const endpoint = connectedCustomProviders(customProviders())[0];
    const firstModel = endpoint?.models[0];
    const model = custom
      ? (defaultCustomModel() ?? (endpoint && firstModel ? composedCustomModelId(endpoint.id, firstModel.id) : null))
      : defaultCustomModel()
        ? null
        : undefined;
    setSaving(() => ({ pending: { provider, custom }, error: "" }));
    try {
      await choice.save(provider, selectedModel === undefined ? model : selectedModel);
    } catch (error) {
      setSaving((state) => {
        state.error = i18n.errorMessage(error, i18n.t("onboarding.setup.saveFailed"));
      });
    } finally {
      setSaving((state) => {
        state.pending = null;
      });
    }
  }
  /** A first download that fails rejects with no notification of its own, so its reason is shown here. */
  async function downloadProvider(provider: AgentProviderId): Promise<void> {
    const download = props.onDownloadProvider;
    if (!download) return;
    setDownloadError("");
    try {
      await download(provider);
    } catch (error) {
      setDownloadError(
        i18n.errorMessage(error, i18n.t("onboarding.error.download", { provider: agentProviderName(provider) })),
      );
    }
  }
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onUpdate: (input) => props.onUpdateCustomProvider?.(input),
    onSaved: (value) => {
      const [firstModel] = value.models;
      if (firstModel && props.defaultProvider && !defaultCustomModel()) {
        void selectProvider("deepseek", true, composedCustomModelId(value.id, firstModel.id));
      }
    },
    onRemoved: (id) => {
      const current = defaultCustomModel();
      if (!current || customProviderOfModel(current, [{ id }])?.id !== id) return;
      const remaining = connectedCustomProviders(customProviders()).filter((item) => item.id !== id);
      const nextEndpoint = remaining[0];
      const nextModel = nextEndpoint?.models[0];
      if (nextEndpoint && nextModel) {
        void selectProvider("deepseek", true, composedCustomModelId(nextEndpoint.id, nextModel.id));
      } else {
        void selectProvider("deepseek", false, null);
      }
    },
    // Main moves the agents off a model that the edit took out. The default model is the renderer's.
    onUpdated: (input) => {
      const current = defaultCustomModel();
      if (!current || customProviderOfModel(current, [{ id: input.id }])?.id !== input.id) return;
      const kept = input.models.some((model) => composedCustomModelId(input.id, model.id) === current);
      if (kept) return;
      const [firstModel] = input.models;
      if (firstModel) {
        void selectProvider("deepseek", true, composedCustomModelId(input.id, firstModel.id));
      }
    },
  });
  const editing = () => host.state.editing;
  const editDraft = () => {
    const provider = editing();
    return provider ? savedCustomProviderDraft(provider) : undefined;
  };

  return (
    // The tab title already names this list, so it has no heading of its own.
    <div class="settings-provider-section">
      <ProviderSettingsPage
        options={props.store.providerOptions()}
        defaultProvider={
          props.defaultProvider
            ? {
                get value(): ProviderDefaultChoice | null {
                  if (saving.pending) return saving.pending.custom ? "custom" : saving.pending.provider;
                  return defaultCustomModel() ? "custom" : (props.defaultProvider?.preferredProvider ?? null);
                },
                get pending() {
                  return Boolean(saving.pending);
                },
                onChange: (choice: ProviderDefaultChoice) => {
                  if (choice === "custom") {
                    if (!connectedCustomProviders(customProviders()).length) {
                      host.openForm();
                      return;
                    }
                    void selectProvider("deepseek", true);
                    return;
                  }
                  void selectProvider(choice);
                },
              }
            : undefined
        }
        disabled={Boolean(saving.pending)}
        usage={props.usage}
        customProviders={customProviders()}
        onDownloadProvider={props.onDownloadProvider ? downloadProvider : undefined}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onRestartProvider={props.onRestartProvider}
        onCancelProviderRestart={props.onCancelProviderRestart}
        onSetProviderOn={props.onSetProviderOn}
        onCancelProviderSignIn={props.onCancelProviderSignIn}
        connection={props.connection}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={props.onAddCustomProvider ? host.openForm : undefined}
        onEditCustomProvider={props.onUpdateCustomProvider ? host.openEdit : undefined}
        onRemoveCustomProvider={props.onDeleteCustomProvider ? (provider) => void host.remove(provider) : undefined}
        removingCustomProvider={host.state.removing}
        onSignInProvider={props.onSignInProvider}
        accountActions={props.accountActions}
        menuMount={props.selectMount}
        onDetailChange={props.onDetailChange}
        promptCache={props.promptCache}
      />
      <DshRuntimeSection />
      <Show when={saving.error}>
        <Text role="alert">{saving.error}</Text>
      </Show>
      <Show when={downloadError()}>
        <Text role="alert">{downloadError()}</Text>
      </Show>
      <Show when={host.state.note}>
        {(message) => (
          <Text tone="muted" variant="caption" role="status">
            {message()}
          </Text>
        )}
      </Show>
      <Show when={props.onAddCustomProvider}>
        <CustomProviderDialog
          open={host.state.open}
          discovery={host.state.discovery}
          onDiscoverModels={(endpoint) => void host.discoverModels(endpoint)}
          draft={editDraft()}
          providerIdLocked={Boolean(editing())}
          apiKeyKept={Boolean(editing()?.hasApiKey)}
          busy={host.state.saving}
          submitError={host.state.submitError}
          takenProviderIds={customProviders().map((provider) => provider.id)}
          onSubmit={(value, arkPlan) => void host.submit(value, arkPlan)}
          onCancel={host.closeForm}
        />
      </Show>
    </div>
  );
}

/**
 * Whether the API key dialog is open, and whether the key is saved, for the row's badge.
 *
 * The badge is read through the key API like the dialog does, on open and after the dialog closes
 * with a save or a removal. Absent until the first read, and on a read failure, so the row shows no
 * key badge rather than a wrong one.
 */
function createProviderKeyState(props: { readonly open: boolean; readonly providerKeys?: ProviderKeyApi | undefined }) {
  const [keyDialogOpen, setKeyDialogOpen] = createSignal(false);
  const [keyProvider, setKeyProvider] = createSignal<KeyDialogProvider>("deepseek");
  const [apiKeyStatus, setApiKeyStatus] = createSignal<ProviderApiKeyStatus | undefined>(undefined);
  async function readKeyStatus(keys: ProviderKeyApi, provider: AgentProviderId) {
    try {
      return (await keys.getProviderApiKeyState(provider)).status;
    } catch {
      return undefined;
    }
  }
  async function refreshKeyStatus(): Promise<void> {
    const keys = props.providerKeys;
    if (!keys) return;
    const status = await readKeyStatus(keys, "deepseek");
    // An answer from a source the modal has since left belongs to the other computer.
    if (keys !== props.providerKeys) return;
    setApiKeyStatus(status);
  }
  // The badge has to answer on first paint: the key state arrives after the rows, so an open
  // without a read would show no badge until something else re-renders the list. The keys can move
  // to a joined server's host while the modal is open, when that host's admin role arrives, so a
  // new source is read again rather than keeping the other computer's answer.
  createEffect(
    () => (props.open ? props.providerKeys : undefined),
    (keys) => {
      setApiKeyStatus(undefined);
      if (keys) void untrack(refreshKeyStatus);
    },
  );
  return {
    keyDialogOpen,
    keyProvider,
    apiKeyStatus,
    /** Only the providers whose sign-in can be a pasted key are served. */
    openKeyDialog(provider: AgentProviderId): void {
      if (isKeyDialogProvider(provider)) {
        setKeyProvider(provider);
        setKeyDialogOpen(true);
      }
    },
    closeKeyDialog(): void {
      setKeyDialogOpen(false);
      void refreshKeyStatus();
    },
  };
}

type ProviderKeyState = ReturnType<typeof createProviderKeyState>;

/** The key and sign-in dialogs the section opens. Both portal over the dialog they open from. */
function ProviderSettingsDialogs(props: { keys: ProviderKeyState; providerKeys?: ProviderKeyApi | undefined }) {
  return (
    <>
      <Show when={props.keys.keyDialogOpen() && props.providerKeys}>
        {(api) => (
          <OpenCodeKeyDialog api={api()} provider={props.keys.keyProvider()} onClose={props.keys.closeKeyDialog} />
        )}
      </Show>
    </>
  );
}

/** The providers of one server's computer, as its server settings section takes them. */
export interface HostProviderSettings {
  /** Saved default for new local agents. Remote host settings do not change this computer's default. */
  defaultProvider?: DefaultProviderSettings | undefined;
  agentStatus: AgentStatus;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** The provider restart is of this computer, so only its section has it. */
  onRestartProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderRestart?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * The stories can supply off providers. Production reads the saved switches from agentStatus.
   */
  offProviders?: readonly AgentProviderId[] | undefined;
  /** The names of the agents that use each provider. A provider with one stays on. */
  providerUsers?: Partial<Record<AgentProviderId, readonly string[]>> | undefined;
  /** The names of the agents that use each account, by provider and account. */
  providerAccountUsers?: Partial<Record<AgentProviderId, Readonly<Record<string, readonly string[]>>>> | undefined;
  /** Adds, names and removes provider accounts on the computer that runs the providers. */
  accountActions?: ProviderAccountActions | undefined;
  onSetProviderOn?: ((provider: AgentProviderId, on: boolean) => void | Promise<void>) | undefined;
  customProviders?: readonly CustomProviderSummary[] | undefined;
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  /** This computer only: the Team API has no edit route, so a joined server's section has no Edit. */
  onUpdateCustomProvider?: ((input: UpdateCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  providerKeys?: ProviderKeyApi | undefined;
  /** How each row signs in on this computer. A joined host has its own sign-in routes. */
  connection?: ProviderConnection | undefined;
  /** The browser sign-in and the install guide open on this computer, so only its section has them. */
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /** The scan is of this computer, so a joined server's section shows no found list. */
  /** Called each time the section is shown, for the scan of this computer. */
  onShown?: (() => void) | undefined;
  /** The usage readings of each account, for the badge of an account that is low. */
  usage?: readonly AccountUsageProviderRow[] | undefined;
}

/**
 * The whole Providers section for a server: its list, and the dialogs it opens. Without `hostName`
 * the providers are this computer's.
 */
export function HostProviderSettingsPanel(
  props: HostProviderSettings & {
    hostName?: string | undefined;
    selectMount: HTMLElement | undefined;
    onDetailChange?: ((detail: ProviderSettingsDetail | null) => void) | undefined;
    /** The Claude page's prompt cache time, for a host with `prompt-cache-ttl-v1` that this account administers. */
    promptCache?: ProviderPromptCacheSource | undefined;
  },
) {
  const promptCache = createProviderPromptCache(() => props.promptCache);
  const keys = createProviderKeyState({
    open: true,
    get providerKeys() {
      return props.providerKeys;
    },
  });
  const store = createSettingsGeneralStore({
    get agentStatus() {
      return props.agentStatus;
    },
    get providerRuntimeStatuses() {
      return props.providerRuntimeStatuses;
    },
    get providerAvailableVersions() {
      return props.providerAvailableVersions;
    },
    deepseekKeyStatus: keys.apiKeyStatus,
    get providerHostName() {
      return props.hostName;
    },
    get offProviders() {
      return props.offProviders;
    },
    get providerUsers() {
      return props.providerUsers;
    },
    get providerAccountUsers() {
      return props.providerAccountUsers;
    },
  });
  return (
    <>
      <ProviderSettingsSection
        defaultProvider={props.defaultProvider}
        store={store}
        selectMount={props.selectMount}
        onDownloadProvider={props.onDownloadProvider}
        onCancelProviderDownload={props.onCancelProviderDownload}
        onUpdateProvider={props.onUpdateProvider}
        onRestartProvider={props.onRestartProvider}
        onCancelProviderRestart={props.onCancelProviderRestart}
        onSetProviderOn={props.onSetProviderOn}
        onCancelProviderSignIn={props.onCancelProviderSignIn}
        connection={props.connection}
        onInstallProvider={props.onInstallProvider}
        onAddCustomProvider={props.onAddCustomProvider}
        customProviders={props.customProviders}
        onDeleteCustomProvider={props.onDeleteCustomProvider}
        onUpdateCustomProvider={props.onUpdateCustomProvider}
        accountActions={props.accountActions}
        onSignInProvider={props.providerKeys ? keys.openKeyDialog : undefined}
        usage={props.usage}
        onDetailChange={props.onDetailChange}
        promptCache={promptCache()}
      />
      <ProviderSettingsDialogs keys={keys} providerKeys={props.providerKeys} />
    </>
  );
}
