import { SettingsMobileConnectTab as MobileConnectTab } from "@openbot/ui/features/settings/SettingsMobileConnectTab";
import { createSettingsMobileConnectStore } from "@openbot/ui/features/settings/stores/mobile-connect-store";
import { Show } from "solid-js";
import { DshAccountSignInRow } from "./DshAccountSignInRow";

/**
 * The Mobile Connect tab. The tab UI and its store are the upstream `packages/ui` ones; this fork
 * only feeds them from the local pairing service through the `auth` IPC group, and appends the
 * DeepSeek account row the fork adds to the same tab.
 */
export function SettingsMobileConnectTab(props: { open: boolean; active: () => boolean }) {
  const store = createSettingsMobileConnectStore(
    {
      get open() {
        return props.open && props.active();
      },
      onCreateMobileConnect: () => window.openbot.createMobileConnect(),
      onCancelMobileConnect: () => window.openbot.cancelMobileConnect(),
      onGetMobileConnectLink: () => window.openbot.getMobileConnectLink(),
      onCreateMobileConnectLink: () => window.openbot.createMobileConnectLink(),
      onRevokeMobileConnectLink: () => window.openbot.revokeMobileConnectLink(),
      onListMobileConnectedDevices: async () => [...(await window.openbot.listMobileConnectedDevices())],
      onRevokeMobileConnectedDevice: (sessionId) => window.openbot.revokeMobileConnectedDevice(sessionId),
      onGetRemoteNetworkRoute: () => window.openbot.getRemoteNetworkRoute(),
      onSetRemoteNetworkRoute: (route) => window.openbot.setRemoteNetworkRoute({ route }),
    },
    () => props.open && props.active(),
  );
  return (
    <>
      <MobileConnectTab store={store} canCreateTicket canCancelTicket canManageLink canRevokeDevice canSetRoute />
      <Show when={props.active()}>
        <div class="mt-4">
          <DshAccountSignInRow />
        </div>
      </Show>
    </>
  );
}
