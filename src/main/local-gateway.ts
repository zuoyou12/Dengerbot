import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type {
  ConnectedAgentInfo,
  ExternalProviderInfo,
  LocalGatewaySourceStatus,
  LocalGatewayStatus,
  SetExternalProviderInput,
  WireAgentInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import type { CustomProviderConfig } from "../backend/custom-provider-types";
import { type AgentModelSummary, detectConnectedAgents, wireAgent as doWireAgent } from "./gateway-agents";
import { ExternalProvidersManager, type FetchFunction } from "./gateway-external-providers";

const logger = createOpenBotLogger("local-gateway");
const DEFAULT_PORT = 47821;
const UPSTREAM_TIMEOUT_MS = 10 * 60_000;

/** One upstream the gateway can call: a provider key, or a saved OpenAI-compatible endpoint. */
export interface GatewaySource {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  models: readonly { id: string; name: string }[];
}

export type { LocalGatewaySourceStatus, LocalGatewayStatus };

interface GatewayConfig {
  enabled: boolean;
  port: number;
  token: string;
}

export interface LocalGatewayOptions {
  /** Compatibility endpoints remain callable, but external-agent sharing is retired. */
  legacyDisabled?: boolean;
  /** `provider-state` under the user data folder. */
  stateDirectory: string;
  /** The DeepSeek key the app stores for its own provider, or null. */
  deepseekKey: () => string | null;
  /** The saved custom endpoints, keys and headers included, as the backend sees them. */
  customEndpoints: () => readonly CustomProviderConfig[];
  fetchImpl?: FetchFunction;
}

export interface LocalGateway {
  status(): LocalGatewayStatus;
  setEnabled(enabled: boolean): Promise<LocalGatewayStatus>;
  setPort(port: number): Promise<LocalGatewayStatus>;
  rotateToken(): Promise<LocalGatewayStatus>;
  getAgents(): readonly ConnectedAgentInfo[];
  wireAgent(input: WireAgentInput): readonly ConnectedAgentInfo[];
  getExternalProviders(): Promise<readonly ExternalProviderInfo[]>;
  setExternalProvider(input: SetExternalProviderInput): Promise<readonly ExternalProviderInfo[]>;
  stop(): Promise<void>;
}

export interface ModelRoutingResolution {
  source: GatewaySource;
  upstreamModel: string;
}

export interface RefusalCheckResult {
  isRefusal: boolean;
  status: number;
  message: string;
  code?: number;
}

/**
 * Resolves an incoming model string against active gateway sources.
 */
export function resolveModelSource(
  requestedModel: string,
  sources: readonly GatewaySource[],
): ModelRoutingResolution | null {
  if (!requestedModel || sources.length === 0) return null;

  const modelTrimmed = requestedModel.trim();
  const modelLower = modelTrimmed.toLowerCase();

  // 1. Explicit Provider Prefix (e.g., "qoder/claude-3-7-sonnet", "zcode/glm-4-plus", "trae/gpt-4o")
  if (modelTrimmed.includes("/")) {
    const slashIndex = modelTrimmed.indexOf("/");
    const prefix = modelTrimmed.slice(0, slashIndex).toLowerCase();
    const tail = modelTrimmed.slice(slashIndex + 1).trim();

    const normalizedPrefix =
      prefix === "trae" || prefix === "trae-cn" || prefix === "trae_cn"
        ? "trae-cn"
        : prefix === "qoder-cn" || prefix === "qoder_cn"
          ? "qoder-cn"
          : prefix === "workbuddy-ai" || prefix === "workbuddy_ai"
            ? "workbuddy-ai"
            : prefix;

    const matchedSource = sources.find((s) => {
      const sIdLower = s.id.toLowerCase();
      return (
        sIdLower === normalizedPrefix ||
        (normalizedPrefix === "trae-cn" && (sIdLower === "trae" || sIdLower === "trae-cn")) ||
        (normalizedPrefix === "qoder" && sIdLower === "qoder")
      );
    });

    if (matchedSource) {
      const isNativeModel = matchedSource.models.some((m) => m.id.toLowerCase() === modelLower);
      return {
        source: matchedSource,
        upstreamModel: isNativeModel ? modelTrimmed : tail,
      };
    }
  }

  // 2. Exact Match in Candidate Models (case-insensitive)
  for (const source of sources) {
    const match = source.models.find((m) => m.id.toLowerCase() === modelLower);
    if (match) {
      return { source, upstreamModel: match.id };
    }
  }

  // 3. Family Prefixes & Provider Heuristics
  // A. ZCode: glm-*, codegeex-*
  if (modelLower.startsWith("glm-") || modelLower.startsWith("codegeex-")) {
    const zcode = sources.find((s) => s.id === "zcode");
    if (zcode) {
      return { source: zcode, upstreamModel: modelTrimmed };
    }
  }

  // B. Qoder native models: qoder/*
  if (modelLower.startsWith("qoder/")) {
    const qoder = sources.find((s) => s.id === "qoder") ?? sources.find((s) => s.id === "qoder-cn");
    if (qoder) {
      return { source: qoder, upstreamModel: modelTrimmed };
    }
  }

  // C. Trae / Kimi models: kimi-*, trae-*
  if (modelLower.startsWith("kimi-") || modelLower.startsWith("trae-")) {
    const trae = sources.find((s) => s.id === "trae-cn" || s.id === "trae");
    if (trae) {
      return { source: trae, upstreamModel: modelTrimmed };
    }
  }

  // D. DeepSeek models: deepseek-*
  if (modelLower.startsWith("deepseek-")) {
    const deepseek = sources.find((s) => s.id === "deepseek");
    if (deepseek) return { source: deepseek, upstreamModel: modelTrimmed };

    const wb = sources.find((s) => s.id === "workbuddy-ai" || s.id === "workbuddy");
    if (wb) return { source: wb, upstreamModel: modelTrimmed };

    const trae = sources.find((s) => s.id === "trae-cn" || s.id === "trae");
    if (trae) return { source: trae, upstreamModel: modelTrimmed };

    const qoder = sources.find((s) => s.id === "qoder" || s.id === "qoder-cn");
    if (qoder) return { source: qoder, upstreamModel: modelTrimmed };
  }

  // E. WorkBuddy legacy heuristics (claude, gpt, qwen)
  if (modelLower.includes("claude") || modelLower.includes("gpt") || modelLower.includes("qwen")) {
    const wb = sources.find((s) => s.id.startsWith("workbuddy"));
    if (wb) return { source: wb, upstreamModel: modelTrimmed };
  }

  return null;
}

/**
 * Resolves the upstream chat completions endpoint URL from a provider's base URL.
 */
export function resolveTargetChatUrl(baseUrl: string): string {
  const clean = baseUrl.replace(/\/+$/u, "");
  if (clean.endsWith("/chat/completions") || clean.endsWith("/completions")) {
    return clean;
  }
  if (clean.includes("/v1") || clean.includes("/v4") || clean.includes("/api/")) {
    return `${clean}/chat/completions`;
  }
  return `${clean}/v1/chat/completions`;
}

/**
 * Builds HTTP headers for upstream forwarding.
 */
export function buildUpstreamHeaders(source: GatewaySource): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };

  if (source.headers) {
    for (const [key, value] of Object.entries(source.headers)) {
      if (value !== undefined && value !== null) {
        headers[key] = value;
      }
    }
  }

  if (source.apiKey) {
    const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
    if (!hasAuth) {
      headers.authorization = source.apiKey.startsWith("Bearer ") ? source.apiKey : `Bearer ${source.apiKey}`;
    }
  }

  return headers;
}

/**
 * Checks if a response represents a ZCode / Zhipu business refusal envelope over HTTP 200.
 */
export function checkZCodeRefusalEnvelope(status: number, _contentType: string, jsonBody: unknown): RefusalCheckResult {
  if (status !== 200 || !isDynamicRecord(jsonBody) || jsonBody.success !== false) {
    return { isRefusal: false, status, message: "" };
  }

  const code = typeof jsonBody.code === "number" ? jsonBody.code : undefined;
  const msg = typeof jsonBody.msg === "string" ? jsonBody.msg : "ZCode upstream error";

  let rewrittenStatus = 502;
  if (code !== undefined) {
    if (code >= 1000 && code <= 1005) {
      rewrittenStatus = 401; // Unauthorized
    } else if (code === 1113 || (code >= 1302 && code <= 1399)) {
      rewrittenStatus = 429; // Rate limit / Quota exhausted
    } else if (code === 1220) {
      rewrittenStatus = 403; // Forbidden
    } else if ((code >= 1210 && code <= 1229) || code === 1261 || code === 1301) {
      rewrittenStatus = 400; // Bad parameter
    }
  }

  return {
    isRefusal: true,
    status: rewrittenStatus,
    message: msg,
    code,
  };
}

export function createLocalGateway(options: LocalGatewayOptions): LocalGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const configPath = join(options.stateDirectory, "local-gateway.json");
  const externalManager = ExternalProvidersManager.getOrCreate(options.stateDirectory);

  let config = readConfig(configPath);
  let server: Server | null = null;
  let port = 0;
  let requests = 0;
  let errors = 0;
  let cachedExternalSources: GatewaySource[] = [];

  // Initial detection of external sources
  if (!options.legacyDisabled)
    void externalManager
      .getGatewaySources(fetchImpl)
      .then((res) => {
        cachedExternalSources = res;
      })
      .catch(() => {});

  function sources(): GatewaySource[] {
    const list: GatewaySource[] = [];
    const key = options.deepseekKey();
    if (key) {
      list.push({
        id: "deepseek",
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        apiKey: key,
        headers: {},
        models: [
          { id: "deepseek-chat", name: "DeepSeek V3" },
          { id: "deepseek-reasoner", name: "DeepSeek R1" },
        ],
      });
    }
    for (const endpoint of options.customEndpoints()) {
      if (!endpoint.apiKey && endpoint.headers.length === 0) continue;
      list.push({
        id: endpoint.id,
        name: endpoint.name || endpoint.id,
        baseUrl: endpoint.baseUrl,
        apiKey: endpoint.apiKey ?? "",
        headers: Object.fromEntries(endpoint.headers.map((header) => [header.name, header.value])),
        models: endpoint.models.map((model) => ({ id: model.id, name: model.name })),
      });
    }
    for (const ext of cachedExternalSources) {
      list.push(ext);
    }
    return list;
  }

  function status(): LocalGatewayStatus {
    const running = server !== null;
    return {
      enabled: !options.legacyDisabled && config.enabled,
      running,
      url: running ? `http://127.0.0.1:${port}` : null,
      token: config.token,
      port: config.port,
      sources: sources().map((source) => ({
        id: source.id,
        name: source.name,
        models: source.models.length,
        configured: true,
      })),
      requests,
      errors,
    };
  }

  async function setEnabled(enabled: boolean): Promise<LocalGatewayStatus> {
    if (options.legacyDisabled) return status();
    config = { ...config, enabled };
    saveConfig(configPath, config);
    if (enabled) await start();
    else await stop();
    return status();
  }

  async function setPort(next: number): Promise<LocalGatewayStatus> {
    config = { ...config, port: next };
    saveConfig(configPath, config);
    if (server) {
      await stop();
      await start();
    }
    return status();
  }

  async function rotateToken(): Promise<LocalGatewayStatus> {
    config = { ...config, token: newToken() };
    saveConfig(configPath, config);
    return status();
  }

  function getAgents(): readonly ConnectedAgentInfo[] {
    if (options.legacyDisabled) return [];
    return detectConnectedAgents();
  }

  function wireAgent(input: WireAgentInput): readonly ConnectedAgentInfo[] {
    if (options.legacyDisabled) return [];
    const currentSources = sources();
    const allModels: AgentModelSummary[] = [];
    const seen = new Set<string>();
    for (const s of currentSources) {
      for (const m of s.models) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          allModels.push(m);
        }
      }
    }
    return doWireAgent(input.agentId, input.enabled, config.port, config.token, allModels);
  }

  async function getExternalProviders(): Promise<readonly ExternalProviderInfo[]> {
    if (options.legacyDisabled) return [];
    const providers = await externalManager.detect(fetchImpl);
    cachedExternalSources = await externalManager.getGatewaySources(fetchImpl);
    return providers;
  }

  async function setExternalProvider(input: SetExternalProviderInput): Promise<readonly ExternalProviderInfo[]> {
    if (options.legacyDisabled) return [];
    const res = await externalManager.setEnabled(input.providerId, input.enabled, input.apiKey);
    cachedExternalSources = await externalManager.getGatewaySources(fetchImpl);
    return res;
  }

  async function start(): Promise<void> {
    if (server) return;
    try {
      cachedExternalSources = await externalManager.getGatewaySources(fetchImpl);
    } catch {
      // Ignore
    }
    await new Promise<void>((resolve, reject) => {
      const candidate = createServer((request, response) => {
        handleRequest(request, response).catch((error) => {
          errors += 1;
          logger.warn("A gateway request failed with an unhandled error.", {
            error: error instanceof Error ? error.message : String(error),
          });
          if (!response.headersSent) {
            writeJson(response, 500, { error: { message: "Internal gateway error." } });
          } else {
            response.end();
          }
        });
      });
      candidate.once("error", (error) => {
        server = null;
        reject(error);
      });
      candidate.listen(config.port, "127.0.0.1", () => {
        server = candidate;
        const address = candidate.address();
        port = typeof address === "object" && address ? address.port : config.port;
        logger.info(`Local gateway listening on 127.0.0.1:${port}`);
        resolve();
      });
    });
  }

  async function stop(): Promise<void> {
    const running = server;
    if (!running) return;
    server = null;
    port = 0;
    await new Promise<void>((resolve) => running.close(() => resolve()));
    logger.info("Local gateway stopped.");
  }

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    requests += 1;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "authorization, content-type, anthropic-version, x-api-key");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const authHeader = request.headers.authorization ?? "";
    const xApiKey = request.headers["x-api-key"] ?? "";
    const bearer =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : typeof xApiKey === "string"
          ? xApiKey.trim()
          : "";

    if (!bearer || bearer !== config.token) {
      errors += 1;
      writeJson(response, 401, {
        error: { message: "Unauthorized. Provide Bearer token matching Dengerbot gateway." },
      });
      return;
    }

    const path = (request.url ?? "/").split("?")[0];
    if (request.method === "GET" && (path === "/v1/models" || path === "/models")) {
      await handleModels(response);
      return;
    }

    if (request.method === "POST" && (path === "/v1/chat/completions" || path === "/chat/completions")) {
      await handleChatCompletions(request, response);
      return;
    }

    // Health check endpoint
    if (request.method === "GET" && (path === "/" || path === "/health" || path === "/v1/health")) {
      writeJson(response, 200, { status: "ok", service: "Dengerbot Local Gateway", running: true });
      return;
    }

    writeJson(response, 404, { error: { message: `Not found: ${request.method} ${path}` } });
  }

  async function handleModels(response: ServerResponse): Promise<void> {
    const list: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
    const seen = new Set<string>();

    for (const source of sources()) {
      for (const model of source.models) {
        // 1. Canonical model ID (e.g. "claude-3-7-sonnet", "GLM-5.3", "qoder/fast")
        if (!seen.has(model.id)) {
          seen.add(model.id);
          list.push({ id: model.id, object: "model", created: 0, owned_by: source.name });
        }

        // 2. Provider-prefixed model ID for explicit routing (e.g. "qoder/claude-3-7-sonnet", "zcode/GLM-5.3")
        if (!model.id.toLowerCase().startsWith(`${source.id.toLowerCase()}/`)) {
          const prefixedId = `${source.id}/${model.id}`;
          if (!seen.has(prefixedId)) {
            seen.add(prefixedId);
            list.push({ id: prefixedId, object: "model", created: 0, owned_by: source.name });
          }

          // Alias: if provider is "trae-cn", also expose "trae/<model>"
          if (source.id === "trae-cn") {
            const aliasId = `trae/${model.id}`;
            if (!seen.has(aliasId)) {
              seen.add(aliasId);
              list.push({ id: aliasId, object: "model", created: 0, owned_by: source.name });
            }
          }
        }
      }
    }

    writeJson(response, 200, { object: "list", data: list });
  }

  async function handleChatCompletions(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      writeJson(response, 400, { error: { message: "Invalid JSON body." } });
      return;
    }

    const requestedModel = isDynamicRecord(parsed) && typeof parsed.model === "string" ? parsed.model : "";

    // Ensure external sources are populated
    if (cachedExternalSources.length === 0) {
      try {
        cachedExternalSources = await externalManager.getGatewaySources(fetchImpl);
      } catch {
        // Ignore
      }
    }

    const currentSources = sources();
    const resolution = resolveModelSource(requestedModel, currentSources);

    if (!resolution) {
      writeJson(response, 404, {
        error: { message: `No configured endpoint serves ${requestedModel || "the model"}.` },
      });
      return;
    }

    const { source, upstreamModel } = resolution;

    // If the model was transformed/stripped for upstream, update JSON payload
    let outgoingBody = body;
    if (upstreamModel !== requestedModel && isDynamicRecord(parsed)) {
      outgoingBody = JSON.stringify({ ...parsed, model: upstreamModel });
    }

    const targetUrl = resolveTargetChatUrl(source.baseUrl);

    // Abort controller linked to client disconnect and timeout
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), UPSTREAM_TIMEOUT_MS);
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const onClientClose = () => {
      if (!response.writableEnded) {
        abortController.abort();
        if (activeReader) {
          void activeReader.cancel("client disconnected").catch(() => {});
        }
      }
    };
    response.once("close", onClientClose);

    if (response.destroyed || response.writableEnded) {
      abortController.abort();
      clearTimeout(timeout);
      response.off("close", onClientClose);
      return;
    }

    try {
      let upstream: Response;
      try {
        upstream = await fetchImpl(targetUrl, {
          method: "POST",
          headers: buildUpstreamHeaders(source),
          body: outgoingBody,
          signal: abortController.signal,
        });
      } catch (fetchError: unknown) {
        errors += 1;
        const isAbort = abortController.signal.aborted;
        const status = isAbort ? 504 : 502;
        const msg = isAbort
          ? "Gateway upstream request timed out."
          : `Failed to connect to upstream provider (${source.name}): ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`;
        logger.warn(`Gateway upstream request failed (${status}): ${msg}`);
        writeJson(response, status, { error: { message: msg, type: "upstream_error" } });
        return;
      }

      const contentType = upstream.headers.get("content-type") ?? "";

      // Check for upstream HTTP error responses (4xx, 5xx)
      if (upstream.status >= 400) {
        errors += 1;
        const errorText = await upstream.text().catch(() => "");
        let parsedError: unknown;
        try {
          parsedError = JSON.parse(errorText);
        } catch {
          parsedError = null;
        }

        if (!response.writableEnded && !response.destroyed) {
          response.writeHead(upstream.status, { "content-type": "application/json" });
          if (parsedError && isDynamicRecord(parsedError) && parsedError.error) {
            response.end(JSON.stringify(parsedError));
          } else {
            response.end(
              JSON.stringify({
                error: {
                  message: errorText || `Upstream provider returned status ${upstream.status}`,
                  type: "upstream_error",
                  code: upstream.status,
                },
              }),
            );
          }
        }
        return;
      }

      // Check for ZCode deceptive HTTP 200 refusal envelope (e.g. code 1000)
      if (source.id === "zcode" && contentType.includes("application/json")) {
        try {
          const text = await upstream.text();
          const json = JSON.parse(text);
          const refusal = checkZCodeRefusalEnvelope(upstream.status, contentType, json);
          if (refusal.isRefusal) {
            errors += 1;
            logger.warn(
              `ZCode refusal envelope intercepted (${refusal.code}): ${refusal.message} -> HTTP ${refusal.status}`,
            );
            writeJson(response, refusal.status, {
              error: {
                message: refusal.message,
                type: "upstream_error",
                code: refusal.code,
              },
            });
            return;
          }

          // Valid non-streamed JSON response from ZCode
          if (!response.writableEnded && !response.destroyed) {
            response.writeHead(200, {
              "content-type": "application/json",
              ...(upstream.headers.get("cache-control")
                ? { "cache-control": upstream.headers.get("cache-control") ?? "" }
                : {}),
            });
            response.end(text);
          }
          return;
        } catch {
          // Fallback to streaming if text parsing fails
        }
      }

      if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
        if (upstream.body) {
          await upstream.body.cancel().catch(() => {});
        }
        return;
      }

      // Standard SSE streaming or direct chunk pass-through
      response.writeHead(upstream.status, {
        "content-type": contentType || "application/json",
        ...(upstream.headers.get("cache-control")
          ? { "cache-control": upstream.headers.get("cache-control") ?? "" }
          : {}),
      });

      if (!upstream.body) {
        if (!response.writableEnded && !response.destroyed) {
          response.end();
        }
        return;
      }

      const reader = upstream.body.getReader();
      activeReader = reader;
      try {
        for (;;) {
          if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
            await reader.cancel("client disconnected").catch(() => {});
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          if (abortController.signal.aborted || response.destroyed || response.writableEnded) {
            await reader.cancel("client disconnected").catch(() => {});
            break;
          }

          response.write(Buffer.from(value));
        }
      } catch (streamError) {
        if (!abortController.signal.aborted) {
          logger.warn("Upstream body streaming interrupted:", streamError);
        }
      } finally {
        activeReader = null;
        reader.releaseLock();
      }

      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    } finally {
      clearTimeout(timeout);
      response.off("close", onClientClose);
    }
  }

  if (config.enabled && !options.legacyDisabled) {
    void start().catch((error: unknown) => {
      logger.warn("A gateway start on boot failed.", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  return {
    status,
    setEnabled,
    setPort,
    rotateToken,
    getAgents,
    wireAgent,
    getExternalProviders,
    setExternalProvider,
    stop,
  };
}

function newToken(): string {
  return randomBytes(24).toString("hex");
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function readConfig(path: string): GatewayConfig {
  try {
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (
        isDynamicRecord(parsed) &&
        typeof parsed.enabled === "boolean" &&
        typeof parsed.port === "number" &&
        typeof parsed.token === "string"
      ) {
        return { enabled: parsed.enabled, port: parsed.port, token: parsed.token };
      }
    }
  } catch {
    // Default config on read error
  }
  return { enabled: false, port: DEFAULT_PORT, token: newToken() };
}

function saveConfig(path: string, config: GatewayConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
