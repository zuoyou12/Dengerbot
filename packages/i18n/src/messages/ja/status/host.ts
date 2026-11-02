import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "この Dengerbot を WebRTC アクセス用に登録しました。",
  "status.host.keyRotated": "サーバーキーを変更しました。ペアリング済みのデバイスはそのままです。",
  "status.host.identityUpdated": "サーバーの ID を更新しました。",
  "status.host.starting": "WebRTC ホストを起動しています…",
  "status.host.ready": "この Dengerbot は WebRTC 接続の準備ができています。",
  "status.host.stopping": "この Dengerbot を非公開にしています…",
  "status.host.private": "この Dengerbot は非公開です。",
} as const satisfies PartialTranslation<typeof source>;
