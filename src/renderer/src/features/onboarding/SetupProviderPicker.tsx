import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type CustomProviderRestart,
  type CustomProviderSummary,
  composedCustomModelId,
  customProviderOfModel,
  isLocalOnlyProvider,
  type ProviderRuntimeStatus,
  type SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  type ProviderConnection,
  ProviderPicker,
  type ProviderPickerOption,
} from "@openbot/ui/components/ProviderPicker";
import { connectedCustomProviders } from "@openbot/ui/components/provider-model-options";
import { freeModelsReady } from "@openbot/ui/components/provider-row";
import { CustomProviderDialog } from "@openbot/ui/features/custom-providers/CustomProviderDialog";
import { CustomProviderListDialog } from "@openbot/ui/features/custom-providers/CustomProviderListDialog";
import {
  isKeyDialogProvider,
  type KeyDialogProvider,
  OpenCodeKeyDialog,
  type ProviderKeyApi,
} from "@openbot/ui/features/settings/OpenCodeKeyDialog";
import { useText } from "@openbot/ui/text";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { createCustomProviderHostState } from "../custom-providers/custom-provider-host-state";
import { FREE_PROVIDER, onboardingProviderRows } from "./onboarding-provider-rows";
import { fallbackProviderState } from "./onboarding-provider-state";

/** The providers of this computer, and the actions on them, as both setup screens take them. */
export interface SetupProviderProps {
  agentStatus: AgentStatus;
  /**
   * The providers are those of a joined server's host. A provider that stays on its computer, such
   * as Cursor, then has a row only when the host's status lists it, as in Settings.
   */
  hostProviders?: boolean | undefined;
  refreshingProviders?: boolean | undefined;
  providerRuntimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>> | undefined;
  /** The newer runtime main offers per provider; the row's actions menu offers it as in Settings. */
  providerAvailableVersions?: Partial<Record<AgentProviderId, string | null>> | undefined;
  onUpdateProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderSignIn?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onDownloadProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onCancelProviderDownload?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onInstallProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  onSignInProvider?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  /**
   * Saves the optional OpenCode Go key. OpenCode runs free models without it, so its Connect row
   * button opens the key dialog rather than gating the step.
   */
  providerKeys?: ProviderKeyApi | undefined;
  /** How each row signs in: the browser sign-in of this computer, which a joined host does not offer. */
  connection?: ProviderConnection | undefined;
  onRefreshProviders?: (() => void | Promise<void>) | undefined;
  /** Accepts a described endpoint. Without it the step offers no custom provider at all. */
  onAddCustomProvider?: ((value: SaveCustomProviderInput) => Promise<CustomProviderRestart>) | undefined;
  onDeleteCustomProvider?: ((id: string) => Promise<CustomProviderRestart>) | undefined;
  /**
   * The endpoints already saved. They share one Custom provider row, which counts them and becomes a
   * choice beside the built-in providers, and a duplicate ID is a field error before the round trip.
   */
  customProviders?: readonly CustomProviderSummary[] | undefined;
}

/** How a screen shows the providers. */
export interface SetupProviderOptions {
  /**
   * Whether the free provider is a row and a choice the step can make by itself. First run asks
   * for it separately, so its plan step shows plan rows only. Without it, it is a row.
   */
  includeFree?: () => boolean;
}

/** The choice a screen opens with. A review opens with the saved one; the first run with none. */
export interface SetupProviderChoice {
  provider: AgentProviderId | null;
  /**
   * Set when the saved model is one of a custom endpoint, so the custom row holds the check. The
   * endpoint list loads after the screen opens, so the value can arrive late.
   */
  customModel: () => AgentModelId | null;
}

// The line that the plan providers share. It tells nothing about one row, so those rows show their
// version there.
const INCLUDED_DESCRIPTION = "Included with Dengerbot";

// A custom agent is not a first provider: it is added from the detected list or in Settings.
const SETUP_PROVIDERS: Array<{ id: AgentProviderId; name: string; description: string | null }> =
  AGENT_PROVIDER_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.id,
    name: descriptor.displayName,
    description: descriptor.onboardingDescription === INCLUDED_DESCRIPTION ? null : descriptor.onboardingDescription,
  }));

/**
 * The provider registry carries its onboarding line in English. A line that has no key here, such
 * as one a newer registry adds, shows as it is.
 */
const PROVIDER_DESCRIPTION_KEYS: Readonly<Record<string, AppTextKey>> = {
  "Free models, no account needed": "onboarding.provider.freeModels",
  "DeepSeek models with a DeepSeek API key": "onboarding.provider.deepseekKey",
};

/**
 * Whether setup can continue with this provider. A signed-in provider can; so can a downloaded
 * provider that runs free models, because it has no sign-in to wait for.
 */
function providerReady(option: ProviderPickerOption): boolean {
  return option.state === "available" || freeModelsReady(option);
}

/** The saved model when it names a custom endpoint. */
export function savedCustomModel(
  provider: AgentProviderId | null,
  model: AgentModelId | null,
  customProviders: readonly CustomProviderSummary[] | undefined,
): AgentModelId | null {
  if (provider !== FREE_PROVIDER || !model) return null;
  return customProviderOfModel(model, customProviders ?? []) ? model : null;
}

export type SetupProviders = ReturnType<typeof createSetupProviders>;

/**
 * The provider step of setup: its rows, its choice, the actions on a row, and the errors those
 * actions leave. The first-run flow and the setup dialog both hold one, so a provider is chosen,
 * connected and added the same way on each.
 */
export function createSetupProviders(
  props: SetupProviderProps,
  initial?: SetupProviderChoice,
  settings: SetupProviderOptions = {},
) {
  const { t } = useText();
  const includeFree = () => settings.includeFree?.() ?? true;
  const [selectedProvider, setSelectedProvider] = createSignal<AgentProviderId | null>(
    initial?.provider ?? FREE_PROVIDER,
  );
  /**
   * Whether the user chose their own endpoints rather than a built-in provider.
   */
  const [customSelected, setCustomSelected] = createSignal(Boolean(untrack(() => initial?.customModel())));
  /**
   * The model a new agent starts on while the custom row holds the choice. Only an endpoint saved
   * here names one: the user listed its models in the dialog a moment ago, and nothing else on this
   * screen chooses a model. Without one the provider falls back to the first model it lists.
   */
  const [customModel, setCustomModel] = createSignal<AgentModelId | null>(
    untrack(() => initial?.customModel()) ?? null,
  );
  // A saved choice is the user's own, so the automatic choice below does not replace it.
  const [providerSelectedByUser, setProviderSelectedByUser] = createSignal(true);
  /** The user chose a row on this screen, so a late saved choice does not replace it. */
  let choiceChanged = false;
  const [keyProvider, setKeyProvider] = createSignal<KeyDialogProvider | null>(null);
  const [error, setErrorText] = createSignal("");
  const [errorCode, setErrorCode] = createSignal<UserErrorDetails | null>(null);
  /** Shows `message`, with the code of `cause` when a failure gave one. */
  const setError = (message: string, cause?: unknown) => {
    setErrorText(message);
    const reference = cause === undefined ? null : errorReference(cause);
    setErrorCode(reference ? { message, reference } : null);
  };
  const [providerErrors, setProviderErrors] = createSignal<Partial<Record<AgentProviderId, string>>>({});
  const visibleError = createMemo(
    () => error() || SETUP_PROVIDERS.map((provider) => providerErrors()[provider.id]).find(Boolean) || "",
  );
  const previousConnectionStates = new Map<AgentProviderId, boolean>();
  const connectionStartingMessages = new Map<AgentProviderId, string | null>();
  const refreshedConnectionStates = new Set<AgentProviderId>();
  const providersAwaitingFocusRefresh = new Set<AgentProviderId>();
  let blurredAfterProviderConnect = false;
  let focusRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  const providerOptions = createMemo<ProviderPickerOption[]>(() =>
    SETUP_PROVIDERS.filter(
      (provider) =>
        !props.hostProviders ||
        !isLocalOnlyProvider(provider.id) ||
        props.agentStatus.providers?.some((candidate) => candidate.id === provider.id) === true,
    ).map((provider) => {
      const status = props.agentStatus.providers?.find((candidate) => candidate.id === provider.id);
      const runtime = props.providerRuntimeStatuses?.[provider.id];
      const descriptionKey = provider.description ? PROVIDER_DESCRIPTION_KEYS[provider.description] : undefined;
      return {
        ...provider,
        description: descriptionKey ? t(descriptionKey) : provider.description,
        state: status?.state ?? fallbackProviderState(props.agentStatus),
        message: status?.message,
        email: status?.email,
        connectionState: status?.connectionState,
        checkError: status?.checkError,
        availableVersion: props.providerAvailableVersions?.[provider.id] ?? null,
        // No provider runs free models in this build.
        freeModels: false,
        callout: null,
        runtimeStatus:
          runtime?.phase === "not-downloaded" && (status?.state === "available" || status?.state === "sign-in-required")
            ? { ...runtime, phase: "ready", version: status.version }
            : runtime,
      };
    }),
  );
  /**
   * The plan rows that stay in the list, in their order, or `null` until the user first acts on the
   * list. Until then the row rule can change the list when the provider status arrives. After that,
   * a row never moves or goes away under the pointer.
   */
  const [keptProviders, setKeptProviders] = createSignal<AgentProviderId[] | null>(null);
  /** The user chose the custom provider in "More providers", so it is a row from now on. */
  const [customRevealed, setCustomRevealed] = createSignal(true);
  /** The free row shows when the step includes it, or when the user chose it in "More providers". */
  const freeRow = () =>
    includeFree() || (selectedProvider() === FREE_PROVIDER && providerSelectedByUser() && !customSelected());
  const providerRows = createMemo(() => {
    const kept = keptProviders();
    const rows = onboardingProviderRows(providerOptions(), kept ?? [], freeRow());
    // A saved choice that the row rule hides still shows, after the rows the rule gives.
    const saved = initial?.provider;
    if (kept || !saved || rows.listed.some((option) => option.id === saved)) return rows;
    return onboardingProviderRows(providerOptions(), [...planRowIds(rows.listed), saved], freeRow());
  });
  const customInMore = () =>
    Boolean(props.onAddCustomProvider) && (props.customProviders ?? []).length === 0 && !customRevealed();

  /** Keeps the rows that the user sees now, and adds `provider` after them if it is not a row. */
  function keepProviderRows(provider?: AgentProviderId): void {
    const kept = keptProviders() ?? planRowIds(providerRows().listed);
    const next = provider && provider !== FREE_PROVIDER && !kept.includes(provider) ? [...kept, provider] : kept;
    if (next !== keptProviders()) setKeptProviders(next);
  }

  /** Chooses a row, or a provider in "More providers", which then becomes a row. */
  function chooseProvider(provider: AgentProviderId): void {
    keepProviderRows(provider);
    choiceChanged = true;
    setProviderSelectedByUser(true);
    setSelectedProvider(provider);
    setCustomSelected(false);
  }

  /** Endpoint configuration can be saved before the runtime is downloaded. */
  function chooseMoreCustom(): void {
    keepProviderRows();
    setCustomRevealed(true);
    selectCustomProvider();
    host.openForm();
  }

  /**
   * The dialogs that add and remove an endpoint. The state is shared with Settings, which carries the
   * same removal sentence and the same busy row; what happens after a save or a removal is this
   * step's own, because only this step starts an agent on the model it just learned about.
   */
  const host = createCustomProviderHostState({
    onAdd: (value) => props.onAddCustomProvider?.(value),
    onDelete: (id) => props.onDeleteCustomProvider?.(id),
    onSaved: selectSavedEndpoint,
    onRemoved: (id) => {
      // The save reads these two to decide whether to send a model, so a model of an endpoint that
      // is gone would be stored on the first agent. The remaining endpoints keep the row selected.
      if (customProviderOfModel(customModel(), [{ id }])?.id === id) setCustomModel(null);
      // The row stays where the user saw it, and does not go back into "More providers".
      setCustomRevealed(true);
      if ((props.customProviders ?? []).length === 0) setCustomSelected(false);
    },
  });

  /**
   * A model of an endpoint saved before this screen opened.
   *
   * Without it the custom choice would reach setup with no model, and a new agent would start on the
   * first model the catalog lists. The endpoint the user selected would then be unused, which is the
   * opposite of what the row says.
   */
  function firstSavedCustomModel(): AgentModelId | null {
    for (const provider of connectedCustomProviders(props.customProviders ?? [])) {
      const [model] = provider.models;
      if (model) return composedCustomModelId(provider.id, model.id);
    }
    return null;
  }

  /**
   * The endpoint the user just described is what they came here to use, so the step selects the
   * custom row rather than leaving the choice on whichever provider connected first, and its first
   * model becomes the one a new agent starts on.
   */
  function selectSavedEndpoint(value: SaveCustomProviderInput): void {
    const [firstModel] = value.models;
    if (firstModel) setCustomModel(composedCustomModelId(value.id, firstModel.id));
    selectCustomProvider();
  }

  function selectCustomProvider(): void {
    keepProviderRows();
    choiceChanged = true;
    setProviderSelectedByUser(true);
    setSelectedProvider(FREE_PROVIDER);
    setCustomSelected(true);
  }

  createEffect(
    () => initial?.customModel() ?? null,
    (model) => {
      if (!model || choiceChanged || customSelected()) return;
      setCustomSelected(true);
      setCustomModel(model);
    },
  );

  const selectedProviderConnected = createMemo(() => {
    const selected = selectedProvider();
    return Boolean(
      selected && providerOptions().some((provider) => provider.id === selected && providerReady(provider)),
    );
  });

  createEffect(
    () => ({
      options: providerOptions(),
      selected: selectedProvider(),
      selectedByUser: providerSelectedByUser(),
      withFree: includeFree(),
    }),
    ({ options: allOptions, selected, selectedByUser, withFree }) => {
      if (selectedByUser && selected && allOptions.some((provider) => provider.id === selected)) return;
      // A step without the free row does not choose the free provider by itself.
      const options = withFree ? allOptions : allOptions.filter((provider) => provider.id !== FREE_PROVIDER);
      if (selected && options.some((provider) => provider.id === selected && providerReady(provider))) return;
      // A signed-in provider comes first, then one whose CLI is on the computer. Free models are the
      // way in when the user has neither.
      const ready =
        options.find((provider) => provider.state === "available") ??
        options.find((provider) => provider.state === "sign-in-required" && !provider.freeModels) ??
        options.find((provider) => providerReady(provider));
      setSelectedProvider(ready?.id ?? null);
    },
  );

  createEffect(
    () => props.agentStatus.providers,
    (providers) => {
      for (const provider of SETUP_PROVIDERS) {
        const status = providers?.find((candidate) => candidate.id === provider.id);
        const connecting = status?.connectionState === "connecting";
        const wasConnecting = previousConnectionStates.get(provider.id) ?? false;
        if (wasConnecting && !connecting) {
          const startingMessage = connectionStartingMessages.get(provider.id) ?? null;
          if (refreshedConnectionStates.delete(provider.id)) {
            setProviderErrors((current) => ({ ...current, [provider.id]: undefined }));
          } else {
            setProviderErrors((current) => ({
              ...current,
              [provider.id]: status?.message && status.message !== startingMessage ? status.message : undefined,
            }));
          }
          connectionStartingMessages.delete(provider.id);
          if (status?.state === "available") providersAwaitingFocusRefresh.delete(provider.id);
        }
        previousConnectionStates.set(provider.id, connecting);
      }
    },
  );

  const handleWindowBlur = (): void => {
    if (providersAwaitingFocusRefresh.size > 0) blurredAfterProviderConnect = true;
  };
  const handleWindowFocus = (): void => {
    if (!blurredAfterProviderConnect || providersAwaitingFocusRefresh.size === 0 || focusRefreshTimer) return;
    const synchronize = (): void => {
      focusRefreshTimer = undefined;
      if (props.refreshingProviders) {
        focusRefreshTimer = setTimeout(synchronize, 250);
        return;
      }
      // A refresh cancels a sign-in that OpenBot runs, such as Gemini's Google sign-in. The browser
      // takes focus, so the user often comes back before the sign-in is complete. That sign-in
      // reports its own result.
      const signingIn = props.agentStatus.providers?.some(
        (status) => providersAwaitingFocusRefresh.has(status.id) && status.connectionState === "connecting",
      );
      if (signingIn) {
        blurredAfterProviderConnect = false;
        return;
      }
      providersAwaitingFocusRefresh.clear();
      blurredAfterProviderConnect = false;
      void refreshProviders();
    };
    focusRefreshTimer = setTimeout(synchronize, 250);
  };
  window.addEventListener("blur", handleWindowBlur);
  window.addEventListener("focus", handleWindowFocus);

  onCleanup(() => {
    window.removeEventListener("blur", handleWindowBlur);
    window.removeEventListener("focus", handleWindowFocus);
    if (focusRefreshTimer) clearTimeout(focusRefreshTimer);
  });

  function providerName(provider: AgentProviderId): string {
    return (
      SETUP_PROVIDERS.find((candidate) => candidate.id === provider)?.name ?? t("onboarding.provider.fallbackName")
    );
  }

  async function openProviderGuide(
    provider: AgentProviderId,
    action: ((provider: AgentProviderId) => void | Promise<void>) | undefined,
    kind: "install" | "sign-in",
  ): Promise<void> {
    if (!action) return;
    keepProviderRows();
    setError("");
    try {
      await action(provider);
    } catch (cause) {
      setError(
        kind === "install"
          ? t("onboarding.error.installGuide", { provider: providerName(provider) })
          : t("onboarding.error.signInGuide", { provider: providerName(provider) }),
        cause,
      );
    }
  }

  /** Key providers open the key dialog. */
  function signInProvider(provider: AgentProviderId): void {
    if (isKeyDialogProvider(provider) && props.providerKeys) {
      setKeyProvider(provider);
      return;
    }
    void openProviderGuide(provider, props.onSignInProvider, "sign-in");
  }

  /** No provider sign-in remains in slim: a provider either needs no credential or takes a key. */
  async function connectProvider(_provider: AgentProviderId): Promise<boolean> {
    return true;
  }

  /** Resolves `false` when the request failed; the error then says why. */
  async function downloadProvider(provider: AgentProviderId): Promise<boolean> {
    if (!props.onDownloadProvider) return true;
    keepProviderRows();
    setError("");
    setProviderErrors((current) => ({ ...current, [provider]: undefined }));
    setProviderSelectedByUser(true);
    setSelectedProvider(provider);
    try {
      await props.onDownloadProvider(provider);
      return true;
    } catch (cause) {
      setError(t("onboarding.error.download", { provider: providerName(provider) }), cause);
      return false;
    }
  }

  async function cancelProviderDownload(provider: AgentProviderId): Promise<void> {
    if (!props.onCancelProviderDownload) return;
    setError("");
    try {
      await props.onCancelProviderDownload(provider);
    } catch (cause) {
      setError(t("onboarding.error.cancelDownload", { provider: providerName(provider) }), cause);
    }
  }

  async function refreshProviders(): Promise<void> {
    if (!props.onRefreshProviders || props.refreshingProviders) return;
    setError("");
    setProviderErrors({});
    for (const provider of SETUP_PROVIDERS) {
      if (previousConnectionStates.get(provider.id)) refreshedConnectionStates.add(provider.id);
      previousConnectionStates.set(provider.id, false);
      connectionStartingMessages.delete(provider.id);
    }
    try {
      await props.onRefreshProviders();
    } catch (cause) {
      setError(t("onboarding.error.refresh"), cause);
    }
  }

  return {
    props,
    options: providerOptions,
    rows: providerRows,
    customInMore,
    selectedProvider,
    customSelected,
    /** The model to save with the custom row: the one described here, else one saved before. */
    customModel: () => customModel() ?? firstSavedCustomModel(),
    selectedProviderConnected,
    /** A provider action's error, or the message of a connection that ended without success. */
    error: visibleError,
    /** The code of the shown error, when a failure gave one. */
    errorReference: () => {
      const code = errorCode();
      return code && code.message === visibleError() ? code.reference : null;
    },
    setError,
    clearErrors: () => {
      setError("");
      setProviderErrors({});
    },
    keyProvider,
    closeKeyDialog: () => setKeyProvider(null),
    host,
    chooseProvider,
    chooseMoreCustom,
    selectCustomProvider,
    signInProvider,
    connectProvider,
    downloadProvider,
    /** Forgets the user's choice, so the step chooses again from the rows it shows. */
    clearChoice: () => {
      choiceChanged = true;
      setProviderSelectedByUser(false);
      setCustomSelected(false);
      setSelectedProvider(null);
    },
    cancelProviderDownload,
    refreshProviders,
    openProviderGuide,
  };
}

function planRowIds(listed: readonly ProviderPickerOption[]): AgentProviderId[] {
  return listed.map((option) => option.id).filter((id) => id !== FREE_PROVIDER);
}

export interface SetupProviderPickerProps {
  providers: SetupProviders;
  ariaLabel: string;
  label: string;
  hint: string;
  disabled: boolean;
  /** Where the row menus mount. A screen on the dialog layer passes itself, or they paint behind it. */
  menuMount: HTMLElement | undefined;
}

/** The provider list of setup, with the dialogs its rows open. */
export function SetupProviderPicker(props: SetupProviderPickerProps) {
  const { t } = useText();
  const source = () => props.providers.props;
  const lazyProviderMode = () => Boolean(source().providerRuntimeStatuses || source().onDownloadProvider);
  return (
    <>
      <ProviderPicker
        value={props.providers.selectedProvider()}
        options={props.providers.rows().listed}
        ariaLabel={props.ariaLabel}
        label={props.label}
        hint={props.hint}
        allowUnavailableSelection
        focusFirst
        disabled={props.disabled}
        refreshingProviders={source().refreshingProviders}
        connection={source().connection}
        onCancelProviderSignIn={source().onCancelProviderSignIn}
        onDownloadProvider={
          source().onDownloadProvider
            ? async (provider) => {
                await props.providers.downloadProvider(provider);
              }
            : undefined
        }
        onCancelProviderDownload={
          source().onCancelProviderDownload ? props.providers.cancelProviderDownload : undefined
        }
        onInstallProvider={
          source().onInstallProvider
            ? (provider) => props.providers.openProviderGuide(provider, source().onInstallProvider, "install")
            : undefined
        }
        onSignInProvider={
          source().onSignInProvider || source().providerKeys ? props.providers.signInProvider : undefined
        }
        onUpdateProvider={source().onUpdateProvider}
        menuMount={props.menuMount}
        onRefreshProviders={
          !lazyProviderMode() && source().onRefreshProviders ? props.providers.refreshProviders : undefined
        }
        onAddCustomProvider={source().onAddCustomProvider ? props.providers.host.openForm : undefined}
        customProviders={source().customProviders}
        customSelected={props.providers.customSelected()}
        onSelectCustomProvider={source().onAddCustomProvider ? props.providers.selectCustomProvider : undefined}
        onManageCustomProviders={source().onAddCustomProvider ? props.providers.host.openList : undefined}
        moreProviders={props.providers.rows().hidden}
        customInMore={props.providers.customInMore()}
        customEngine={props.providers.options().find((option) => option.id === FREE_PROVIDER)}
        versionInDetail
        moreCallout={{
          title: t("onboarding.provider.moreTitle"),
          detail: t("onboarding.provider.moreDetail"),
        }}
        onChooseMoreProvider={props.providers.chooseProvider}
        onChooseMoreCustom={props.providers.chooseMoreCustom}
        onChange={props.providers.chooseProvider}
      />
      <Show when={source().onAddCustomProvider}>
        <CustomProviderDialog
          open={props.providers.host.state.open}
          busy={props.providers.host.state.saving}
          submitError={props.providers.host.state.submitError}
          discovery={props.providers.host.state.discovery}
          onDiscoverModels={(endpoint) => void props.providers.host.discoverModels(endpoint)}
          takenProviderIds={(source().customProviders ?? []).map((provider) => provider.id)}
          onSubmit={(value, arkPlan) => void props.providers.host.submit(value, arkPlan)}
          onCancel={props.providers.host.closeForm}
        />
        <CustomProviderListDialog
          open={props.providers.host.state.manageOpen}
          providers={source().customProviders ?? []}
          removing={props.providers.host.state.removing}
          note={props.providers.host.state.note}
          onDelete={
            source().onDeleteCustomProvider ? (provider) => void props.providers.host.remove(provider) : undefined
          }
          onClose={props.providers.host.closeList}
        />
      </Show>
      <Show when={props.providers.keyProvider()} keyed>
        {(provider) => (
          <Show when={source().providerKeys}>
            {(api) => <OpenCodeKeyDialog api={api()} provider={provider} onClose={props.providers.closeKeyDialog} />}
          </Show>
        )}
      </Show>
      {/* Sits beside the picker it was started from, so the code covers the row rather
          than a step the user has not reached. */}
    </>
  );
}
