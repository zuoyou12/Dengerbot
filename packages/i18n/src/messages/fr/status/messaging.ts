import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "En cours…",
  "status.messaging.queued": "En attente : Dengerbot traite une autre demande. La réponse arrivera ici.",
  "status.messaging.busy": "Trop de demandes sont en attente. Réessayez plus tard.",
  "status.messaging.failed": "Dengerbot n’a pas pu terminer cette demande. L’hôte Dengerbot dispose des détails.",
  "status.messaging.noAnswer": "Dengerbot a terminé sans réponse écrite.",
  "status.messaging.noAgent": "Aucun agent ne peut encore répondre ici. Ajoutez l’Orchestrateur Slack dans Dengerbot.",
  "status.messaging.delegated": "Un coéquipier s’en occupe. La réponse arrivera ici.",
  "status.messaging.stopped": "Arrêté.",
  "status.messaging.stop": "Arrêter",
  "status.messaging.approvalTitle": "Dengerbot demande une approbation pour continuer.",
  "status.messaging.approvalCommand": "Exécuter une commande",
  "status.messaging.approvalFileChange": "Modifier des fichiers",
  "status.messaging.approvalPermissions": "Obtenir plus d’autorisations",
  "status.messaging.approve": "Approuver",
  "status.messaging.deny": "Refuser",
  "status.messaging.approvedBy": "Approuvé par {user}.",
  "status.messaging.deniedBy": "Refusé par {user}.",
  "status.messaging.answeredOnHost": "Réponse donnée sur l’hôte Dengerbot.",
  "status.messaging.requestInactive": "Cette demande n’est plus active.",
  "status.messaging.onlyRequester": "Seul {user} peut faire cela. L’hôte Dengerbot peut aussi répondre.",
  "status.messaging.hostOnly": "Seul l’hôte Dengerbot peut répondre à cette demande.",
  "status.messaging.filesSkipped": "Certains fichiers n’ont pas été envoyés : {names}.",
  "status.messaging.orchestratorName": "Orchestrateur Slack",
  "status.messaging.orchestratorTitle": "Répond dans Slack et consulte l’équipe",
  "status.messaging.discordNoAgent":
    "Aucun agent ne peut encore répondre ici. Ajoutez l’Orchestrateur Discord dans Dengerbot.",
  "status.messaging.discordOrchestratorName": "Orchestrateur Discord",
  "status.messaging.discordOrchestratorTitle": "Répond dans Discord et consulte l’équipe",
  "status.messaging.integrationsSection": "Intégrations",
  "status.messaging.signInReceived": "Dengerbot a reçu l’installation Slack. Vous pouvez fermer cet onglet.",
  "status.messaging.signInUnknown": "Dengerbot n’a pas lancé cette installation Slack. Relancez-la dans Dengerbot.",
  "status.messaging.telegramNoAgent":
    "Aucun agent ne peut encore répondre ici. Ajoutez l’Orchestrateur Telegram dans Dengerbot.",
  "status.messaging.telegramLinked":
    "Dengerbot est connecté à cette discussion. Mentionnez {bot} ou répondez à un message de Dengerbot pour solliciter les agents.",
  "status.messaging.telegramOrchestratorName": "Orchestrateur Telegram",
  "status.messaging.telegramOrchestratorTitle": "Répond dans Telegram et consulte l’équipe",
} as const satisfies PartialTranslation<typeof source>;
