import type {
  ArkPlanDiscoveryCredentials,
  CustomProviderRestart,
  CustomProviderSummary,
  DiscoverModelsInput,
  DiscoverModelsResult,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { arkPlanKind, CUSTOM_PROVIDER_LIMITS, getDomesticProviderPreset } from "@openbot/contracts/ipc";
import type {
  CustomProviderEndpoint,
  ModelDiscovery,
} from "@openbot/ui/features/custom-providers/custom-provider-form";
import { customProviderUpdate } from "@openbot/ui/features/custom-providers/custom-provider-form";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { appPort } from "../../app-port";
import { customProviderRestartMessage } from "./custom-provider-restart";

interface CustomProviderHostState {
  /** The form that describes a new endpoint, or the saved one in `editing`. */
  open: boolean;
  /** The saved endpoint that the open form edits. Null for a new endpoint. */
  editing: CustomProviderSummary | null;
  /** The list of saved endpoints, where one is removed. */
  manageOpen: boolean;
  saving: boolean;
  discovery: ModelDiscovery;
  /** Shown inside the form, which stays open and keeps the endpoint the user typed. */
  submitError: string | null;
  /** The last outcome of a save or a removal: when the models catch up, or why they did not. */
  note: string | null;
  /** The ID being removed, so only that row's button is busy. */
  removing: string | null;
}

interface CustomProviderHostOptions {
  discoverModels?: (input: DiscoverModelsInput) => Promise<DiscoverModelsResult>;
  /** Absent, or absent for this host's props, leaves the state alone: no note and no error. */
  onAdd?: (value: SaveCustomProviderInput) => Promise<CustomProviderRestart> | undefined;
  onDelete?: (id: string) => Promise<CustomProviderRestart> | undefined;
  /** This computer only: the Team API has no edit route. */
  onUpdate?: (input: UpdateCustomProviderInput) => Promise<CustomProviderRestart> | undefined;
  /** Onboarding selects the endpoint it has just saved, and its first model with it. */
  onSaved?: (value: SaveCustomProviderInput) => void;
  /** Onboarding drops a model whose endpoint is gone. The saved list is already up to date here. */
  onRemoved?: (id: string) => void;
  /** Settings drops a default model that the edit took out. */
  onUpdated?: (input: UpdateCustomProviderInput) => void;
}

/**
 * The dialog state both hosts of the custom provider surfaces need: Settings and onboarding.
 *
 * It is shared for the removal alone. That path carries a busy ID and two message fallbacks, and a
 * second copy of it would drift silently. The removal question itself is in the shared list dialog.
 *
 * Each host builds its own instance, so no submit state is shared, and the two dialogs cannot open
 * at once: a stacked pair of overlays traps focus between them.
 */
export function createCustomProviderHostState(options: CustomProviderHostOptions) {
  const [state, setState] = createStore<CustomProviderHostState>({
    open: false,
    editing: null,
    manageOpen: false,
    saving: false,
    discovery: { status: "idle" },
    submitError: null,
    note: null,
    removing: null,
  });

  function openForm(): void {
    setState((current) => {
      current.discovery = { status: "idle" };
      current.open = true;
      current.editing = null;
      current.manageOpen = false;
      current.submitError = null;
    });
  }

  function openEdit(provider: CustomProviderSummary): void {
    setState((current) => {
      current.discovery = { status: "idle" };
      current.open = true;
      current.editing = provider;
      current.manageOpen = false;
      current.submitError = null;
    });
  }

  function closeForm(): void {
    setState((current) => {
      current.open = false;
    });
  }

  function openList(): void {
    setState((current) => {
      current.manageOpen = true;
      current.open = false;
      current.note = null;
    });
  }

  function closeList(): void {
    setState((current) => {
      current.manageOpen = false;
      current.note = null;
    });
  }

  /**
   * The save is awaited before the form closes: an earlier version closed first and dropped the
   * call, so a rejected save looked like a saved endpoint.
   */
  async function submit(value: SaveCustomProviderInput, arkPlan?: ArkPlanDiscoveryCredentials): Promise<void> {
    setState((current) => {
      current.saving = true;
      current.submitError = null;
      current.note = null;
    });
    try {
      if (arkPlanKind(value.baseUrl) && value.models.length === 0 && !arkPlan) {
        throw new Error(currentText().t("error.provider.planAccessKeyRequired"));
      }
      // Presets carry endpoints, never a static catalogue. Fetch with the new or saved key.
      if (getDomesticProviderPreset(value.id) && (value.models.length === 0 || arkPlan)) {
        const endpoint = {
          baseUrl: value.baseUrl,
          apiKey: value.apiKey,
          headers: value.headers,
          ...(arkPlan ? { arkPlan } : {}),
          ...(state.editing ? { savedProviderId: state.editing.id } : {}),
        };
        const result = await (options.discoverModels ?? appPort().providerDetection.discoverModels)(endpoint);
        if (result.models.length === 0) throw new Error(currentText().t("customProvider.preset.noModels"));
        if (result.models.length > CUSTOM_PROVIDER_LIMITS.models) {
          throw new Error(currentText().t("customProvider.error.modelsLimit", { max: CUSTOM_PROVIDER_LIMITS.models }));
        }
        value = { ...value, models: result.models.map((model) => ({ id: model.id, name: model.id })) };
      }
      const update = state.editing ? customProviderUpdate(value) : null;
      const restart = update ? await options.onUpdate?.(update) : await options.onAdd?.(value);
      setState((current) => {
        current.open = false;
        current.note = restart ? customProviderRestartMessage("Saved", restart, currentText().t) : null;
      });
      if (update) options.onUpdated?.(update);
      else options.onSaved?.(value);
    } catch (error) {
      setState((current) => {
        const text = currentText();
        current.submitError = text.errorMessage(error, text.t("customProvider.saveFailed"));
      });
    } finally {
      setState((current) => {
        current.saving = false;
      });
    }
  }

  /** Runs after the user accepts the removal question, which `CustomProviderListDialog` asks. */
  async function remove(provider: CustomProviderSummary): Promise<void> {
    setState((current) => {
      current.removing = provider.id;
      current.note = null;
    });
    try {
      const restart = await options.onDelete?.(provider.id);
      setState((current) => {
        current.note = restart ? customProviderRestartMessage("Removed", restart, currentText().t) : null;
      });
      options.onRemoved?.(provider.id);
    } catch (error) {
      setState((current) => {
        const text = currentText();
        current.note = text.errorMessage(error, text.t("customProvider.removeFailed", { name: provider.name }));
      });
    } finally {
      setState((current) => {
        current.removing = null;
      });
    }
  }

  async function discoverModels(endpoint: CustomProviderEndpoint): Promise<void> {
    setState((current) => {
      current.discovery = { status: "loading" };
    });
    try {
      const request = state.editing ? { ...endpoint, savedProviderId: state.editing.id } : endpoint;
      const result = await (options.discoverModels ?? appPort().providerDetection.discoverModels)(request);
      setState((current) => {
        current.discovery = { status: "found", models: result.models };
      });
    } catch (error) {
      const text = currentText();
      setState((current) => {
        current.discovery = {
          status: "failed",
          message: text.errorMessage(error, text.t("customProvider.discovery.empty")),
        };
      });
    }
  }

  return { state, discoverModels, openForm, openEdit, closeForm, openList, closeList, submit, remove };
}
