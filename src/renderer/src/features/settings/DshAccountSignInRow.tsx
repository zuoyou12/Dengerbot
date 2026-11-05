import { Button, Item, ItemActions, ItemContent, ItemDescription, ItemTitle, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, onCleanup, onSettled, Show } from "solid-js";

/**
 * The DeepSeek account of this computer, as the DSH account bridge reports it. The row polls while
 * it is mounted: the sign-in window itself lives in main, and main closes it again once the bridge
 * hands over the account, so the row only has to notice.
 */
export function DshAccountSignInRow() {
  const { t } = useText();
  const [state, setState] = createSignal<Awaited<ReturnType<typeof window.openbot.getDshAccount>> | null>(null);
  const [busy, setBusy] = createSignal(false);

  onSettled(() => {
    let stopped = false;
    const poll = async (): Promise<void> => {
      try {
        const next = await window.openbot.getDshAccount();
        if (!stopped) setState(next);
      } catch {
        // The next poll answers; a missed read is not worth a toast.
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    onCleanup(() => {
      stopped = true;
      clearInterval(timer);
    });
  });

  const account = () => state()?.account ?? null;
  const phase = () => state()?.phase ?? "idle";

  async function startSignIn(): Promise<void> {
    setBusy(true);
    try {
      await window.openbot.startDshSignIn();
    } finally {
      setBusy(false);
    }
  }

  async function cancelSignIn(): Promise<void> {
    setBusy(true);
    try {
      await window.openbot.cancelDshSignIn();
    } finally {
      setBusy(false);
    }
  }

  const subtitle = () => {
    const current = account();
    if (phase() === "signing-in") return t("settings.dshAccount.signingIn");
    if (phase() === "failed") return t("settings.dshAccount.failed");
    if (current?.signedIn && current.name) return t("settings.dshAccount.signedInAs", { name: current.name });
    return t("settings.dshAccount.signedOut");
  };

  return (
    <Item data-settings-row="settings.dshAccount.title">
      <ItemContent>
        <ItemTitle>{t("settings.dshAccount.title")}</ItemTitle>
        <ItemDescription>{subtitle()}</ItemDescription>
        <Show when={account()?.signedIn && account()?.balance}>
          <Text class="text-muted-foreground text-sm">
            {t("settings.dshAccount.balance", { balance: `${account()?.balance ?? ""} ${account()?.currency ?? ""}` })}
          </Text>
        </Show>
      </ItemContent>
      <ItemActions>
        <Show
          when={phase() === "signing-in"}
          fallback={
            <Button variant="outline" size="sm" onClick={() => void startSignIn()} disabled={busy()}>
              {t("settings.dshAccount.signIn")}
            </Button>
          }
        >
          <Button variant="outline" size="sm" onClick={() => void cancelSignIn()} disabled={busy()}>
            {t("settings.dshAccount.cancel")}
          </Button>
        </Show>
      </ItemActions>
    </Item>
  );
}
