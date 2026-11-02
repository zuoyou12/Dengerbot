import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import type { CustomProviderConfig } from "../backend/custom-provider-types";
import { toGoogleRequest, wrapGoogleResponse } from "./subscription-google";
import { pluginRecord } from "./subscription-json";

export type SubscriptionModelApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";
export interface SubscriptionNativeModel {
  id: string;
  name: string;
  npm: string;
  url?: string;
  apiId?: string;
}
export interface SubscriptionNativeProvider {
  id: string;
  name: string;
  enabled: boolean;
  signedIn: boolean;
  baseURL?: string;
  accounts: readonly { id: string; label: string; models: readonly string[] }[];
  models: readonly SubscriptionNativeModel[];
}
export interface SubscriptionModelTransport {
  providerDescriptors(): readonly SubscriptionNativeProvider[];
  loadProvider(
    provider: string,
    account?: string,
  ): Promise<{ baseURL: string; apiKey?: string; headers?: Record<string, string> }>;
  fetchRequest(input: {
    provider: string;
    account?: string;
    model: string;
    npm: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: Uint8Array;
    signal?: AbortSignal;
  }): Promise<Response>;
}
interface Route {
  provider: string;
  account?: string;
  modelApi: SubscriptionModelApi;
  models: readonly SubscriptionNativeModel[];
  baseURL?: string;
}

/** Private runtime transport, not an endpoint configured for external applications. */
export class SubscriptionModelBridge {
  readonly #transport: SubscriptionModelTransport;
  readonly #token = randomBytes(32).toString("hex");
  #server: Server | null = null;
  #port = 0;
  readonly #routes = new Map<string, Route>();
  constructor(transport: SubscriptionModelTransport) {
    this.#transport = transport;
  }

  async start(): Promise<void> {
    if (this.#server) return;
    const server = createServer((request, response) => {
      void this.#handle(request, response).catch(() => {
        if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "Subscription request failed." } }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Subscription transport did not bind.");
    }
    this.#server = server;
    this.#port = address.port;
  }

  configs(): CustomProviderConfig[] {
    if (!this.#server) return [];
    const configs: CustomProviderConfig[] = [];
    this.#routes.clear();
    for (const provider of this.#transport.providerDescriptors()) {
      if (!provider.enabled || !provider.signedIn) continue;
      for (const account of provider.accounts) {
        for (const api of [
          "openai-completions",
          "openai-responses",
          "anthropic-messages",
          "google-generative-ai",
        ] as const) {
          const models = provider.models.filter(
            (model) => account.models.includes(model.id) && modelApi(provider.id, model) === api,
          );
          if (!models.length) continue;
          const suffix = createHash("sha256").update(`${provider.id}:${account.id}:${api}`).digest("hex").slice(0, 16);
          const id = `subscription-${suffix}`;
          this.#routes.set(id, {
            provider: provider.id,
            account: account.id,
            modelApi: api,
            models,
            baseURL: provider.baseURL,
          });
          configs.push({
            id,
            name: `${provider.name} · ${account.label}`,
            api: api === "google-generative-ai" ? "openai-completions" : api,
            baseUrl: `http://127.0.0.1:${this.#port}/invoke/${id}`,
            apiKey: this.#token,
            headers: [],
            models: models.map((model) => ({ id: model.id, name: model.name })),
          });
        }
      }
    }
    return configs;
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const requestedUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const keyHeader = request.headers["x-api-key"] ?? request.headers["x-goog-api-key"];
    const supplied =
      request.headers.authorization?.replace(/^Bearer /, "") ??
      (typeof keyHeader === "string" ? keyHeader : (requestedUrl.searchParams.get("key") ?? ""));
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(this.#token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || request.headers.origin) {
      response.writeHead(401);
      response.end();
      return;
    }
    const path = requestedUrl.pathname;
    const match = /^\/invoke\/(subscription-[a-f0-9]{16})(\/.*)?$/.exec(path);
    this.configs();
    const route = match ? this.#routes.get(match[1] ?? "") : undefined;
    if (!route || request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }
    const parts: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > 32 * 1024 * 1024) {
        response.writeHead(413);
        response.end();
        return;
      }
      parts.push(part);
    }
    const parsed = JSON.parse(Buffer.concat(parts).toString("utf8"));
    const data = isDynamicRecord(parsed) ? parsed : null;
    if (!data) {
      response.writeHead(400);
      response.end();
      return;
    }
    const bodyModel = "model" in data && typeof data.model === "string" ? data.model : null;
    const googleModel = /\/models\/([^/:]+):/.exec(path)?.[1];
    const requestedModel = bodyModel ?? (googleModel ? decodeURIComponent(googleModel) : null);
    const model = route.models.find((item) => item.id === requestedModel);
    if (!model) {
      response.writeHead(404);
      response.end();
      return;
    }
    const loaded = await this.#transport.loadProvider(route.provider, route.account);
    const base = loaded.baseURL || model.url || route.baseURL || defaultBase(model.npm);
    if (!base) throw new Error("Subscription plugin supplied no upstream endpoint.");
    let suffix = match?.[2] ?? "/chat/completions";
    if (suffix.startsWith("/v1/")) suffix = suffix.slice(3);
    if (route.modelApi === "google-generative-ai") {
      suffix = `/models/${encodeURIComponent(model.apiId || model.id)}:${data.stream === true ? "streamGenerateContent" : "generateContent"}`;
    }
    requestedUrl.searchParams.delete("key");
    if (route.modelApi === "google-generative-ai" && data.stream === true) requestedUrl.searchParams.set("alt", "sse");
    const query = requestedUrl.searchParams.toString();
    const upstream = `${base.replace(/\/$/, "")}${suffix}${query ? `?${query}` : ""}`;
    const signal = new AbortController();
    response.once("close", () => signal.abort());
    const headers: Record<string, string> = { "content-type": "application/json", ...loaded.headers };
    for (const name of ["accept", "anthropic-version", "anthropic-beta", "openai-beta", "x-goog-api-client"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const nativeResult = await this.#transport.fetchRequest({
      provider: route.provider,
      account: route.account,
      model: model.id,
      npm: model.npm,
      url: upstream,
      method: "POST",
      headers,
      body: Buffer.from(
        JSON.stringify(
          route.modelApi === "google-generative-ai"
            ? toGoogleRequest(pluginRecord(data), model.apiId || model.id)
            : bodyModel
              ? { ...data, model: model.apiId || model.id }
              : data,
        ),
      ),
      signal: signal.signal,
    });
    const result =
      route.modelApi === "google-generative-ai" ? wrapGoogleResponse(nativeResult, model.id) : nativeResult;
    response.writeHead(result.status, {
      "content-type": result.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    });
    if (result.body) await pipeline(Readable.from(responseChunks(result.body)), response);
    else response.end();
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = null;
    this.#port = 0;
    this.#routes.clear();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
}

/** The same AI SDK defaults used by Magpie's provider/plugins.go. */
function defaultBase(npm: string) {
  switch (npm) {
    case "@ai-sdk/anthropic":
      return "https://api.anthropic.com/v1";
    case "@ai-sdk/openai":
      return "https://api.openai.com/v1";
    case "@ai-sdk/google":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "@ai-sdk/github-copilot":
      return "https://api.githubcopilot.com";
    case "@ai-sdk/xai":
      return "https://api.x.ai/v1";
    case "@ai-sdk/mistral":
      return "https://api.mistral.ai/v1";
    case "@ai-sdk/groq":
      return "https://api.groq.com/openai/v1";
    case "@ai-sdk/deepseek":
      return "https://api.deepseek.com/v1";
    default:
      return "";
  }
}

async function* responseChunks(body: NonNullable<Response["body"]>) {
  const reader = body.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function modelApi(providerId: string, model: SubscriptionNativeModel): SubscriptionModelApi {
  const npm = model.npm;
  if (npm === "@ai-sdk/openai" || npm === "@ai-sdk/azure" || npm.includes("openai-responses"))
    return "openai-responses";
  if (npm.includes("anthropic")) return "anthropic-messages";
  if (npm.includes("google")) return "google-generative-ai";
  if (npm === "@ai-sdk/github-copilot" || providerId.startsWith("github-copilot")) {
    const id = model.apiId || model.id;
    const generation = /^gpt-(\d+)/.exec(id)?.[1];
    if (generation && Number(generation) >= 5 && !id.startsWith("gpt-5-mini")) return "openai-responses";
  }
  return "openai-completions";
}
