// The `auth` IPC group: pairing a phone with this computer, and the DeepSeek account row beside it.
//
// The mobile-connect service itself is the trust boundary on the HTTP side; this registrar only
// forwards what the settings tab asks for. Every payload is a string the renderer already holds, so
// the decoders stay small and the errors say which argument was wrong.

import type { DshSignInService } from "../dsh-sign-in";
import type { MobileConnectService } from "../mobile-connect-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export function accountIpcHandlers(input: {
  mobileConnect: MobileConnectService;
  dshSignIn: DshSignInService;
}): Pick<IpcGroupHandlers, "auth"> {
  const { mobileConnect, dshSignIn } = input;
  return {
    auth: {
      createMobileConnect: handler(() => mobileConnect.createMobileConnect()),
      cancelMobileConnect: handler(() => mobileConnect.cancelMobileConnect()),
      getMobileConnectLink: handler(() => mobileConnect.getMobileConnectLink()),
      createMobileConnectLink: handler(() => mobileConnect.createMobileConnectLink()),
      revokeMobileConnectLink: handler(() => mobileConnect.revokeMobileConnectLink()),
      listMobileConnectedDevices: handler(() => mobileConnect.listDevices()),
      revokeMobileConnectedDevice: payloadHandler(stringPayload("sessionId"), (sessionId) =>
        mobileConnect.revokeDevice(sessionId),
      ),
      getDshAccount: handler(() => mobileConnect.dshSignInState(dshSignIn.phase)),
      startDshSignIn: handler(() => dshSignIn.startSignIn()),
      cancelDshSignIn: handler(() => dshSignIn.cancelSignIn()),
    },
  };
}
