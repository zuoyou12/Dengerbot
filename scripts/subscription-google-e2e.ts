// Native protocol fixtures; no vendor account or network request.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { toGoogleRequest, wrapGoogleResponse } from "../src/main/subscription-google";
import { pluginRecord as object } from "../src/main/subscription-json";

const request = toGoogleRequest(
  {
    messages: [
      { role: "system", content: "Be concise." },
      { role: "developer", content: "Use Chinese." },
      {
        role: "user",
        content: [
          { type: "text", text: "Read this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_a", type: "function", function: { name: "read", arguments: '{"path":"a"}' } }],
      },
      { role: "tool", tool_call_id: "call_a", content: "file contents" },
    ],
    tools: [
      {
        type: "function",
        function: { name: "read", parameters: { type: "object", properties: { path: { type: "string" } } } },
      },
    ],
    tool_choice: { type: "function", function: { name: "read" } },
    max_completion_tokens: 512,
    temperature: 0.2,
    top_p: 0.9,
    reasoning_effort: "medium",
    stop: ["STOP"],
    response_format: { type: "json_object" },
  },
  "gemini-3-flash",
);
const encoded = JSON.stringify(request);
assert(encoded.includes('"systemInstruction"'));
assert(encoded.includes("Be concise.") && encoded.includes("Use Chinese."));
assert(encoded.includes('"inlineData":{"mimeType":"image/png","data":"AQID"}'));
assert(encoded.includes('"functionResponse":{"id":"call_a","name":"read"'));
assert(encoded.includes('"parametersJsonSchema"'));
assert(encoded.includes('"allowedFunctionNames":["read"]'));
assert.equal(object(request.generationConfig).maxOutputTokens, 512);
assert.equal(object(object(request.generationConfig).thinkingConfig).thinkingLevel, "medium");
assert.equal(request.model, undefined);
assert.equal(request.stream, undefined);
assert.throws(() =>
  toGoogleRequest(
    { messages: [{ role: "assistant", tool_calls: [{ function: { name: "x", arguments: "bad-json" } }] }] },
    "gemini-3-flash",
  ),
);
const checks = ["system/history/images/tool calls/results, schemas and sampling parameters"];
const payload = {
  candidates: [
    {
      index: 0,
      content: {
        parts: [
          { text: "思考", thought: true },
          { text: "你好" },
          { functionCall: { id: "fc1", name: "read", args: { path: "a" } }, thoughtSignature: "fixture-signature" },
        ],
      },
      finishReason: "STOP",
    },
  ],
  usageMetadata: {
    promptTokenCount: 100,
    candidatesTokenCount: 10,
    thoughtsTokenCount: 5,
    totalTokenCount: 115,
    cachedContentTokenCount: 20,
  },
};
const nonstream = await wrapGoogleResponse(Response.json({ response: payload }), "fixture-model").json();
assert.equal(nonstream.choices[0].message.content, "你好");
assert.equal(nonstream.choices[0].message.reasoning_content, "思考");
assert.equal(nonstream.choices[0].message.tool_calls[0].function.arguments, '{"path":"a"}');
assert.equal(nonstream.choices[0].finish_reason, "tool_calls");
assert.equal(nonstream.usage.completion_tokens, 15);
assert.equal(nonstream.usage.prompt_tokens_details.cached_tokens, 20);
checks.push("nonstream candidates, thoughts, function arguments/signatures and complete usage");
const events = [
  { candidates: [{ content: { parts: [{ text: "思", thought: true }, { text: "你" }] } }] },
  { candidates: [{ content: { parts: [{ functionCall: { name: "read", args: { path: "a" } } }] } }] },
  {
    candidates: [
      { content: { parts: [{ functionCall: { name: "read", args: { path: "b" } } }] }, finishReason: "STOP" },
    ],
  },
  { usageMetadata: payload.usageMetadata },
];
const wire = new TextEncoder().encode(events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join(""));
let offset = 0;
const raw = new Response(
  new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= wire.length) controller.close();
      else controller.enqueue(wire.slice(offset, ++offset));
    },
  }),
  { headers: { "content-type": "text/event-stream" } },
);
const converted = await wrapGoogleResponse(raw, "fixture-model").text();
assert(converted.includes('"reasoning_content":"思"'));
assert(converted.includes('"content":"你"'));
assert(converted.includes('"index":0,"id":"call_'));
assert(converted.includes('"index":1,"id":"call_'));
assert(converted.includes('"finish_reason":"tool_calls"'));
assert(converted.includes('"completion_tokens":15'));
assert(converted.endsWith("data: [DONE]\n\n"));
checks.push("UTF-8/CRLF SSE fragmented at every byte; repeated function names retain separate call indexes");
let cancelled = false;
const upstream = new Response(
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"first"}]}}]}\n\n'),
      );
    },
    cancel() {
      cancelled = true;
    },
  }),
  { headers: { "content-type": "text/event-stream" } },
);
const reader = wrapGoogleResponse(upstream, "fixture-model").body?.getReader();
assert(reader);
await reader.read();
await reader.cancel();
assert(cancelled);
assert.equal(wrapGoogleResponse(new Response("denied", { status: 403 }), "fixture-model").status, 403);
checks.push("downstream cancellation cancels native stream; HTTP errors remain failures");
await assert.rejects(wrapGoogleResponse(Response.json({ error: { message: "fixture" } }), "fixture-model").text());
const blocked = await wrapGoogleResponse(
  Response.json({ promptFeedback: { blockReason: "SAFETY" } }),
  "fixture-model",
).json();
assert.equal(blocked.choices[0].finish_reason, "content_filter");
const limited = await wrapGoogleResponse(
  Response.json({ candidates: [{ content: { parts: [{ text: "partial" }] }, finishReason: "MAX_TOKENS" }] }),
  "fixture-model",
).json();
assert.equal(limited.choices[0].finish_reason, "length");
checks.push("native embedded errors fail; blocked prompts and token limits retain finish semantics");
const output = resolve(import.meta.dirname, "../.openbot-build/subscription-google-e2e");
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "report.json"), JSON.stringify({ ok: true, checks }, null, 2));
process.stdout.write(`${JSON.stringify({ ok: true, checks })}\n`);
