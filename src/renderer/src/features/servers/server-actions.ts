import type { ServerSummary } from "@openbot/contracts/ipc";
import { classifyFailure } from "@openbot/telemetry";
import type { ServerActionCallbacks } from "@openbot/ui/features/servers/ServerActionItems";
import { useText } from "@openbot/ui/text";
import { actionToast } from "../../action-toast";
import { usePlatform } from "../../platform";
import { useServerSelection } from "./server-selection";
import { useServerSettings } from "./server-settings";
import { useServers } from "./servers-context";

/**
 * What the server rail and the server menu on the sidebar title both do with a server. The two
 * views show the same servers in the same order and must not disagree on an action.
 */
export function useServerActions() {
  const platform = usePlatform();
  const { t, errorMessage } = useText();
  const { servers, setServerMuted, setServerNotificationLevel, setJoinServerOpen } = useServers();
  const { selectServer } = useServerSelection();
  const { openServerSettings, requestLeaveServer } = useServerSettings();

  /** Local servers above the saved remote-server order, as the rail draws them. */
  function orderedServers(): ServerSummary[] {
    return [
      ...servers().filter((server) => server.kind === "local"),
      ...servers().filter((server) => server.kind === "remote"),
    ];
  }

  function selectFailed(error: unknown): void {
    actionToast.error(t("server.select.failedTitle"), {
      ...{
        description: errorMessage(error, t("server.select.failedDescription")),
      },
      report: { operation: "team", source: "action", cause_code: classifyFailure(error) },
    });
  }

  function select(serverId: string): void {
    void selectServer(serverId).catch(selectFailed);
  }

  /** Opens the invite dialog: with no hosted servers, the plus button only joins a server. */
  function add(): void {
    if (platform.landingPreview) return;
    setJoinServerOpen(true);
  }

  const callbacks = {
    onSetMuted: (serverId, muted, durationMs) => void setServerMuted(serverId, muted, durationMs),
    onSetNotificationLevel: (serverId, level) => void setServerNotificationLevel(serverId, level),
    onOpenSettings: openServerSettings,
    onLeave: requestLeaveServer,
    // The same confirmation: main removes an owned server from the account instead of leaving it.
    onRemove: requestLeaveServer,
    canRemove: () => true,
  } satisfies ServerActionCallbacks;

  return { orderedServers, select, add, addCreatesServer: () => false, callbacks };
}
