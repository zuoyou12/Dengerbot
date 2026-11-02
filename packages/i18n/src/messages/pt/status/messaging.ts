import type { PartialTranslation } from "../../../message";
import type { messages as source } from "../../en/status/messaging";

export const messages = {
  "status.messaging.working": "Trabalhando nisso…",
  "status.messaging.queued": "Aguardando: o Dengerbot está atendendo outra solicitação. A resposta chegará aqui.",
  "status.messaging.busy": "Há muitas solicitações na fila. Tente novamente mais tarde.",
  "status.messaging.failed":
    "O Dengerbot não conseguiu concluir esta solicitação. Os detalhes estão no computador anfitrião do Dengerbot.",
  "status.messaging.noAnswer": "O Dengerbot terminou sem uma resposta por escrito.",
  "status.messaging.noAgent": "Nenhum agente pode responder aqui ainda. Adicione o Orquestrador do Slack no Dengerbot.",
  "status.messaging.delegated": "Um colega está trabalhando nisso. A resposta chegará aqui.",
  "status.messaging.stopped": "Interrompido.",
  "status.messaging.stop": "Parar",
  "status.messaging.approvalTitle": "O Dengerbot pede aprovação para continuar.",
  "status.messaging.approvalCommand": "Executar um comando",
  "status.messaging.approvalFileChange": "Alterar arquivos",
  "status.messaging.approvalPermissions": "Obter mais permissões",
  "status.messaging.approve": "Aprovar",
  "status.messaging.deny": "Negar",
  "status.messaging.approvedBy": "Aprovado por {user}.",
  "status.messaging.deniedBy": "Negado por {user}.",
  "status.messaging.answeredOnHost": "Respondido no computador anfitrião do Dengerbot.",
  "status.messaging.requestInactive": "Esta solicitação não está mais ativa.",
  "status.messaging.onlyRequester":
    "Somente {user} pode fazer isso. Também é possível responder no computador anfitrião do Dengerbot.",
  "status.messaging.hostOnly": "Esta solicitação só pode ser respondida no computador anfitrião do Dengerbot.",
  "status.messaging.filesSkipped": "Alguns arquivos não foram enviados: {names}.",
  "status.messaging.orchestratorName": "Orquestrador do Slack",
  "status.messaging.orchestratorTitle": "Responde no Slack e consulta a equipe",
  "status.messaging.discordNoAgent":
    "Nenhum agente pode responder aqui ainda. Adicione o Orquestrador do Discord no Dengerbot.",
  "status.messaging.discordOrchestratorName": "Orquestrador do Discord",
  "status.messaging.discordOrchestratorTitle": "Responde no Discord e consulta a equipe",
  "status.messaging.integrationsSection": "Integrações",
  "status.messaging.signInReceived": "O Dengerbot recebeu a instalação do Slack. Você pode fechar esta aba.",
  "status.messaging.signInUnknown":
    "O Dengerbot não iniciou esta instalação do Slack. Inicie a instalação novamente no Dengerbot.",
  "status.messaging.telegramNoAgent":
    "Nenhum agente pode responder aqui ainda. Adicione o Orquestrador do Telegram no Dengerbot.",
  "status.messaging.telegramLinked":
    "O Dengerbot está conectado a este chat. Mencione {bot} ou responda a uma mensagem do Dengerbot para falar com os agentes.",
  "status.messaging.telegramOrchestratorName": "Orquestrador do Telegram",
  "status.messaging.telegramOrchestratorTitle": "Responde no Telegram e consulta a equipe",
} as const satisfies PartialTranslation<typeof source>;
