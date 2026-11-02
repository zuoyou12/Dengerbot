import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/host";

export const messages = {
  // Status lines of the WebRTC host.
  "status.host.registered": "Cet Dengerbot est enregistré pour l’accès WebRTC.",
  "status.host.keyRotated": "Clé du serveur changée. Les appareils associés restent associés.",
  "status.host.identityUpdated": "Identité du serveur mise à jour.",
  "status.host.starting": "Démarrage de l’hôte WebRTC…",
  "status.host.ready": "Cet Dengerbot est prêt pour les connexions WebRTC.",
  "status.host.stopping": "Passage de cet Dengerbot en mode privé…",
  "status.host.private": "Cet Dengerbot est privé.",
} as const satisfies PartialTranslation<typeof source>;
