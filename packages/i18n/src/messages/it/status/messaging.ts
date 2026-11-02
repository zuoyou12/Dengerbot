import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Ci sto lavorando…",
  "status.messaging.queued": "In attesa: Dengerbot sta lavorando a un'altra richiesta. La risposta arriva qui.",
  "status.messaging.busy": "Ci sono troppe richieste in attesa. Riprova più tardi.",
  "status.messaging.failed":
    "Dengerbot non è riuscito a completare questa richiesta. I dettagli sono sull'host di Dengerbot.",
  "status.messaging.noAnswer": "Dengerbot ha finito senza una risposta scritta.",
  "status.messaging.noAgent": "Nessun agente può ancora rispondere qui. Aggiungi lo Slack Orchestrator in Dengerbot.",
  "status.messaging.delegated": "Un collega ci sta lavorando. La risposta arriva qui.",
  "status.messaging.stopped": "Interrotto.",
  "status.messaging.stop": "Interrompi",
  "status.messaging.approvalTitle": "Dengerbot chiede l'approvazione per continuare.",
  "status.messaging.approvalCommand": "Eseguire un comando",
  "status.messaging.approvalFileChange": "Modificare dei file",
  "status.messaging.approvalPermissions": "Ottenere altri permessi",
  "status.messaging.approve": "Approva",
  "status.messaging.deny": "Rifiuta",
  "status.messaging.approvedBy": "Approvato da {user}.",
  "status.messaging.deniedBy": "Rifiutato da {user}.",
  "status.messaging.answeredOnHost": "Risposta data sull'host di Dengerbot.",
  "status.messaging.requestInactive": "Questa richiesta non è più attiva.",
  "status.messaging.onlyRequester": "Solo {user} può farlo. Può rispondere anche l'host di Dengerbot.",
  "status.messaging.hostOnly": "Solo l'host di Dengerbot può rispondere a questa richiesta.",
  "status.messaging.filesSkipped": "Alcuni file non sono stati inviati: {names}.",
  "status.messaging.orchestratorName": "Slack Orchestrator",
  "status.messaging.orchestratorTitle": "Risponde su Slack e consulta il team",
  "status.messaging.discordNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il Discord Orchestrator in Dengerbot.",
  "status.messaging.discordOrchestratorName": "Discord Orchestrator",
  "status.messaging.discordOrchestratorTitle": "Risponde su Discord e consulta il team",
  "status.messaging.integrationsSection": "Integrazioni",
  "status.messaging.signInReceived": "Dengerbot ha ricevuto l'installazione di Slack. Puoi chiudere questa scheda.",
  "status.messaging.signInUnknown": "Dengerbot non ha avviato questa installazione di Slack. Riavviala in Dengerbot.",
  "status.messaging.telegramNoAgent":
    "Nessun agente può ancora rispondere qui. Aggiungi il Telegram Orchestrator in Dengerbot.",
  "status.messaging.telegramLinked":
    "Dengerbot è collegato a questa chat. Menziona {bot} o rispondi a un messaggio di Dengerbot per interpellare gli agenti.",
  "status.messaging.telegramOrchestratorName": "Telegram Orchestrator",
  "status.messaging.telegramOrchestratorTitle": "Risponde su Telegram e consulta il team",
} as const satisfies PartialTranslation<typeof source>;
