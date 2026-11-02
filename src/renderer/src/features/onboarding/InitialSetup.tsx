import {
  type AgentModelId,
  type AgentProviderId,
  type AppSetupState,
  agentProviderName,
  type DesktopPlatform,
} from "@openbot/contracts/ipc";
import { Button, Dialog, ErrorReference } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import {
  createSetupProviders,
  SetupProviderPicker,
  type SetupProviderProps,
  savedCustomModel,
} from "./SetupProviderPicker";

interface InitialSetupProps extends SetupProviderProps {
  state: AppSetupState;
  platform: DesktopPlatform;
  accountEmail: string;
  /**
   * Records the choice. An omitted model keeps the saved one while the provider stays the same;
   * `null` clears it; the custom row names the endpoint model that new agents start on.
   */
  onSave: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
  onLogout?: () => Promise<void>;
  onClose?: () => void;
}

export function InitialSetup(props: InitialSetupProps) {
  const { t, errorMessage } = useText();
  /**
   * The saved endpoint model, when the saved choice is the custom row. The state is the one saved
   * when the screen opened; the endpoint list can load later.
   */
  const savedState = untrack(() => props.state);
  const savedEndpointModel = createMemo(() =>
    savedCustomModel(savedState.preferredProvider, savedState.preferredModel, props.customProviders),
  );
  /**
   * Stays true once the saved model is known to be an endpoint's. A removal of that endpoint then
   * empties `savedEndpointModel`, but the save must still clear the model.
   */
  let savedModelIsEndpoint = false;
  createEffect(savedEndpointModel, (model) => {
    if (model) savedModelIsEndpoint = true;
  });
  const providers = createSetupProviders(props, {
    provider: savedState.preferredProvider,
    customModel: savedEndpointModel,
  });
  const selectedProvider = providers.selectedProvider;
  const setError = providers.setError;
  const error = providers.error;
  /** The screen sits on the dialog layer, so the row menus mount in it rather than behind it. */
  const [dialogElement, setDialogElement] = createSignal<HTMLElement | undefined>();
  const [saving, setSaving] = createSignal(false);
  async function saveLocal(): Promise<void> {
    const provider = selectedProvider();
    if (!provider || saving()) return;
    setSaving(true);
    setError("");
    try {
      // The custom row names its model. A built-in row keeps the saved model, unless the saved
      // model was the custom row's: the user chose another row, so that model must go.
      await props.onSave(
        provider,
        providers.customSelected() ? providers.customModel() : savedModelIsEndpoint ? null : undefined,
      );
    } catch (cause) {
      setError(errorMessage(cause, t("onboarding.setup.saveFailed")), cause);
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && props.onClose?.()}>
      <main class="initial-setup-screen">
        <Dialog.Content as="section" class="initial-setup" data-dialog-surface="unstyled" ref={setDialogElement}>
          <header class="initial-setup-header">
            <div class="initial-setup-account-row">
              <span class="initial-setup-account">
                <i aria-hidden="true" />
                {props.accountEmail}
              </span>
              <Show when={props.onLogout}>
                <Button
                  variant="ghost"
                  type="button"
                  class="initial-setup-signout"
                  onClick={() => void props.onLogout?.()}
                >
                  {t("onboarding.setup.signOut")}
                </Button>
              </Show>
            </div>
            <p class="initial-setup-eyebrow">{t("onboarding.setup.eyebrow")}</p>
            <Dialog.Title as="h1" id="initial-setup-title">
              {t("onboarding.setup.localTitle")}
            </Dialog.Title>
            <Dialog.Description as="p" id="initial-setup-description" class="initial-setup-intro">
              {t("onboarding.setup.localDescription")}
            </Dialog.Description>
          </header>

          <div class="setup-local-content">
            <SetupProviderPicker
              providers={providers}
              ariaLabel={t("onboarding.setup.defaultProvider")}
              label={t("onboarding.setup.defaultProvider")}
              hint={t("onboarding.setup.defaultProviderHint")}
              disabled={saving()}
              menuMount={dialogElement()}
            />

            <ComputerUseSetup variant="compact" />
          </div>

          <Show when={error()}>
            <p class="initial-setup-error" role="alert">
              {error()}
              <ErrorReference reference={providers.errorReference()} />
            </p>
          </Show>

          <div class="initial-setup-actions">
            <Button
              variant="default"
              type="button"
              class="initial-setup-save"
              disabled={saving() || !selectedProvider()}
              onClick={() => void saveLocal()}
            >
              {saving()
                ? t("common.saving")
                : selectedProvider()
                  ? t("onboarding.setup.continueWith", {
                      provider: providers.customSelected()
                        ? t("provider.custom.name")
                        : agentProviderName(selectedProvider() ?? "deepseek"),
                    })
                  : t("onboarding.setup.chooseProvider")}
            </Button>
          </div>
        </Dialog.Content>
      </main>
    </Dialog.Root>
  );
}
