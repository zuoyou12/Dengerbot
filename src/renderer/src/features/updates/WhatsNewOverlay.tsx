import { toast } from "@openbot/ui";
import { WhatsNewDialog } from "@openbot/ui/features/updates/WhatsNewDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, untrack } from "solid-js";
import { appPort } from "../../app-port";
import { updatesPort } from "./updates-port";
import { useWhatsNew } from "./whats-new-context";

/** Mounted only when the workspace is ready, outside the lifetime of a selected server. */
export function WhatsNewOverlay(props: { ready: boolean }) {
  const { t, errorMessage } = useText();
  const whatsNew = useWhatsNew();
  createEffect(
    () => props.ready && whatsNew.state.version !== "",
    (ready) => {
      if (ready) untrack(whatsNew.start);
    },
  );
  return (
    <WhatsNewDialog
      open={props.ready && whatsNew.state.open}
      version={whatsNew.state.version}
      previousVersion={whatsNew.state.previousVersion}
      notes={whatsNew.state.notes}
      catalog={whatsNew.state.catalog}
      latestTag={whatsNew.state.latestTag}
      catalogFailed={whatsNew.state.catalogFailed}
      offlineNotes={whatsNew.state.offlineNotes}
      truncated={whatsNew.state.truncated}
      onOpenAsset={(url) => {
        void appPort()
          .openUrl(url)
          .catch((error: unknown) => toast.error(errorMessage(error, t("update.whatsNew.downloadFailed")), { error }));
      }}
      onOpenChange={(open) => {
        if (!open) whatsNew.close();
      }}
      onRetry={whatsNew.retry}
      onOpenChangelog={() => {
        void updatesPort()
          .update.getReleasePage()
          .then((url) => appPort().openUrl(url))
          .catch((error: unknown) => toast.error(errorMessage(error, t("update.whatsNew.changelogFailed")), { error }));
      }}
    />
  );
}
