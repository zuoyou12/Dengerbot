import type {
  SubscriptionLogin,
  SubscriptionOptionsInput,
  SubscriptionProvider,
  SubscriptionState,
  SubscriptionUsage,
} from "@openbot/contracts/ipc";
import { findSubscriptionPlugin, SUBSCRIPTION_PLUGIN_CATALOG } from "@openbot/contracts/subscription-catalog";
import {
  ArrowLeft,
  Badge,
  Button,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  RefreshCw,
  SettingsSection,
  Switch,
} from "@openbot/ui";
import { SubscriptionLogo } from "@openbot/ui/features/subscriptions/SubscriptionLogo";
import { useText } from "@openbot/ui/text";
import { createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import "./local-gateway.css";
import { useCustomProviders } from "../custom-providers/custom-providers-context";

export function LocalGatewayPage(props: { onBack: () => void }) {
  const modelProviders = useCustomProviders();
  const { t, sourceText } = useText();
  const [state, setState] = createSignal<SubscriptionState | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [packageName, setPackageName] = createSignal("");
  const [installedOnly, setInstalledOnly] = createSignal(false);
  let disposed = false;
  let polling = false;
  let actionEpoch = 0;
  let timer: number | undefined;
  async function run(action: () => Promise<SubscriptionState>) {
    if (busy()) return;
    const epoch = ++actionEpoch;
    setBusy(true);
    setError("");
    try {
      const next = await action();
      if (!disposed && epoch === actionEpoch) setState(next);
      await modelProviders.refreshCustomProviders();
    } catch (cause) {
      if (!disposed && epoch === actionEpoch)
        setError(cause instanceof Error ? cause.message : t("subscriptions.failed"));
    } finally {
      if (!disposed && epoch === actionEpoch) setBusy(false);
    }
  }
  async function cancelLogin(loginId: string) {
    const epoch = ++actionEpoch;
    setBusy(true);
    try {
      const next = await window.openbot.subscriptions.cancelLogin({ loginId });
      if (!disposed && epoch === actionEpoch) {
        setState(next);
        setError("");
      }
    } catch (cause) {
      if (!disposed && epoch === actionEpoch)
        setError(cause instanceof Error ? cause.message : t("subscriptions.failed"));
    } finally {
      if (!disposed && epoch === actionEpoch) setBusy(false);
    }
  }
  onSettled(() => {
    void run(() => window.openbot.subscriptions.getState());
    timer = window.setInterval(() => {
      if (busy() || polling || document.hidden) return;
      polling = true;
      const epoch = actionEpoch;
      void window.openbot.subscriptions
        .getState()
        .then((next) => {
          if (!disposed && !busy() && epoch === actionEpoch) {
            const changed = JSON.stringify(state()?.providers) !== JSON.stringify(next.providers);
            setState(next);
            if (changed) void modelProviders.refreshCustomProviders().catch(() => undefined);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 2500);
  });
  onCleanup(() => {
    disposed = true;
    window.clearInterval(timer);
  });
  const plugins = () =>
    (state()?.catalog ?? SUBSCRIPTION_PLUGIN_CATALOG).filter((entry) => {
      const found = state()?.plugins.find((item) => item.packageName === entry.packageName);
      return (
        (!installedOnly() || found?.installedVersion) &&
        `${entry.name} ${entry.packageName} ${entry.description.zh} ${entry.description.en}`
          .toLowerCase()
          .includes(query().trim().toLowerCase())
      );
    });
  const updates = () =>
    state()?.plugins.filter(
      (plugin) => plugin.installedVersion && plugin.latestVersion && plugin.latestVersion !== plugin.installedVersion,
    ) ?? [];
  function updateAll() {
    const pending = updates();
    if (!pending.length) return;
    void run(async () => {
      let next = await window.openbot.subscriptions.getState();
      for (const plugin of pending) {
        next = await window.openbot.subscriptions.update({ packageName: plugin.packageName });
      }
      return next;
    });
  }
  return (
    <section class="subscription-page">
      <header class="subscription-header">
        <div class="subscription-header-heading">
          <Button variant="ghost" size="icon-sm" onClick={props.onBack} aria-label={t("subscriptions.back")}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h1 class="subscription-title">{t("subscriptions.title")}</h1>
        </div>
        <Button
          variant="secondary"
          disabled={busy()}
          onClick={() => void run(() => window.openbot.subscriptions.refresh({}))}
        >
          <RefreshCw aria-hidden="true" />
          {t("subscriptions.refresh")}
        </Button>
      </header>
      <div class="subscription-scroll">
        <div class="subscription-content">
          <p class="subscription-description">{t("subscriptions.description")}</p>
          <Show when={sourceText(error() || state()?.runtimeError || "")}>
            <p class="subscription-error" role="alert">
              {sourceText(error() || state()?.runtimeError || "")}
            </p>
          </Show>
          <Show when={!state()}>
            <p role="status">{t("subscriptions.loading")}</p>
            <Button disabled={busy()} onClick={() => void run(() => window.openbot.subscriptions.getState())}>
              {t("subscriptions.retry")}
            </Button>
          </Show>
          <For each={state()?.logins.filter((login) => login.status !== "cancelled" && login.status !== "connected")}>
            {(login) => (
              <LoginPanel
                login={login}
                busy={busy()}
                submit={(value) =>
                  void run(() => window.openbot.subscriptions.submitLogin({ loginId: login.id, value }))
                }
                cancel={() => void cancelLogin(login.id)}
              />
            )}
          </For>
          <SettingsSection title={t("subscriptions.providers")}>
            <Show
              when={(state()?.providers.length ?? 0) > 0}
              fallback={<p class="subscription-empty">{t("subscriptions.noAccounts")}</p>}
            >
              <For each={state()?.providers}>
                {(provider) => <ProviderPanel provider={provider} busy={busy()} run={run} />}
              </For>
            </Show>
            <p class="subscription-note">{t("subscriptions.chooseModel")}</p>
          </SettingsSection>
          <SettingsSection title={t("subscriptions.plugins")}>
            <p class="subscription-description">{t("subscriptions.pluginDescription")}</p>
            <div class="subscription-toolbar">
              <div class="subscription-tabs">
                <Button
                  variant={installedOnly() ? "ghost" : "secondary"}
                  disabled={busy()}
                  onClick={() => {
                    setInstalledOnly(false);
                    void run(() => window.openbot.subscriptions.refresh({ discover: true }));
                  }}
                >
                  {t("subscriptions.discover")}
                </Button>
                <Button variant={installedOnly() ? "secondary" : "ghost"} onClick={() => setInstalledOnly(true)}>
                  {t("subscriptions.installed")}
                </Button>
              </div>
              <Input
                class="subscription-search"
                aria-label={t("subscriptions.search")}
                placeholder={t("subscriptions.search")}
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
              <Button
                variant="outline"
                disabled={busy()}
                onClick={() =>
                  void run(() => window.openbot.subscriptions.refresh({ discover: true, query: query().trim() }))
                }
              >
                {t("subscriptions.searchOnline")}
              </Button>
              <Button
                variant="outline"
                disabled={busy()}
                onClick={() => void run(() => window.openbot.subscriptions.refresh({ discover: true }))}
              >
                {t("subscriptions.refreshDirectory")}
              </Button>
              <Button
                variant="outline"
                disabled={busy()}
                onClick={() => void run(() => window.openbot.subscriptions.refresh({ checkUpdates: true }))}
              >
                {t("subscriptions.checkUpdates")}
              </Button>
              <Show when={updates().length > 0}>
                <Button disabled={busy()} onClick={updateAll}>
                  {t("subscriptions.updateAll", { count: updates().length })}
                </Button>
              </Show>
            </div>
            <ItemGroup class="subscription-plugin-list">
              <For each={plugins()} fallback={<p class="subscription-empty">{t("subscriptions.noMatch")}</p>}>
                {(entry) => {
                  const plugin = () => state()?.plugins.find((item) => item.packageName === entry.packageName);
                  return (
                    <Item>
                      <div class="subscription-provider-logo">
                        <SubscriptionLogo providerId={entry.id} icon={entry.icon} />
                      </div>
                      <ItemContent>
                        <ItemTitle>{entry.name}</ItemTitle>
                        <ItemDescription>{entry.description.zh}</ItemDescription>
                        <p class="subscription-package">{entry.packageName}</p>
                        <Show when={plugin()?.installedVersion}>
                          {(version) => (
                            <ItemDescription>{t("subscriptions.version", { version: version() })}</ItemDescription>
                          )}
                        </Show>
                        <Show when={plugin()?.error}>
                          <p class="subscription-error">{sourceText(plugin()?.error || "")}</p>
                        </Show>
                      </ItemContent>
                      <ItemActions>
                        <Show
                          when={plugin()?.installedVersion}
                          fallback={
                            <Button
                              disabled={busy()}
                              onClick={() =>
                                void run(() => window.openbot.subscriptions.install({ packageName: entry.packageName }))
                              }
                            >
                              {t("subscriptions.install")}
                            </Button>
                          }
                        >
                          <Switch
                            aria-label={t("subscriptions.enable", { name: entry.name })}
                            checked={plugin()?.enabled ?? false}
                            disabled={busy()}
                            onChange={(enabled) =>
                              void run(() =>
                                window.openbot.subscriptions.setEnabled({ packageName: entry.packageName, enabled }),
                              )
                            }
                          />
                          <Show
                            when={plugin()?.latestVersion && plugin()?.latestVersion !== plugin()?.installedVersion}
                          >
                            <Button
                              disabled={busy()}
                              onClick={() =>
                                void run(() => window.openbot.subscriptions.update({ packageName: entry.packageName }))
                              }
                            >
                              {t("subscriptions.update")}
                            </Button>
                          </Show>
                          <Button
                            variant="outline"
                            disabled={busy()}
                            onClick={() =>
                              void run(() => window.openbot.subscriptions.remove({ packageName: entry.packageName }))
                            }
                          >
                            {t("subscriptions.uninstall")}
                          </Button>
                        </Show>
                      </ItemActions>
                    </Item>
                  );
                }}
              </For>
            </ItemGroup>
            <div class="subscription-package-install">
              <label for="subscription-custom-package">{t("subscriptions.customPackage")}</label>
              <div class="subscription-actions">
                <Input
                  id="subscription-custom-package"
                  class="subscription-search"
                  placeholder={t("subscriptions.customPackagePlaceholder")}
                  value={packageName()}
                  disabled={busy()}
                  onInput={(event) => setPackageName(event.currentTarget.value)}
                />
                <Button
                  disabled={busy() || !packageName().trim()}
                  onClick={() => {
                    const name = packageName().trim();
                    void run(async () => {
                      const next = await window.openbot.subscriptions.install({ packageName: name });
                      setPackageName("");
                      return next;
                    });
                  }}
                >
                  {t("subscriptions.install")}
                </Button>
              </div>
              <p class="subscription-note">{t("subscriptions.customPackageNotice")}</p>
            </div>
            <div class="subscription-actions">
              <Switch
                aria-label={t("subscriptions.mirror")}
                checked={state()?.domesticMirror ?? false}
                disabled={busy()}
                onChange={(domesticMirror) =>
                  void run(() => window.openbot.subscriptions.setPreferences({ domesticMirror }))
                }
              />
              {t("subscriptions.mirror")}
            </div>
            <p class="subscription-note">{t("subscriptions.pluginNotice")}</p>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}

type Run = (action: () => Promise<SubscriptionState>) => Promise<void>;
function ProviderPanel(props: { provider: SubscriptionProvider; busy: boolean; run: Run }) {
  const { t, sourceText } = useText();
  const [options, setOptions] = createSignal<SubscriptionOptionsInput["values"]>({});
  const [reconnectAccount, setReconnectAccount] = createSignal<string | null>(null);
  const listing = () => findSubscriptionPlugin(props.provider.packageName);
  return (
    <ItemGroup class="subscription-provider">
      <Item>
        <div class="subscription-provider-logo">
          <SubscriptionLogo providerId={props.provider.id} icon={listing()?.icon} />
        </div>
        <ItemContent>
          <ItemTitle class="subscription-title-row">
            {props.provider.name}
            <Badge variant="secondary">
              {t(
                !props.provider.enabled
                  ? "subscriptions.disabled"
                  : props.provider.signedIn
                    ? "subscriptions.signedIn"
                    : "subscriptions.signedOut",
              )}
            </Badge>
          </ItemTitle>
          <Show when={props.provider.error}>
            <p class="subscription-error">{sourceText(props.provider.error || "")}</p>
          </Show>
        </ItemContent>
        <ItemActions>
          <For each={props.provider.methods}>
            {(method) => (
              <Button
                variant="outline"
                disabled={props.busy || !props.provider.enabled}
                onClick={() =>
                  void props.run(() =>
                    window.openbot.subscriptions.startLogin({
                      providerId: props.provider.id,
                      methodIndex: method.index,
                    }),
                  )
                }
              >
                {method.label || t("subscriptions.signIn")}
              </Button>
            )}
          </For>
        </ItemActions>
      </Item>
      <div class="subscription-provider-details">
        <For each={props.provider.accounts}>
          {(account) => (
            <div>
              <div class="subscription-toolbar">
                <strong>{account.label}</strong>
                <div class="subscription-actions">
                  <Show when={props.provider.methods.length > 0}>
                    <Button
                      variant="ghost"
                      disabled={props.busy || !props.provider.enabled}
                      onClick={() => setReconnectAccount(account.id)}
                    >
                      {t("subscriptions.signInAgain")}
                    </Button>
                  </Show>
                  <Show when={props.provider.supportsUsage}>
                    <Button
                      variant="ghost"
                      disabled={props.busy}
                      onClick={() =>
                        void props.run(() =>
                          window.openbot.subscriptions.getUsage({
                            providerId: props.provider.id,
                            accountId: account.id,
                          }),
                        )
                      }
                    >
                      {t("subscriptions.usage")}
                    </Button>
                  </Show>
                  <Show when={props.provider.supportsCheckIn}>
                    <Button
                      variant="ghost"
                      disabled={props.busy}
                      onClick={() =>
                        void props.run(() =>
                          window.openbot.subscriptions.checkIn({
                            providerId: props.provider.id,
                            accountId: account.id,
                          }),
                        )
                      }
                    >
                      {t("subscriptions.checkIn")}
                    </Button>
                  </Show>
                  <Button
                    variant="ghost"
                    disabled={props.busy}
                    onClick={() =>
                      void props.run(() =>
                        window.openbot.subscriptions.signOut({ providerId: props.provider.id, accountId: account.id }),
                      )
                    }
                  >
                    {t("subscriptions.signOut")}
                  </Button>
                </div>
              </div>
              <Show when={reconnectAccount() === account.id}>
                <div class="subscription-login">
                  <span>{t("subscriptions.loginMethod")}</span>
                  <div class="subscription-actions">
                    <For each={props.provider.methods}>
                      {(method) => (
                        <Button
                          variant="outline"
                          disabled={props.busy || !props.provider.enabled}
                          onClick={() => {
                            setReconnectAccount(null);
                            void props.run(() =>
                              window.openbot.subscriptions.startLogin({
                                providerId: props.provider.id,
                                accountId: account.id,
                                methodIndex: method.index,
                              }),
                            );
                          }}
                        >
                          {method.label || t("subscriptions.signIn")}
                        </Button>
                      )}
                    </For>
                    <Button variant="ghost" onClick={() => setReconnectAccount(null)}>
                      {t("subscriptions.cancel")}
                    </Button>
                  </div>
                </div>
              </Show>
              <Show when={account.error}>
                <p class="subscription-error">{sourceText(account.error || "")}</p>
              </Show>
              <Show when={account.usage}>{(usage) => <Usage value={usage()} />}</Show>
            </div>
          )}
        </For>
        <Show when={props.provider.enabled && props.provider.signedIn}>
          <details>
            <summary>
              {t("subscriptions.models")} ({props.provider.models.length})
            </summary>
            <div class="subscription-models">
              <For
                each={props.provider.models}
                fallback={<p class="subscription-note">{t("subscriptions.noModels")}</p>}
              >
                {(model) => <Badge variant="secondary">{model.name}</Badge>}
              </For>
            </div>
          </details>
        </Show>
        <Show when={props.provider.options.length > 0}>
          <details>
            <summary>{t("subscriptions.options")}</summary>
            <For each={props.provider.options}>
              {(option) => (
                <div class="subscription-option">
                  <span>{option.label}</span>
                  <Show
                    when={option.type === "boolean"}
                    fallback={
                      <Show
                        when={option.type === "select"}
                        fallback={
                          <Input
                            aria-label={option.label}
                            value={String(options()[option.key] ?? option.value ?? "")}
                            type={option.type === "number" ? "number" : "text"}
                            onInput={(event) =>
                              setOptions({
                                ...options(),
                                [option.key]:
                                  option.type === "number"
                                    ? Number(event.currentTarget.value)
                                    : event.currentTarget.value,
                              })
                            }
                          />
                        }
                      >
                        <div class="subscription-actions">
                          <For each={option.options}>
                            {(choice) => (
                              <Button
                                variant={
                                  (options()[option.key] ?? option.value) === choice.value ? "secondary" : "outline"
                                }
                                onClick={() => setOptions({ ...options(), [option.key]: choice.value })}
                              >
                                {choice.label}
                              </Button>
                            )}
                          </For>
                        </div>
                      </Show>
                    }
                  >
                    <Switch
                      aria-label={option.label}
                      checked={Boolean(options()[option.key] ?? option.value)}
                      onChange={(value) => setOptions({ ...options(), [option.key]: value })}
                    />
                  </Show>
                  <Show when={option.description}>
                    <p class="subscription-note">{option.description}</p>
                  </Show>
                </div>
              )}
            </For>
            <Button
              disabled={props.busy}
              onClick={() =>
                void props.run(() =>
                  window.openbot.subscriptions.setOptions({ providerId: props.provider.id, values: options() }),
                )
              }
            >
              {t("subscriptions.saveOptions")}
            </Button>
          </details>
        </Show>
      </div>
    </ItemGroup>
  );
}

function LoginPanel(props: {
  login: SubscriptionLogin;
  busy: boolean;
  submit: (value: string) => void;
  cancel: () => void;
}) {
  const { t, sourceText } = useText();
  const [answer, setAnswer] = createSignal("");
  const [openError, setOpenError] = createSignal(false);
  const submit = (value: string) => {
    props.submit(value);
    setAnswer("");
  };
  const url = () => {
    try {
      const parsed = new URL(props.login.url ?? "");
      return parsed.protocol === "https:" ||
        (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
        ? parsed.href
        : null;
    } catch {
      return null;
    }
  };
  return (
    <section class="subscription-login" aria-label={t("subscriptions.signingIn")}>
      <strong>
        {props.login.providerId} · {t("subscriptions.signingIn")}
      </strong>
      <Show when={props.login.instructions}>
        <p>{props.login.instructions}</p>
      </Show>
      <Show when={sourceText(props.login.error || "")}>
        <p role="alert" class="subscription-error">
          {sourceText(props.login.error || "")}
        </p>
      </Show>
      <Show when={props.login.code}>
        <code class="subscription-login-code">{props.login.code}</code>
      </Show>
      <Show when={url()}>
        {(href) => (
          <a
            href={href()}
            onClick={(event) => {
              event.preventDefault();
              setOpenError(false);
              void window.openbot.subscriptions.openLogin({ loginId: props.login.id }).catch(() => setOpenError(true));
            }}
          >
            {t("subscriptions.openBrowser")}
          </a>
        )}
      </Show>
      <Show when={openError()}>
        <p role="alert" class="subscription-error">
          {t("subscriptions.openBrowserFailed")}
        </p>
      </Show>
      <Show when={props.login.prompt}>
        {(prompt) => (
          <div>
            <span>{sourceText(prompt().message)}</span>
            <Show
              when={prompt().type === "select"}
              fallback={
                <Input
                  aria-label={sourceText(prompt().message)}
                  type={prompt().secret ? "password" : "text"}
                  value={answer()}
                  placeholder={prompt().placeholder}
                  onInput={(event) => setAnswer(event.currentTarget.value)}
                />
              }
            >
              <div class="subscription-actions">
                <For each={prompt().options}>
                  {(choice) => (
                    <Button disabled={props.busy} variant="outline" onClick={() => submit(choice.value)}>
                      {choice.label}
                    </Button>
                  )}
                </For>
              </div>
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.login.manualCode}>
        <label>
          {t("subscriptions.loginResponse")}
          <Input
            value={answer()}
            type="password"
            autocomplete="off"
            onInput={(event) => setAnswer(event.currentTarget.value)}
          />
        </label>
      </Show>
      <div class="subscription-actions">
        <Show when={props.login.manualCode || props.login.prompt?.type === "text"}>
          <Button disabled={props.busy || !answer().trim()} onClick={() => submit(answer())}>
            {t("subscriptions.continue")}
          </Button>
        </Show>
        <Button variant="outline" onClick={props.cancel}>
          {t("subscriptions.cancel")}
        </Button>
      </div>
    </section>
  );
}

function Usage(props: { value: SubscriptionUsage }) {
  const { t, sourceText } = useText();
  return (
    <div>
      <p class="subscription-note">
        {props.value.plan} {props.value.balance}
      </p>
      <Show when={props.value.error}>
        <p class="subscription-error">{sourceText(props.value.error || "")}</p>
      </Show>
      <dl class="subscription-usage">
        <For each={props.value.windows}>
          {(window) => (
            <div>
              <dt>{window.label}</dt>
              <dd>
                <Show when={window.remaining !== undefined}>
                  {t("subscriptions.remaining")} {window.remaining} {window.unit}{" "}
                </Show>
                <Show when={window.used !== undefined}>
                  {t("subscriptions.used")} {window.used}{" "}
                </Show>
                <Show when={window.limit !== undefined}>
                  / {window.limit} {window.unit}{" "}
                </Show>
                <Show when={window.resetsAt}>{t("subscriptions.resets", { time: window.resetsAt ?? "" })}</Show>
              </dd>
            </div>
          )}
        </For>
      </dl>
    </div>
  );
}
