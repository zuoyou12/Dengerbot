// Drives the real DSH ACP process against a private in-memory subscription transport.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { dshInstall } from "../src/backend/cli";
import { configureDshCustomProviders } from "../src/backend/provider-drivers";
import { SubscriptionModelBridge, type SubscriptionModelTransport } from "../src/main/subscription-model-bridge";

const output = resolve(import.meta.dirname, "../.openbot-build/subscription-dsh-e2e");
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(output, "fixture-"));
let requests = 0;
const protocolRequests = new Map<string, number>();
const fixtures = [
  {
    id: "fixture-chat-model",
    npm: "@ai-sdk/openai-compatible",
    suffix: "/chat/completions",
    reply: "Chat subscription fixture complete.",
  },
  {
    id: "fixture-anthropic-model",
    npm: "@ai-sdk/anthropic",
    suffix: "/messages",
    reply: "Anthropic subscription fixture complete.",
  },
  {
    id: "fixture-responses-model",
    npm: "@ai-sdk/openai",
    suffix: "/responses",
    reply: "Responses subscription fixture complete.",
  },
  {
    id: "fixture-google-model",
    npm: "@ai-sdk/google",
    suffix: "/models/fixture-google-model:streamGenerateContent",
    reply: "Google subscription fixture complete.",
  },
];
interface FixtureUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
}
interface FixtureTextPart {
  type: string;
  text: string;
  annotations: readonly never[];
}
interface FixtureMessage {
  id: string;
  type: string;
  role: string;
  content: readonly FixtureTextPart[];
  status?: string;
  model?: string;
  stop_reason?: null;
  stop_sequence?: null;
  usage?: FixtureUsage;
}
interface FixtureResponse {
  id: string;
  object: string;
  created_at: number;
  model: string;
  status: string;
  output: readonly FixtureMessage[];
  usage?: FixtureUsage;
}
interface FixtureStreamEvent {
  type: string;
  sequence_number?: number;
  message?: FixtureMessage;
  response?: FixtureResponse;
  index?: number;
  output_index?: number;
  content_index?: number;
  item_id?: string;
  item?: FixtureMessage;
  part?: FixtureTextPart;
  content_block?: { type: string; text: string };
  delta?: string | { type?: string; text?: string; stop_reason?: string; stop_sequence?: null };
  text?: string;
  usage?: FixtureUsage;
}
function sse(events: readonly FixtureStreamEvent[]): Response {
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}
const transport: SubscriptionModelTransport = {
  providerDescriptors: () => [
    {
      id: "workbuddy",
      name: "Fixture subscription",
      enabled: true,
      signedIn: true,
      accounts: [{ id: "fixture-account", label: "Fixture", models: fixtures.map((model) => model.id) }],
      models: fixtures.map((model) => ({ id: model.id, name: model.id, npm: model.npm })),
    },
  ],
  loadProvider: async () => ({ baseURL: "https://fixture.invalid/v1" }),
  fetchRequest: async (input) => {
    assert.equal(new URL(input.url).hostname, "fixture.invalid");
    requests++;
    const fixture = fixtures.find((model) => model.npm === input.npm);
    assert(fixture, "The SDK must select a supported native protocol.");
    assert(new URL(input.url).pathname.endsWith(fixture.suffix), `Unexpected native SDK URL: ${input.url}`);
    assert(input.body);
    const requestBody = JSON.parse(Buffer.from(input.body).toString("utf8"));
    assert(isDynamicRecord(requestBody));
    protocolRequests.set(fixture.npm, (protocolRequests.get(fixture.npm) ?? 0) + 1);
    if (input.npm === "@ai-sdk/google") {
      assert.equal(new URL(input.url).searchParams.get("alt"), "sse");
      assert(Array.isArray(requestBody.contents) && requestBody.contents.length > 0);
      assert.equal("messages" in requestBody, false);
      assert.equal("stream" in requestBody, false);
      const frame = {
        candidates: [{ content: { parts: [{ text: fixture.reply }], role: "model" }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 5, totalTokenCount: 7 },
      };
      return new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    assert.equal(requestBody.model, fixture.id);
    assert.equal(requestBody.stream, true);
    if (input.npm === "@ai-sdk/anthropic") {
      return sse([
        {
          type: "message_start",
          message: {
            id: "msg_fixture",
            type: "message",
            role: "assistant",
            content: [],
            model: fixture.id,
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 2, output_tokens: 0 },
          },
        },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: fixture.reply } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } },
        { type: "message_stop" },
      ]);
    }
    if (input.npm === "@ai-sdk/openai") {
      const item = { id: "msg_fixture", type: "message", role: "assistant", status: "in_progress", content: [] };
      const complete = {
        ...item,
        status: "completed",
        content: [{ type: "output_text", text: fixture.reply, annotations: [] }],
      };
      const response = {
        id: "resp_fixture",
        object: "response",
        created_at: 1,
        model: fixture.id,
        status: "in_progress",
        output: [],
      };
      return sse([
        { type: "response.created", sequence_number: 0, response },
        { type: "response.output_item.added", sequence_number: 1, output_index: 0, item },
        {
          type: "response.content_part.added",
          sequence_number: 2,
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        },
        {
          type: "response.output_text.delta",
          sequence_number: 3,
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: fixture.reply,
        },
        {
          type: "response.output_text.done",
          sequence_number: 4,
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          text: fixture.reply,
        },
        { type: "response.output_item.done", sequence_number: 5, output_index: 0, item: complete },
        {
          type: "response.completed",
          sequence_number: 6,
          response: {
            ...response,
            status: "completed",
            output: [complete],
            usage: {
              input_tokens: 2,
              output_tokens: 5,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ]);
    }
    const frame = {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: fixture.id,
      choices: [{ index: 0, delta: { role: "assistant", content: fixture.reply }, finish_reason: null }],
    };
    const end = { ...frame, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
    return new Response(`data: ${JSON.stringify(frame)}\n\ndata: ${JSON.stringify(end)}\n\ndata: [DONE]\n\n`, {
      headers: { "content-type": "text/event-stream" },
    });
  },
};
const bridge = new SubscriptionModelBridge(transport);
await bridge.start();
const env = configureDshCustomProviders(directory, bridge.configs());
const child = spawn("node", [dshInstall().bin, "--profile", "acp"], {
  env: { ...process.env, ...env, DSH_HOME: directory },
  windowsHide: true,
  stdio: "pipe",
  cwd: directory,
});
let sequence = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const updates: unknown[] = [];
let stderr = "";
child.stderr.on("data", (chunk: Buffer) => {
  stderr = (stderr + chunk.toString()).slice(-16000);
});
createInterface({ input: child.stdout }).on("line", (line) => {
  const parsed = JSON.parse(line);
  if (!isDynamicRecord(parsed)) return;
  if (typeof parsed.id === "number" && pending.has(parsed.id)) {
    const call = pending.get(parsed.id);
    pending.delete(parsed.id);
    if (parsed.error) call?.reject(new Error(JSON.stringify(parsed.error)));
    else call?.resolve(parsed.result);
  } else if (parsed.method === "session/update") updates.push(parsed.params);
});
child.once("exit", () => {
  for (const call of pending.values()) call.reject(new Error(`DSH exited: ${stderr}`));
});
type AcpFixtureParams =
  | {
      protocolVersion: number;
      clientCapabilities: Record<string, never>;
      clientInfo: { name: string; version: string };
    }
  | { cwd: string; mcpServers: readonly [] }
  | { sessionId: string; configId: string; value: string }
  | { sessionId: string; prompt: readonly { type: string; text: string }[] };
async function rpc(method: string, params: AcpFixtureParams) {
  const id = ++sequence;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
const deadline = setTimeout(() => child.kill(), 90000);
try {
  await rpc("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "Dengerbot fixture", version: "1" },
  });
  const results: { model: string; npm: string; result: unknown }[] = [];
  for (const fixture of fixtures) {
    const setup = await rpc("session/new", { cwd: directory, mcpServers: [] });
    assert(isDynamicRecord(setup) && typeof setup.sessionId === "string");
    await writeFile(join(output, `${fixture.id}-session.json`), JSON.stringify(setup, null, 2));
    const choices: string[] = [];
    function collect(value: unknown): void {
      if (Array.isArray(value)) {
        for (const item of value) collect(item);
        return;
      }
      if (!isDynamicRecord(value)) return;
      for (const [key, item] of Object.entries(value)) {
        if (["id", "modelId", "value"].includes(key) && typeof item === "string" && item.includes(fixture.id))
          choices.push(item);
        collect(item);
      }
    }
    collect(setup);
    assert(choices[0], `Real DSH must discover ${fixture.id}.`);
    await rpc("session/set_config_option", { sessionId: setup.sessionId, configId: "model", value: choices[0] });
    const updateStart = updates.length;
    const before = protocolRequests.get(fixture.npm) ?? 0;
    const result = await rpc("session/prompt", {
      sessionId: setup.sessionId,
      prompt: [{ type: "text", text: "Reply briefly." }],
    });
    assert.equal(protocolRequests.get(fixture.npm), before + 1, `DSH must call ${fixture.npm} exactly once.`);
    assert(
      JSON.stringify(updates.slice(updateStart)).includes(fixture.reply),
      `Real ACP updates must contain ${fixture.reply}`,
    );
    results.push({ model: fixture.id, npm: fixture.npm, result });
  }
  await writeFile(
    join(output, "report.json"),
    JSON.stringify({ ok: true, requests, protocols: Object.fromEntries(protocolRequests), results }, null, 2),
  );
  process.stdout.write("Real DSH subscription model discovery and Chat/Anthropic/Responses/Google inference passed.\n");
} finally {
  clearTimeout(deadline);
  child.kill();
  await bridge.stop();
  assert(directory.startsWith(output));
  await rm(directory, { recursive: true, force: true });
}
