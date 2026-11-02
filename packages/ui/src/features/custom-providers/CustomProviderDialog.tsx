import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ArkPlanDiscoveryCredentials, SaveCustomProviderInput } from "@openbot/contracts/ipc";
import { arkPlanKind, CUSTOM_PROVIDER_LIMITS, getDomesticProviderPreset } from "@openbot/contracts/ipc";
import {
  ArrowLeft,
  Button,
  Checkbox,
  Dialog,
  Field,
  Heading,
  IconButton,
  Input,
  RefreshCw,
  SlidersHorizontal,
  Spinner,
  Text,
  X,
} from "@openbot/ui";
import {
  createEffect,
  createSignal,
  createStore,
  createUniqueId,
  For,
  Match,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { createScrollFades } from "../../components/createScrollFades";
import { useText } from "../../text";
import { CustomProviderLogo } from "./CustomProviderLogo";
import {
  type CustomProviderDraft,
  type CustomProviderEndpoint,
  type CustomProviderErrors,
  customProviderEndpoint,
  customProviderValue,
  type DiscoveredModel,
  emptyCustomProviderDraft,
  hasCustomProviderError,
  type ModelDiscovery,
  validateCustomProvider,
} from "./custom-provider-form";
import { type RepeatableColumn, RepeatableRows } from "./RepeatableRows";

// Examples of identifiers and addresses. They are not words, so they are the same in each language.
const PROVIDER_ID_PLACEHOLDER = "my-provider";
const BASE_URL_PLACEHOLDER = "https://api.example.com/v1";
const MODEL_ID_PLACEHOLDER = "model-id";
const HEADER_NAME_PLACEHOLDER = "Header-Name";

type ModelRow = CustomProviderDraft["models"][number];
type HeaderRow = CustomProviderDraft["headers"][number];

/**
 * Storybook and Solid both hand this object over as a proxy, and `structuredClone` refuses a proxy
 * with a `DataCloneError`, so the two nested lists are copied by hand.
 */
function cloneDraft(draft: CustomProviderDraft): CustomProviderDraft {
  return {
    ...draft,
    models:
      getDomesticProviderPreset(draft.providerId) &&
      !getDomesticProviderPreset(draft.providerId)?.regions?.some(
        (region) => region.baseUrl === draft.baseUrl && region.noList,
      )
        ? []
        : draft.models.map((model) => ({ ...model })),
    headers: draft.headers.map((header) => ({ ...header })),
  };
}

interface CustomProviderDialogProps {
  open: boolean;
  /** Prefilled fields, for editing a provider or for a story. Defaults to a blank form. */
  draft?: CustomProviderDraft | undefined;
  /** Set by a story to show the messages without typing into every field first. */
  showErrors?: boolean | undefined;
  busy?: boolean | undefined;
  submitError?: string | null | undefined;
  /**
   * The provider IDs already saved. A duplicate is a field error before a round trip; main refuses
   * one as well, because this list is only as fresh as the last list the renderer was given.
   */
  takenProviderIds?: readonly string[] | undefined;
  /** Edit of a saved endpoint: the ID names it, so it cannot change. */
  providerIdLocked?: boolean | undefined;
  /** Main holds a key or headers for this endpoint. A blank key field keeps them. */
  apiKeyKept?: boolean | undefined;
  /**
   * The last model list request. The host owns it because the request leaves the renderer. Without
   * `onDiscoverModels` the dialog has no find control and only the typed rows.
   */
  discovery?: ModelDiscovery | undefined;
  onDiscoverModels?: ((endpoint: CustomProviderEndpoint) => void) | undefined;
  onSubmit: (value: SaveCustomProviderInput, arkPlan?: ArkPlanDiscoveryCredentials) => void;
  onCancel: () => void;
  onBack?: (() => void) | undefined;
}

export function CustomProviderDialog(props: CustomProviderDialogProps) {
  const { t } = useText();
  // The form owns its state from here on: the incoming draft is read once, as a snapshot, so later
  // edits by the caller do not reach in and overwrite what the user is typing.
  const [draft, setDraft] = createStore<CustomProviderDraft>(
    untrack(() => (props.draft ? cloneDraft(props.draft) : emptyCustomProviderDraft())),
  );
  // Nothing is red until the user has asked OpenBot to accept the form, so a blank form does not
  // open covered in messages about fields nobody has reached yet.
  const [arkCredentials, setArkCredentials] = createStore<ArkPlanDiscoveryCredentials>({
    accessKeyId: "",
    secretAccessKey: "",
    edition: "personal",
  });
  const arkPlanValue = (): ArkPlanDiscoveryCredentials | undefined =>
    arkPlanKind(draft.baseUrl) && arkCredentials.accessKeyId.trim() && arkCredentials.secretAccessKey.trim()
      ? {
          accessKeyId: arkCredentials.accessKeyId.trim(),
          secretAccessKey: arkCredentials.secretAccessKey.trim(),
          edition: arkCredentials.edition,
        }
      : undefined;
  const modelEndpoint = (): CustomProviderEndpoint => ({
    ...customProviderEndpoint(draft),
    ...(arkPlanValue() ? { arkPlan: arkPlanValue() } : {}),
  });
  const [showKey, setShowKey] = createSignal(false);
  const [submitted, setSubmitted] = createSignal(untrack(() => Boolean(props.showErrors)));

  /**
   * Both hosts keep this dialog mounted after a close, and the draft above is a snapshot, so without
   * this a second "Add provider" reopens the form still holding the last endpoint - including its API
   * key. Re-snapshot on the false-to-true edge only, never while the dialog is open.
   */
  createEffect(
    () => props.open,
    (open, previous) => {
      if (!open) {
        setArkCredentials((state) => {
          state.accessKeyId = "";
          state.secretAccessKey = "";
        });
        return;
      }
      if (previous) return;
      // A snapshot: a later change of the draft prop must not reach the open form.
      const next = untrack(() => props.draft);
      setDraft(() => (next ? cloneDraft(next) : emptyCustomProviderDraft()));
      setSubmitted(untrack(() => Boolean(props.showErrors)));
      setShowKey(false);
    },
  );

  const preset = () => (props.providerIdLocked ? getDomesticProviderPreset(draft.providerId) : undefined);
  const errors = () => {
    const result = validateCustomProvider(draft, { taken: props.takenProviderIds, locked: props.providerIdLocked }, t);
    if (preset() && !draft.models.some((model) => model.id.trim())) result.models = undefined;
    if (preset() && props.apiKeyKept && draft.baseUrl !== props.draft?.baseUrl && !draft.apiKey.trim()) {
      result.apiKey = t("customProvider.preset.regionKey");
    }
    return result;
  };
  const shown = (): CustomProviderErrors | null => (submitted() ? errors() : null);
  const busy = () => Boolean(props.busy);
  const discovery = (): ModelDiscovery => props.discovery ?? { status: "idle" };

  // The form itself scrolls, and its own box keeps the same size when a row is added, so the
  // helper's ResizeObserver never fires for new content. Remeasure on what changes the height.
  const fades = createScrollFades();
  onSettled(() => fades.stop);
  createEffect(
    () => ({
      models: draft.models.length,
      headers: draft.headers.length,
      errors: shown(),
      discovery: discovery().status,
    }),
    () => fades.remeasure(),
  );

  const modelColumns: readonly [RepeatableColumn<ModelRow>, RepeatableColumn<ModelRow>] = [
    {
      label: (number) => t("customProvider.model.id", { number }),
      placeholder: () => MODEL_ID_PLACEHOLDER,
      maxlength: INPUT_LIMITS.modelName,
      identifier: true,
      read: (row) => row.id,
      write: (index, value) =>
        setDraft((state) => {
          const model = state.models[index];
          if (model) model.id = value;
        }),
    },
    {
      label: (number) => t("customProvider.model.name", { number }),
      placeholder: () => t("customProvider.model.namePlaceholder"),
      maxlength: INPUT_LIMITS.modelName,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          const model = state.models[index];
          if (model) model.name = value;
        }),
    },
  ];

  const headerColumns: readonly [RepeatableColumn<HeaderRow>, RepeatableColumn<HeaderRow>] = [
    {
      label: (number) => t("customProvider.header.name", { number }),
      placeholder: () => HEADER_NAME_PLACEHOLDER,
      maxlength: INPUT_LIMITS.identifier,
      identifier: true,
      read: (row) => row.name,
      write: (index, value) =>
        setDraft((state) => {
          const header = state.headers[index];
          if (header) header.name = value;
        }),
    },
    {
      label: (number) => t("customProvider.header.value", { number }),
      placeholder: () => t("customProvider.header.valuePlaceholder"),
      maxlength: CUSTOM_PROVIDER_LIMITS.apiKey,
      identifier: true,
      read: (row) => row.value,
      write: (index, value) =>
        setDraft((state) => {
          const header = state.headers[index];
          if (header) header.value = value;
        }),
    },
  ];

  const discoveryFailed = () => {
    const state = discovery();
    return state.status === "failed" ? state.message : undefined;
  };
  const discovered = () => {
    const state = discovery();
    return state.status === "found" ? state.models : undefined;
  };
  const discoveryId = createUniqueId();
  const listed = (id: string) => draft.models.some((model) => model.id.trim() === id);

  /** A found model is a row in the same list the user types into, so submit has one source. */
  function toggleModel(model: DiscoveredModel, checked: boolean): void {
    setDraft((state) => {
      if (!checked) {
        const index = state.models.findIndex((row) => row.id.trim() === model.id);
        if (index >= 0) state.models.splice(index, 1);
        if (state.models.length === 0) state.models.push({ id: "", name: "" });
        return;
      }
      if (state.models.some((row) => row.id.trim() === model.id)) return;
      const row = { id: model.id, name: model.name ?? model.id };
      // The blank row that a new form opens with is a placeholder, not a model the user added.
      const blank = state.models.findIndex((entry) => !entry.id.trim() && !entry.name.trim());
      if (blank >= 0) state.models[blank] = row;
      else state.models.push(row);
    });
  }

  function submit(): void {
    setSubmitted(true);
    if (busy() || hasCustomProviderError(errors())) return;
    props.onSubmit(customProviderValue(draft), arkPlanValue());
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && !busy() && props.onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay class="custom-provider-backdrop">
          <Dialog.Content as="section" class="custom-provider-dialog" aria-busy={busy() ? "true" : undefined}>
            <Dialog.Title class="sr-only">
              {props.providerIdLocked ? t("customProvider.form.editTitle") : t("customProvider.form.title")}
            </Dialog.Title>
            <Dialog.Description class="sr-only">{t("customProvider.form.description")}</Dialog.Description>

            <header class="custom-provider-header">
              <Show when={props.onBack}>
                <IconButton
                  label={t("common.back")}
                  variant="ghost"
                  disabled={busy()}
                  data-cuelume-tap="navigate"
                  onClick={() => props.onBack?.()}
                >
                  <ArrowLeft />
                </IconButton>
              </Show>
              <span class="custom-provider-mark" aria-hidden="true">
                <Show when={preset()} fallback={<SlidersHorizontal />}>
                  {(provider) => <CustomProviderLogo providerId={provider().id} />}
                </Show>
              </span>
              <div class="custom-provider-title">
                <Heading as="h2" size="md">
                  {preset()?.name ?? t("customProvider.form.heading")}
                </Heading>
                <Text tone="muted" variant="caption">
                  {preset() ? t("customProvider.preset.keySubtitle") : t("customProvider.form.subtitle")}
                </Text>
              </div>
              <IconButton
                class="custom-provider-close"
                label={t("common.close")}
                variant="ghost"
                disabled={busy()}
                onClick={props.onCancel}
              >
                <X />
              </IconButton>
            </header>

            {/*
             * The fields scroll inside the form rather than the form scrolling itself, so the footer
             * below stays reachable and outside the scroll fade. Submit is a `type="submit"` button,
             * which needs the form as an ancestor - hence the wrapper rather than a sibling footer.
             */}
            <form
              class="custom-provider-body"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <div class={["custom-provider-form", fades.classes()]} ref={fades.bind} onScroll={fades.measure}>
                <Show when={!preset()}>
                  <Field
                    label={t("customProvider.field.providerId")}
                    description={t("customProvider.field.providerIdHint")}
                    error={shown()?.providerId}
                    required
                  >
                    <Input
                      value={draft.providerId}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.providerId = value;
                        })
                      }
                      placeholder={PROVIDER_ID_PLACEHOLDER}
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={INPUT_LIMITS.identifier}
                      disabled={busy() || Boolean(props.providerIdLocked)}
                    />
                  </Field>

                  <Field label={t("customProvider.field.displayName")} error={shown()?.displayName} required>
                    <Input
                      value={draft.displayName}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.displayName = value;
                        })
                      }
                      placeholder={t("customProvider.field.displayNamePlaceholder")}
                      maxlength={INPUT_LIMITS.agentName}
                      disabled={busy()}
                    />
                  </Field>

                  <Field label={t("customProvider.field.baseUrl")} error={shown()?.baseUrl} required>
                    <Input
                      value={draft.baseUrl}
                      onValueChange={(value) =>
                        setDraft((state) => {
                          state.baseUrl = value;
                        })
                      }
                      placeholder={BASE_URL_PLACEHOLDER}
                      inputmode="url"
                      autocomplete="off"
                      spellcheck={false}
                      maxlength={CUSTOM_PROVIDER_LIMITS.baseUrl}
                      disabled={busy()}
                    />
                  </Field>
                </Show>
                <Show when={preset()?.regions}>
                  {(regions) => (
                    <Field
                      label={t(
                        preset()?.regionKind === "plan" ? "customProvider.preset.plan" : "customProvider.preset.region",
                      )}
                    >
                      <div class="custom-provider-region-choices">
                        <For each={regions()}>
                          {(region) => (
                            <Button
                              type="button"
                              size="sm"
                              variant={draft.baseUrl === region.baseUrl ? "secondary" : "ghost"}
                              disabled={busy()}
                              aria-pressed={draft.baseUrl === region.baseUrl ? "true" : "false"}
                              onClick={() =>
                                setDraft((state) => {
                                  state.baseUrl = region.baseUrl;
                                  state.apiKey = "";
                                  state.models = [];
                                })
                              }
                            >
                              {t(`customProvider.preset.regionName.${region.name}`)}
                            </Button>
                          )}
                        </For>
                      </div>
                    </Field>
                  )}
                </Show>
                <Field
                  label={t("customProvider.field.apiKey")}
                  description={
                    props.apiKeyKept ? t("customProvider.field.apiKeyKeptHint") : t("customProvider.field.apiKeyHint")
                  }
                  error={shown()?.apiKey}
                >
                  <Input
                    type={showKey() ? "text" : "password"}
                    value={draft.apiKey}
                    onValueChange={(value) =>
                      setDraft((state) => {
                        state.apiKey = value;
                      })
                    }
                    autocomplete="off"
                    spellcheck={false}
                    maxlength={CUSTOM_PROVIDER_LIMITS.apiKey}
                    disabled={busy()}
                  />
                </Field>

                <Show when={arkPlanKind(draft.baseUrl)}>
                  <div class="custom-provider-advanced-fields">
                    <Text tone="muted" variant="caption">
                      {t("customProvider.preset.arkHint")}
                    </Text>
                    <Field label={t("customProvider.preset.accessKeyId")}>
                      <Input
                        type="password"
                        value={arkCredentials.accessKeyId}
                        autocomplete="off"
                        spellcheck={false}
                        maxlength={128}
                        disabled={busy()}
                        onValueChange={(value) =>
                          setArkCredentials((state) => {
                            state.accessKeyId = value;
                          })
                        }
                      />
                    </Field>
                    <Field label={t("customProvider.preset.secretAccessKey")}>
                      <Input
                        type="password"
                        value={arkCredentials.secretAccessKey}
                        autocomplete="off"
                        spellcheck={false}
                        maxlength={CUSTOM_PROVIDER_LIMITS.apiKey}
                        disabled={busy()}
                        onValueChange={(value) =>
                          setArkCredentials((state) => {
                            state.secretAccessKey = value;
                          })
                        }
                      />
                    </Field>
                    <Show when={arkPlanKind(draft.baseUrl) === "agent"}>
                      <Field label={t("customProvider.preset.edition")}>
                        <div class="custom-provider-region-choices">
                          <For each={["personal", "enterprise"] as const}>
                            {(edition) => (
                              <Button
                                type="button"
                                size="sm"
                                variant={arkCredentials.edition === edition ? "secondary" : "ghost"}
                                aria-pressed={arkCredentials.edition === edition ? "true" : "false"}
                                disabled={busy()}
                                onClick={() =>
                                  setArkCredentials((state) => {
                                    state.edition = edition;
                                  })
                                }
                              >
                                {t(`customProvider.preset.${edition}`)}
                              </Button>
                            )}
                          </For>
                        </div>
                      </Field>
                    </Show>
                  </div>
                </Show>
                <Show when={preset()}>
                  {(provider) => (
                    <>
                      <div class="custom-provider-preset-links">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setShowKey(!showKey())}>
                          {showKey() ? t("customProvider.preset.hideKey") : t("customProvider.preset.showKey")}
                        </Button>
                        <a
                          href={
                            preset()?.regions?.find((region) => region.baseUrl === draft.baseUrl)?.keysUrl ??
                            provider().keysUrl
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("customProvider.preset.getKey")}
                        </a>
                      </div>
                      <Text tone="muted" variant="caption">
                        {t(
                          preset()?.regions?.find((region) => region.baseUrl === draft.baseUrl)?.noList
                            ? "customProvider.preset.noList"
                            : "customProvider.preset.automatic",
                        )}
                      </Text>
                      <div class="custom-provider-preset-endpoint">
                        <Text tone="muted" variant="caption">
                          {t("customProvider.field.baseUrl")}
                        </Text>
                        <code>{t("customProvider.preset.endpoint", { url: draft.baseUrl })}</code>
                      </div>
                    </>
                  )}
                </Show>
                <details class="custom-provider-advanced" open={!preset()}>
                  <summary>{t("customProvider.preset.advanced")}</summary>
                  <div class="custom-provider-advanced-fields">
                    <Show when={preset()}>
                      <Field label={t("customProvider.field.baseUrl")} error={shown()?.baseUrl}>
                        <Input
                          value={draft.baseUrl}
                          disabled={busy()}
                          onValueChange={(value) =>
                            setDraft((state) => {
                              state.baseUrl = value;
                            })
                          }
                        />
                      </Field>
                    </Show>
                    <RepeatableRows
                      label={t("customProvider.models")}
                      removeLabel={(number) => t("customProvider.model.remove", { number })}
                      addLabel={t("customProvider.model.add")}
                      columns={modelColumns}
                      rows={draft.models}
                      limit={CUSTOM_PROVIDER_LIMITS.models}
                      busy={busy()}
                      sectionError={shown()?.models}
                      rowError={(index) => shown()?.modelRows[index]}
                      onAdd={() =>
                        setDraft((state) => {
                          state.models.push({ id: "", name: "" });
                        })
                      }
                      onRemove={(index) =>
                        setDraft((state) => {
                          state.models.splice(index, 1);
                        })
                      }
                      action={
                        <Show when={props.onDiscoverModels}>
                          {(discover) => (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              class="custom-provider-discover"
                              disabled={busy() || !draft.baseUrl.trim() || discovery().status === "loading"}
                              onClick={() => discover()(modelEndpoint())}
                            >
                              <RefreshCw />
                              {discovery().status === "idle"
                                ? t("customProvider.discovery.find")
                                : t("customProvider.discovery.refresh")}
                            </Button>
                          )}
                        </Show>
                      }
                    >
                      <Switch>
                        <Match when={discovery().status === "loading"}>
                          <div class="custom-provider-discovery-status" role="status">
                            <Spinner size="sm" />
                            <Text tone="muted" variant="caption">
                              {t("customProvider.discovery.loading", { url: draft.baseUrl.trim() })}
                            </Text>
                          </div>
                        </Match>
                        <Match when={discoveryFailed()}>
                          {(message) => (
                            <Text class="custom-provider-rows-error" tone="danger" variant="caption" role="alert">
                              {message()}
                            </Text>
                          )}
                        </Match>
                        <Match when={discovered()}>
                          {(models) => (
                            <Show
                              when={models().length > 0}
                              fallback={
                                <Text tone="muted" variant="caption" role="status">
                                  {t("customProvider.discovery.empty")}
                                </Text>
                              }
                            >
                              <Text tone="muted" variant="caption" role="status">
                                {t("customProvider.discovery.found", { count: models().length })}
                              </Text>
                              <ul class="custom-provider-discovered" aria-label={t("customProvider.discovery.label")}>
                                <For each={models()}>
                                  {(model, index) => (
                                    <li>
                                      <label class="custom-provider-discovered-row" for={`${discoveryId}-${index()}`}>
                                        <Checkbox
                                          id={`${discoveryId}-${index()}`}
                                          checked={listed(model.id)}
                                          disabled={busy()}
                                          onChange={(event) => toggleModel(model, event.currentTarget.checked)}
                                        />
                                        <Text variant="body-sm" class="custom-provider-discovered-id">
                                          {model.id}
                                        </Text>
                                      </label>
                                    </li>
                                  )}
                                </For>
                              </ul>
                            </Show>
                          )}
                        </Match>
                      </Switch>
                    </RepeatableRows>

                    <RepeatableRows
                      label={t("customProvider.headers")}
                      removeLabel={(number) => t("customProvider.header.remove", { number })}
                      addLabel={t("customProvider.header.add")}
                      columns={headerColumns}
                      rows={draft.headers}
                      limit={CUSTOM_PROVIDER_LIMITS.headers}
                      busy={busy()}
                      rowError={(index) => shown()?.headerRows[index]}
                      onAdd={() =>
                        setDraft((state) => {
                          state.headers.push({ name: "", value: "" });
                        })
                      }
                      onRemove={(index) =>
                        setDraft((state) => {
                          state.headers.splice(index, 1);
                        })
                      }
                    />
                  </div>
                </details>
              </div>

              <footer class="custom-provider-actions">
                <Show when={props.submitError}>
                  {(message) => (
                    <Text class="custom-provider-submit-error" tone="danger" variant="caption" role="alert">
                      {message()}
                    </Text>
                  )}
                </Show>
                <Button type="button" variant="ghost" disabled={busy()} onClick={props.onCancel}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" variant="default" loading={busy()} loadingLabel={t("common.saving")}>
                  {t("customProvider.submit")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
