// Agent templates, local only: previewing one agent.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentTemplateService } from "../agent-template-service";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { stringPayload } from "./validation";

export interface AgentTemplateIpcDependencies {
  agentTemplates: AgentTemplateService;
}

export function agentTemplateIpcHandlers({
  agentTemplates,
}: AgentTemplateIpcDependencies): Pick<IpcGroupHandlers, "agentTemplates"> {
  return {
    agentTemplates: {
      preview: payloadHandler(stringPayload("agentId"), (agentId) => runCauseEffect(agentTemplates.preview(agentId))),
    },
  };
}
