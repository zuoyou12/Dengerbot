import type { DshRuntimeDesktopApi } from "@openbot/contracts/ipc";

/** The DSH runtime status and its update channel, read on each call like the other ports. */
export function dshRuntimePort(): DshRuntimeDesktopApi {
  return window.openbot.dshRuntime;
}
