import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.appTitle": "Dengerbot",
  // Native window titles.
  "window.localHostTitle": "Dengerbot 本地主机",
  "window.localClientTitle": "Dengerbot 本地客户端",
  "window.computerUsePermissionTitle": "开启 Computer Use",
} as const satisfies PartialTranslation<typeof source>;
