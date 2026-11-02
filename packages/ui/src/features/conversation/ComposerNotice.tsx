import { type AgentProviderId, agentProviderName } from "@openbot/contracts/agent-providers";
import type { AppFormat } from "@openbot/i18n";
import { Button, ErrorReference, TriangleAlert } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createEffect, createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";

/**
 * The shared slab every composer notice uses: a warning-toned card in the queue's shape, above the
 * input and under the queue, because the user reads that column top to bottom before they send.
 *
 * `tone` is `danger` for errors and spent plan windows, and `warning` for account setup notices.
 *
 * `onDismiss` decides the rest. A notice the user can clear gets the close button, Escape, and
 * `role="alert"`, because a state the user did not ask for has to announce itself. The states they
 * walked into, such as a signed-out provider, stay until they are resolved, so they
 * only report. `title` is optional: a failure the provider already stated in a sentence gains
 * nothing from a label that repeats the word "error" above it.
 */
export function ComposerNotice(props: {
  tone?: "warning" | "danger";
  title?: string | undefined;
  body: string;
  /** The code of the failure the body states. */
  reference?: string | null | undefined;
  action?: JSX.Element;
  conversationKey?: string | null | undefined;
  onDismiss?: () => void;
}) {
  const { t } = useText();
  return (
    <Show
      when={props.onDismiss}
      fallback={
        <div
          class="composer-notice"
          data-tone={props.tone ?? "warning"}
          data-conversation-key={props.conversationKey ?? undefined}
          role="status"
        >
          <NoticeContent title={props.title} body={props.body} reference={props.reference} action={props.action} />
        </div>
      }
    >
      {(dismiss) => (
        <div
          class="composer-notice"
          data-tone={props.tone ?? "warning"}
          data-conversation-key={props.conversationKey ?? undefined}
          role="alert"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            dismiss()();
          }}
        >
          <NoticeContent title={props.title} body={props.body} reference={props.reference} action={props.action} />
          <Button
            variant="ghost"
            type="button"
            size="sm"
            class="composer-notice-dismiss"
            aria-label={t("composer.notice.dismiss")}
            data-cuelume-tap="close"
            onClick={() => dismiss()()}
          >
            <CloseIcon />
          </Button>
        </div>
      )}
    </Show>
  );
}

/** The icon, copy and optional action the card carries, whichever role announces it. */
function NoticeContent(props: {
  title?: string | undefined;
  body: string;
  reference?: string | null | undefined;
  action?: JSX.Element;
}) {
  return (
    <>
      <TriangleAlert class="composer-notice-icon" aria-hidden="true" />
      <div class="composer-notice-copy">
        <Show when={props.title}>{(title) => <strong>{title()}</strong>}</Show>
        <p>{props.body}</p>
        <ErrorReference reference={props.reference} />
      </div>
      <Show when={props.action}>{props.action}</Show>
    </>
  );
}

export function ComposerUpdateNotice(props: {
  provider: AgentProviderId;
  onUpdate?: ((provider: AgentProviderId) => void | Promise<void>) | undefined;
  updating?: boolean;
}) {
  const { t } = useText();
  const [starting, setStarting] = createSignal(false);
  const busy = () => starting() || Boolean(props.updating);
  const update = async () => {
    if (busy()) return;
    setStarting(true);
    try {
      await props.onUpdate?.(props.provider);
    } finally {
      setStarting(false);
    }
  };
  return (
    <ComposerNotice
      body={
        props.onUpdate
          ? t("composer.update.body", { provider: agentProviderName(props.provider) })
          : t("composer.update.manual", { provider: agentProviderName(props.provider) })
      }
      action={
        <Show when={props.onUpdate}>
          <Button
            variant="outline"
            size="sm"
            type="button"
            loading={busy()}
            loadingLabel={t("composer.update.pending")}
            onClick={() => void update()}
          >
            {t("composer.update.action")}
          </Button>
        </Show>
      }
    />
  );
}

/** The reset moment, in the reader's own locale. A window with no reported reset gets no sentence. */
export function formatUsageReset(resetsAt: number | null | undefined, format: AppFormat): string | null {
  if (resetsAt === null || resetsAt === undefined) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return format.date(date, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A spent plan window can coexist with paid credits. Dismissing the notice only hides the reading;
 * the provider still decides whether to accept the next turn.
 */
export function ComposerUsageLimitNotice(props: {
  provider: AgentProviderId;
  resetsAt?: number | null;
  onShown?: () => void;
  onDismiss: () => void;
}) {
  const { t, format } = useText();
  createEffect(
    () => props.provider,
    () => props.onShown?.(),
  );
  const resetAt = () => formatUsageReset(props.resetsAt, format);
  const body = () => {
    const provider = agentProviderName(props.provider);
    const reset = resetAt();
    return reset
      ? t("composer.usageLimit.resets", { provider, reset })
      : t("composer.usageLimit.selectModel", { provider });
  };
  return (
    <ComposerNotice tone="danger" title={t("composer.usageLimit.title")} body={body()} onDismiss={props.onDismiss} />
  );
}
