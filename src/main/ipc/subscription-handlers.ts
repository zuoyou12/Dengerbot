import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseSubscriptionAccount,
  parseSubscriptionCancelLogin,
  parseSubscriptionEnabled,
  parseSubscriptionOptions,
  parseSubscriptionPackage,
  parseSubscriptionPreferences,
  parseSubscriptionRefresh,
  parseSubscriptionStartLogin,
  parseSubscriptionSubmitLogin,
} from "./subscription-inputs";

/** Plugin credentials stay in the runtime. IPC receives only the sanitized management snapshot. */
export function subscriptionIpcHandlers(
  actions: Omit<OpenBotDesktopApi["subscriptions"], "openLogin">,
  openLink: (url: string) => Promise<void>,
): Pick<IpcGroupHandlers, "subscriptions"> {
  return {
    subscriptions: {
      getState: handler(() => actions.getState()),
      refresh: payloadHandler(parseSubscriptionRefresh, (input) => actions.refresh(input)),
      install: payloadHandler(parseSubscriptionPackage, (input) => actions.install(input)),
      update: payloadHandler(parseSubscriptionPackage, (input) => actions.update(input)),
      remove: payloadHandler(parseSubscriptionPackage, (input) => actions.remove(input)),
      setEnabled: payloadHandler(parseSubscriptionEnabled, (input) => actions.setEnabled(input)),
      setPreferences: payloadHandler(parseSubscriptionPreferences, (input) => actions.setPreferences(input)),
      startLogin: payloadHandler(parseSubscriptionStartLogin, (input) => actions.startLogin(input)),
      submitLogin: payloadHandler(parseSubscriptionSubmitLogin, (input) => actions.submitLogin(input)),
      cancelLogin: payloadHandler(parseSubscriptionCancelLogin, (input) => actions.cancelLogin(input)),
      openLogin: payloadHandler(parseSubscriptionCancelLogin, async ({ loginId }) => {
        const login = (await actions.getState()).logins.find(
          (entry) => entry.id === loginId && entry.status === "waiting",
        );
        if (!login?.url) throw new Error("Subscription authorization link is no longer available.");
        const target = new URL(login.url);
        if (
          target.protocol !== "https:" &&
          !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))
        ) {
          throw new Error("Invalid subscription authorization link.");
        }
        await openLink(target.href);
      }),
      signOut: payloadHandler(parseSubscriptionAccount, (input) => actions.signOut(input)),
      getUsage: payloadHandler(parseSubscriptionAccount, (input) => actions.getUsage(input)),
      checkIn: payloadHandler(parseSubscriptionAccount, (input) => actions.checkIn(input)),
      setOptions: payloadHandler(parseSubscriptionOptions, (input) => actions.setOptions(input)),
    },
  };
}
