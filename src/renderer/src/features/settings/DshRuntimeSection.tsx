import type { DshRuntimeStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onSettled, Show } from "solid-js";
import { dshRuntimePort } from "./dsh-runtime-port";

/**
 * The DeepSeek Harness runtime: the version the next session starts with, and the update the
 * channel offers. A new build is installed beside the shipped one, never in place of it.
 */
export function DshRuntimeSection() {
  const { t } = useText();
  const [status, setStatus] = createSignal<DshRuntimeStatus | null>(null);
  const [busy, setBusy] = createSignal<"checking" | "installing" | "rolling-back" | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [checked, setChecked] = createSignal(false);
  const [changed, setChanged] = createSignal(false);

  onSettled(() => void run("status"));

  async function run(action: "status" | "check" | "install" | "rollback", version?: string): Promise<void> {
    const port = dshRuntimePort();
    setError(null);
    if (action === "check") {
      setChecked(false);
      setStatus((current) => (current ? { ...current, latest: null } : null));
    }
    setBusy(
      action === "status"
        ? null
        : action === "check"
          ? "checking"
          : action === "install"
            ? "installing"
            : "rolling-back",
    );
    try {
      const next =
        action === "status"
          ? await port.getStatus()
          : action === "check"
            ? await port.checkForUpdate()
            : action === "install"
              ? await port.installUpdate({ version: version ?? "" })
              : await port.rollback();
      setStatus(next);
      if (action === "check") setChecked(next.channelConfigured);
      if (action === "install" || action === "rollback") setChanged(true);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      const keys = [
        "error.provider.dshReleaseNetwork",
        "error.provider.dshDownload",
        "error.provider.dshIntegrity",
        "error.provider.dshRuntime",
        "error.provider.dshInstall",
      ] as const;
      const key = keys.find((candidate) => message.endsWith(sourceText(candidate)));
      setError(key ? t(key) : t("update.dsh.failed"));
    } finally {
      setBusy(null);
    }
  }

  const sourceLabel = () => {
    const active = status()?.active;
    if (!active) return "";
    return t(
      active.source === "installed"
        ? "update.dsh.installed"
        : active.source === "development"
          ? "update.dsh.development"
          : "update.dsh.shipped",
    );
  };

  return (
    <SettingsSection title={t("update.dsh.title")}>
      <ItemGroup class="settings-modal-card">
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{status()?.active.version ?? "…"}</ItemTitle>
            <ItemDescription>{sourceLabel()}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="secondary"
              disabled={busy() !== null || status()?.channelConfigured !== true}
              onClick={() => void run("check")}
            >
              {busy() === "checking" ? t("update.provider.checking", { name: "DeepSeek" }) : t("update.action.check")}
            </Button>
            <Show when={status()?.latest}>
              {(latest) => (
                <Button disabled={busy() !== null} onClick={() => void run("install", latest().version)}>
                  {busy() === "installing"
                    ? t("update.provider.updating", { name: "DeepSeek" })
                    : `${t("update.provider.update")} ${latest().version}`}
                </Button>
              )}
            </Show>
            <Show when={(status()?.installed.length ?? 0) > 0}>
              <Button variant="secondary" disabled={busy() !== null} onClick={() => void run("rollback")}>
                {t("update.dsh.rollback")}
              </Button>
            </Show>
          </ItemActions>
        </Item>
        <Show when={error()}>{(message) => <Text variant="caption">{message()}</Text>}</Show>
        <Show when={changed()}>
          <Text variant="caption">{t("update.dsh.nextSession")}</Text>
        </Show>
        <Show when={status()}>
          {(current) => (
            <Text variant="caption" tone="muted">
              {t(current().channelConfigured ? "update.dsh.channelDescription" : "update.dsh.noChannel")}
            </Text>
          )}
        </Show>
        <Show when={busy() === null && !error() && checked() && status()?.latest === null}>
          <Text variant="caption" tone="muted">
            {t("update.dsh.channelUpToDate")}
          </Text>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
