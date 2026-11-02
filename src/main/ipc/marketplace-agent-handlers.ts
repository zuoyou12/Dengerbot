// The agent marketplace, local only: reading and installing the curated catalog that ships with
// the app. Submitting an agent of one's own has no account behind it in this build, so there is
// no endpoint for it.

import type { AgentMarketplaceService } from "../agent-marketplace-service";
import { parseInstallMarketplaceAgent, parseMarketplaceAgentQuery } from "./app-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { nullishPayload, stringPayload } from "./validation";

export interface MarketplaceAgentIpcDependencies {
  marketplaceAgents: AgentMarketplaceService;
}

export function marketplaceAgentIpcHandlers({
  marketplaceAgents,
}: MarketplaceAgentIpcDependencies): Pick<IpcGroupHandlers, "marketplaceAgents"> {
  return {
    marketplaceAgents: {
      list: payloadHandler(nullishPayload(parseMarketplaceAgentQuery), (query) => marketplaceAgents.list(query ?? {})),
      get: payloadHandler(stringPayload("listingId"), (listingId) => marketplaceAgents.get(listingId)),
      getListing: payloadHandler(stringPayload("listingId"), (listingId) => marketplaceAgents.getListing(listingId)),
      install: payloadHandler(parseInstallMarketplaceAgent, (installation) => marketplaceAgents.install(installation)),
    },
  };
}
