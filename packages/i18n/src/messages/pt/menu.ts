import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/menu";

export const messages = {
  "menu.stopAllAgents": "Parar todos os agentes",
  "menu.checkForUpdates": "Buscar atualizações…",
  "menu.preferences": "Configurações…",
  "menu.actualSize": "Tamanho real",
  "menu.zoomIn": "Ampliar",
  "menu.zoomOut": "Reduzir",
  "menu.copyLink": "Copiar link",
  "menu.trayOpen": "Abrir o Dengerbot",
  "menu.trayQuit": "Sair do Dengerbot",
  "menu.trayTooltip": "Dengerbot",
} as const satisfies PartialTranslation<typeof source>;
