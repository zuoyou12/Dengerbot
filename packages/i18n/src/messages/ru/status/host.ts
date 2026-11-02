import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  "status.host.registered": "Этот Dengerbot зарегистрирован для доступа через WebRTC.",
  "status.host.keyRotated": "Ключ сервера изменён. Связанные устройства остаются связанными.",
  "status.host.identityUpdated": "Идентификатор сервера обновлён.",
  "status.host.starting": "Запуск хоста WebRTC…",
  "status.host.ready": "Этот Dengerbot готов к подключениям WebRTC.",
  "status.host.stopping": "Перевод этого Dengerbot в приватный режим…",
  "status.host.private": "Этот Dengerbot приватный.",
} as const satisfies PartialTranslation<typeof source>;
