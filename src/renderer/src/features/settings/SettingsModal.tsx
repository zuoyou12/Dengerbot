import type { AppInfo, DynamicIslandGeometry, ServerSummary, UpdateStatus } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  Button,
  ChevronRight,
  Tabs,
  TriangleAlert,
} from "@openbot/ui";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { ProfileActivity } from "@openbot/ui/features/settings/ProfileActivity";
import type { ProviderSettingsDetail } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { profileStats } from "@openbot/ui/features/settings/profile-stats";
import { SettingsDialogShell, type SettingsPagePlacement } from "@openbot/ui/features/settings/SettingsDialogShell";
import { SettingsUpdatesTab } from "@openbot/ui/features/settings/SettingsUpdatesTab";
import { createSettingsUpdatesStore } from "@openbot/ui/features/settings/stores/updates-store";
import { createEffect, createMemo, createSignal, Show, untrack } from "solid-js";
import { useI18n } from "../../i18n-context";
import { ComputerUseSetup } from "../computer-use/ComputerUseSetup";
import { type HostProviderSettings, HostProviderSettingsPanel } from "./ProviderSettingsSection";
import { createProfileActivityStore } from "./profile-activity-store";
import { createSettingsAgentsSection } from "./SettingsAgentsSection";
import { SettingsDynamicIslandTab } from "./SettingsDynamicIslandTab";
import { SettingsGeneralTab } from "./SettingsGeneralTab";
import { SettingsNotificationsTab } from "./SettingsNotificationsTab";
import { SettingsVoiceTab } from "./SettingsVoiceTab";
import { dynamicIslandSettingsShown, navItem, navItems, type SettingsTab, settingsTabShown } from "./settings-tabs";
import { createSettingsVoiceStore } from "./settings-voice-store";

export interface SettingsModalProps {
  open: boolean;
  providers?: HostProviderSettings;
  value: GeneralSettingsValue;
  onValueChange: (value: GeneralSettingsValue) => void;
  /** True when the saved preferences could not be read, so the rows show default values. */
  preferencesLoadFailed?: boolean;
  /** Reads the saved preferences again. */
  onRetryPreferencesLoad?: () => void;
  appInfo: AppInfo | null;
  /** True in a window that shows one chat (#2964). It has no Dynamic Island tab: the main window owns the island. */
  chatWindow?: boolean;
  /** The built-in display's notch, null when it has none, or undefined before main answers. */
  builtInDisplayGeometry?: DynamicIslandGeometry | undefined;
  /** The servers that the Dynamic Island tab lists. */
  servers?: readonly ServerSummary[];
  updateStatus: UpdateStatus;
  onUpdateAction: () => Promise<void>;
  onOpenWhatsNew?: (() => void) | undefined;
  onCancelScheduledRestart?: () => Promise<void>;
  onRestartWhenIdle?: () => Promise<void>;
  onCancelIdleRestart?: () => Promise<void>;
  onTestNotification?: () => void | Promise<void>;
  /** Opens the operating system notification settings. Shown only on macOS and Windows. */
  onOpenNotificationSettings?: () => void | Promise<void>;
  restoreFocusTarget?: HTMLElement | null;
  /** The tab shown when the modal is created. Read once; the user moves between tabs after that. */
  initialTab?: SettingsTab | undefined;
  /** The tab shown each time the modal opens. Without it, the modal shows the tab that was open last. */
  openTab?: SettingsTab | undefined;
  /** Where the settings page shows, or nothing while the page is not on screen. */
  page: SettingsPagePlacement | undefined;
}

/**
 * The dialog shell: the tab list, the header, and one delegation per panel.
 *
 * Every panel's state is a store created here rather than inside its tab, because Kobalte unmounts
 * an unselected `Tabs.Content` when the dialog closes. A list owned by the tab would lose the rows
 * it is showing while it refetches on reopen.
 */
export function SettingsModal(props: SettingsModalProps) {
  const i18n = useI18n();
  const [providerDetail, setProviderDetail] = createSignal<ProviderSettingsDetail | null>(null);
  const [activeTab, setActiveTab] = createSignal<SettingsTab>(untrack(() => props.initialTab) ?? "general");
  let modalElement: HTMLElement | undefined;
  const activity = createProfileActivityStore(() => props.open && activeTab() === "profile");
  const activityStats = createMemo(() =>
    activity.state.report ? profileStats(activity.state.report, activity.state.agents) : null,
  );
  const updates = createSettingsUpdatesStore(props);
  const voice = createSettingsVoiceStore(() => props.open && activeTab() === "voice");
  const agents = createSettingsAgentsSection({
    visible: () => props.open && activeTab() === "agents",
    value: () => props.value,
    onValueChange: (value) => props.onValueChange(value),
  });

  const dynamicIslandShown = () => dynamicIslandSettingsShown(props.appInfo?.platform, props.chatWindow === true);
  createEffect(
    () => {
      return props.open ? props.openTab : undefined;
    },
    (tab) => {
      if (!tab) return;
      setActiveTab(tab);
      agents.showList();
    },
  );
  const visibleNavItems = () => navItems.filter((item) => settingsTabShown(item.value, dynamicIslandShown()));

  const detail = () =>
    activeTab() === "providers" ? providerDetail() : activeTab() === "agents" ? agents.crumb() : null;
  const title = () => i18n.t(navItem(activeTab()).titleKey);
  const description = () => i18n.t(navItem(activeTab()).descriptionKey);

  const tabsProps = {
    get value() {
      return activeTab();
    },
    onChange(value: string) {
      if (
        value === "general" ||
        value === "agents" ||
        value === "providers" ||
        value === "profile" ||
        value === "notifications" ||
        value === "voice" ||
        (value === "dynamic-island" && dynamicIslandShown()) ||
        value === "computer-use" ||
        value === "updates"
      ) {
        setActiveTab(value);
      }
    },
    orientation: "vertical" as const,
    activationMode: "automatic" as const,
  };

  /** Shown above the rows that the preference read fills, while those rows show default values. */
  const preferencesLoadError = () => (
    <Show when={props.preferencesLoadFailed}>
      <Alert tone="danger" role="alert" report={{ operation: "settings", source: "system", cause_code: "unknown" }}>
        <AlertIcon>
          <TriangleAlert aria-hidden="true" />
        </AlertIcon>
        <AlertContent>
          <AlertDescription>{i18n.t("settings.preferences.loadFailed")}</AlertDescription>
        </AlertContent>
        <Show when={props.onRetryPreferencesLoad}>
          {(retry) => (
            <AlertActions>
              <Button type="button" variant="outline" size="sm" onClick={() => retry()()}>
                {i18n.t("common.retry")}
              </Button>
            </AlertActions>
          )}
        </Show>
      </Alert>
    </Show>
  );

  function updateSetting<Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]): void {
    props.onValueChange({ ...props.value, [key]: value });
  }

  function updateSettings(patch: Partial<GeneralSettingsValue>): void {
    props.onValueChange({ ...props.value, ...patch });
  }

  return (
    <Tabs.Root {...tabsProps} class="settings-modal-tabs-root">
      <SettingsDialogShell
        class="app-settings-modal-shell"
        page={props.page}
        open={props.open}
        title={
          <Show when={detail()} fallback={title()}>
            {(detail) => (
              <span class="settings-modal-crumbs">
                <Button type="button" variant="ghost" class="settings-modal-crumb-parent" onClick={detail().back}>
                  {title()}
                </Button>
                <ChevronRight class="settings-modal-crumb-separator" aria-hidden="true" />
                <span class="settings-modal-crumb-current">{detail().title}</span>
              </span>
            )}
          </Show>
        }
        description={description()}
        contentKey={`${activeTab()}:${detail()?.title ?? ""}`}
        restoreFocusTarget={props.restoreFocusTarget}
        onContentElement={(element) => (modalElement = element)}
        sidebar={
          <Tabs.List class="settings-modal-nav" aria-label={i18n.t("settings.sections.label")}>
            {visibleNavItems().map((item) => {
              const NavIcon = item.icon;
              return (
                <Tabs.Trigger
                  class="settings-modal-nav-item"
                  value={item.value}
                  aria-current={activeTab() === item.value ? "page" : undefined}
                >
                  <NavIcon aria-hidden="true" />
                  <span>{i18n.t(item.titleKey)}</span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        }
      >
        <Tabs.Content value="general" class="settings-modal-tab-panel" data-tab="general">
          {preferencesLoadError()}
          <SettingsGeneralTab
            value={props.value}
            variant={props.appInfo?.variant ?? "production"}
            platform={props.appInfo?.platform}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            selectMount={modalElement}
          />
        </Tabs.Content>

        <Tabs.Content value="agents" class="settings-modal-tab-panel" data-tab="agents">
          {preferencesLoadError()}
          <agents.Panel menuMount={modalElement} />
        </Tabs.Content>

        <Tabs.Content value="providers" class="settings-modal-tab-panel" data-tab="providers">
          {preferencesLoadError()}
          <Show when={props.providers}>
            {(providers) => (
              <HostProviderSettingsPanel
                {...providers()}
                selectMount={modalElement}
                onDetailChange={setProviderDetail}
              />
            )}
          </Show>
        </Tabs.Content>

        <Tabs.Content value="profile" class="settings-modal-tab-panel profile-panel" data-tab="profile">
          <ProfileActivity
            phase={activity.state.phase}
            stats={activityStats()}
            errorReference={activity.state.errorReference}
            onRetry={activity.retry}
          />
        </Tabs.Content>

        <Tabs.Content value="notifications" class="settings-modal-tab-panel" data-tab="notifications">
          {preferencesLoadError()}
          <SettingsNotificationsTab
            value={props.value}
            onUpdateSetting={updateSetting}
            onUpdateSettings={updateSettings}
            onTestNotification={props.onTestNotification}
            onOpenNotificationSettings={
              props.appInfo?.platform === "darwin" || props.appInfo?.platform === "win32"
                ? props.onOpenNotificationSettings
                : undefined
            }
          />
        </Tabs.Content>

        <Tabs.Content value="voice" class="settings-modal-tab-panel" data-tab="voice">
          <SettingsVoiceTab store={voice} selectMount={modalElement} />
        </Tabs.Content>

        <Show when={dynamicIslandShown()}>
          <Tabs.Content value="dynamic-island" class="settings-modal-tab-panel" data-tab="dynamic-island">
            {preferencesLoadError()}
            <SettingsDynamicIslandTab
              value={props.value}
              variant={props.appInfo?.variant ?? "production"}
              builtInDisplayGeometry={props.builtInDisplayGeometry}
              servers={props.servers ?? []}
              onUpdateSetting={updateSetting}
              onUpdateSettings={updateSettings}
            />
          </Tabs.Content>
        </Show>

        <Tabs.Content value="computer-use" class="settings-modal-tab-panel" data-tab="computer-use">
          <ComputerUseSetup variant="settings" />
        </Tabs.Content>

        <Tabs.Content value="updates" class="settings-modal-tab-panel" data-tab="updates">
          {preferencesLoadError()}
          <SettingsUpdatesTab
            store={updates}
            onOpenWhatsNew={props.onOpenWhatsNew}
            value={props.value}
            onUpdateSetting={updateSetting}
            selectMount={modalElement}
          />
        </Tabs.Content>
      </SettingsDialogShell>
    </Tabs.Root>
  );
}
