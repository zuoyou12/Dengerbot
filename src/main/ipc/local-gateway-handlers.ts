import type {
  LocalGatewayEnabledInput,
  LocalGatewayPortInput,
  SetExternalProviderInput,
  WireAgentInput,
} from "@openbot/contracts/ipc";
import type { LocalGateway } from "../local-gateway";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject } from "./validation";

export function localGatewayIpcHandlers(gateway: LocalGateway): Pick<IpcGroupHandlers, "localGateway"> {
  return {
    localGateway: {
      getStatus: handler(() => gateway.status()),
      setEnabled: payloadHandler(parseLocalGatewayEnabled, ({ enabled }) => gateway.setEnabled(enabled)),
      setPort: payloadHandler(parseLocalGatewayPort, ({ port }) => gateway.setPort(port)),
      rotateToken: handler(() => gateway.rotateToken()),
      getAgents: handler(() => gateway.getAgents()),
      wireAgent: payloadHandler(parseWireAgent, (input) => gateway.wireAgent(input)),
      getExternalProviders: handler(() => gateway.getExternalProviders()),
      setExternalProvider: payloadHandler(parseSetExternalProvider, (input) => gateway.setExternalProvider(input)),
    },
  };
}

function parseLocalGatewayEnabled(input: unknown): LocalGatewayEnabledInput {
  if (!isObject(input) || typeof input.enabled !== "boolean") {
    throw new Error("Invalid local gateway enabled flag.");
  }
  return { enabled: input.enabled };
}

function parseLocalGatewayPort(input: unknown): LocalGatewayPortInput {
  if (
    !isObject(input) ||
    typeof input.port !== "number" ||
    !Number.isInteger(input.port) ||
    input.port < 1024 ||
    input.port > 65535
  ) {
    throw new Error("Invalid local gateway port.");
  }
  return { port: input.port };
}

function parseWireAgent(input: unknown): WireAgentInput {
  if (!isObject(input) || typeof input.agentId !== "string" || typeof input.enabled !== "boolean") {
    throw new Error("Invalid wire agent input.");
  }
  return { agentId: input.agentId, enabled: input.enabled };
}

function parseSetExternalProvider(input: unknown): SetExternalProviderInput {
  if (!isObject(input) || typeof input.providerId !== "string" || typeof input.enabled !== "boolean") {
    throw new Error("Invalid set external provider input.");
  }
  let apiKey: string | undefined;
  if ("apiKey" in input && input.apiKey !== undefined && input.apiKey !== null) {
    if (typeof input.apiKey !== "string") {
      throw new Error("Invalid apiKey in set external provider input.");
    }
    apiKey = input.apiKey.trim();
  }
  return {
    providerId: input.providerId,
    enabled: input.enabled,
    ...(apiKey !== undefined ? { apiKey } : {}),
  };
}
