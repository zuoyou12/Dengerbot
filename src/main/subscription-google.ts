// Native shapes follow Magpie internal/gateway/{gemini,codeassist}.go (MIT, yetone).
import { randomUUID } from "node:crypto";
import { sourceText } from "@openbot/i18n/source";
import { pluginRecord as object, type PluginJsonObject, type PluginJsonValue } from "./subscription-json";

const array = (value: PluginJsonValue | undefined): PluginJsonValue[] => (Array.isArray(value) ? value : []);
const string = (value: PluginJsonValue | undefined): string => (typeof value === "string" ? value : "");
const numeric = (value: PluginJsonValue | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
function jsonArguments(value: PluginJsonValue | undefined): PluginJsonObject {
  if (typeof value !== "string") return object(value);
  try {
    return object(JSON.parse(value));
  } catch {
    throw new Error(sourceText("error.app.subscription.googleArgumentsInvalid"));
  }
}
function parts(content: PluginJsonValue | undefined): PluginJsonObject[] {
  if (typeof content === "string") return [{ text: content }];
  return array(content).flatMap((value): PluginJsonObject[] => {
    const part = object(value);
    if (part.type === "text" || part.type === "input_text") return [{ text: string(part.text) }];
    if (part.type === "image_url" || part.type === "input_image") {
      const url = typeof part.image_url === "string" ? part.image_url : string(object(part.image_url).url);
      const inline = /^data:([^;,]+);base64,([\s\S]+)$/u.exec(url);
      if (inline) return [{ inlineData: { mimeType: inline[1] ?? "image/png", data: inline[2] ?? "" } }];
      if (url) return [{ fileData: { fileUri: url, mimeType: "image/jpeg" } }];
    }
    return [];
  });
}

/** Converts OpenAI Chat history into Google's native GenerateContent request. */
export function toGoogleRequest(body: PluginJsonObject, model: string): PluginJsonObject {
  const contents: PluginJsonObject[] = [];
  const system: PluginJsonObject[] = [];
  const names = new Map<string, string>();
  for (const item of array(body.messages)) {
    const message = object(item);
    if (message.role === "system" || message.role === "developer") {
      system.push(...parts(message.content));
      continue;
    }
    const role = message.role === "assistant" ? "model" : "user";
    const converted = parts(message.content);
    for (const value of array(message.tool_calls)) {
      const call = object(value);
      const fn = object(call.function);
      const id = string(call.id);
      const name = string(fn.name);
      names.set(id, name);
      const signature =
        string(object(object(call.extra_content).google).thought_signature) || string(call.thoughtSignature);
      converted.push({
        functionCall: { id, name, args: jsonArguments(fn.arguments) },
        thoughtSignature: signature || "skip_thought_signature_validator",
      });
    }
    if (message.role === "tool") {
      converted.length = 0;
      const id = string(message.tool_call_id);
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? null);
      converted.push({
        functionResponse: { id, name: names.get(id) || string(message.name) || "tool", response: { output: content } },
      });
      converted.push(...parts(message.content).filter((part) => part.inlineData || part.fileData));
    }
    if (!converted.length) continue;
    const previous = contents.at(-1);
    if (previous?.role === role && Array.isArray(previous.parts)) previous.parts.push(...converted);
    else contents.push({ role, parts: converted });
  }
  const request: PluginJsonObject = { contents };
  if (system.length) request.systemInstruction = { role: "user", parts: system };
  const declarations = array(body.tools)
    .map(object)
    .filter((tool) => tool.type === "function")
    .map((tool) => {
      const fn = object(tool.function);
      return {
        name: string(fn.name),
        description: string(fn.description),
        parametersJsonSchema: fn.parameters ?? { type: "object", properties: {} },
      };
    });
  if (declarations.length && body.tool_choice !== "none") {
    request.tools = [{ functionDeclarations: declarations }];
    const choice = object(body.tool_choice);
    const named = string(object(choice.function).name);
    request.toolConfig = {
      functionCallingConfig: {
        mode: body.tool_choice === "required" || named ? "ANY" : "AUTO",
        ...(named ? { allowedFunctionNames: [named] } : {}),
      },
    };
  }
  const generation: PluginJsonObject = {};
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (typeof maxTokens === "number") generation.maxOutputTokens = maxTokens;
  if (typeof body.temperature === "number") generation.temperature = body.temperature;
  if (typeof body.top_p === "number") generation.topP = body.top_p;
  if (typeof body.seed === "number") generation.seed = body.seed;
  if (typeof body.n === "number") generation.candidateCount = body.n;
  if (typeof body.stop === "string") generation.stopSequences = [body.stop];
  else if (Array.isArray(body.stop)) generation.stopSequences = body.stop;
  const format = object(body.response_format);
  if (format.type === "json_object" || format.type === "json_schema") {
    generation.responseMimeType = "application/json";
    const schema = object(format.json_schema).schema;
    if (schema) generation.responseJsonSchema = schema;
  }
  const effort = string(body.reasoning_effort);
  if (effort) {
    if (/gemini-[3-9]/iu.test(model))
      generation.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: effort === "none" || effort === "minimal" ? "low" : effort === "max" ? "high" : effort,
      };
    else
      generation.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget:
          effort === "none" ? 0 : effort === "low" || effort === "minimal" ? 1024 : effort === "medium" ? 8192 : -1,
      };
  }
  if (Object.keys(generation).length) request.generationConfig = generation;
  return request;
}

function nativeResponse(value: unknown): PluginJsonObject {
  const outer = object(value);
  return outer.response ? object(outer.response) : outer;
}
function usage(value: PluginJsonObject): PluginJsonObject | undefined {
  if (!value.usageMetadata) return undefined;
  const metadata = object(value.usageMetadata);
  const prompt = numeric(metadata.promptTokenCount);
  const thoughts = numeric(metadata.thoughtsTokenCount);
  const output = numeric(metadata.candidatesTokenCount) + thoughts;
  return {
    prompt_tokens: prompt,
    completion_tokens: output,
    total_tokens: numeric(metadata.totalTokenCount) || prompt + output,
    prompt_tokens_details: { cached_tokens: numeric(metadata.cachedContentTokenCount) },
    completion_tokens_details: { reasoning_tokens: thoughts },
  };
}
function finish(
  reason: PluginJsonValue | undefined,
  tools: boolean,
): "length" | "content_filter" | "tool_calls" | "stop" {
  if (reason === "MAX_TOKENS") return "length";
  if (reason === "SAFETY" || reason === "RECITATION" || reason === "BLOCKLIST" || reason === "PROHIBITED_CONTENT")
    return "content_filter";
  return tools ? "tool_calls" : "stop";
}
function parsePayload(text: string): PluginJsonObject {
  return nativeResponse(JSON.parse(text));
}

/** Streaming conversion keeps the upstream reader owned until the downstream consumes or cancels it. */
export function wrapGoogleResponse(response: Response, model: string): Response {
  if (!response.ok || !response.body) return response;
  const streaming = response.headers.get("content-type")?.includes("text/event-stream") === true;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  let pending = "";
  let done = false;
  const announced = new Set<number>();
  const toolIndexes = new Map<number, Map<string, number>>();
  const finished = new Set<number>();
  const encode = (value: PluginJsonObject): Uint8Array => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
  const chunk = (choices: PluginJsonValue[], extra: PluginJsonObject = {}): PluginJsonObject => ({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices,
    ...extra,
  });
  function converted(value: PluginJsonObject): PluginJsonObject[] {
    if (value.error) throw new Error(sourceText("error.app.subscription.googleStreamFailed"));
    const chunks: PluginJsonObject[] = [];
    for (const [fallbackIndex, raw] of array(value.candidates).entries()) {
      const candidate = object(raw);
      const index = typeof candidate.index === "number" ? candidate.index : fallbackIndex;
      const calls = toolIndexes.get(index) ?? new Map<string, number>();
      toolIndexes.set(index, calls);
      if (!announced.has(index)) {
        announced.add(index);
        chunks.push(chunk([{ index, delta: { role: "assistant", content: "" }, finish_reason: null }]));
      }
      for (const [partIndex, rawPart] of array(object(candidate.content).parts).entries()) {
        const part = object(rawPart);
        const delta: PluginJsonObject = {};
        if (typeof part.text === "string") delta[part.thought === true ? "reasoning_content" : "content"] = part.text;
        if (part.functionCall) {
          const call = object(part.functionCall);
          const key = string(call.id) || `${calls.size}:${partIndex}:${string(call.name)}`;
          if (!calls.has(key)) {
            const toolIndex = calls.size;
            calls.set(key, toolIndex);
            delta.tool_calls = [
              {
                index: toolIndex,
                id: string(call.id) || `call_${randomUUID()}`,
                type: "function",
                function: { name: string(call.name), arguments: JSON.stringify(call.args ?? {}) },
                ...(part.thoughtSignature
                  ? { extra_content: { google: { thought_signature: part.thoughtSignature } } }
                  : {}),
              },
            ];
          }
        }
        if (Object.keys(delta).length) chunks.push(chunk([{ index, delta, finish_reason: null }]));
      }
      if (candidate.finishReason && !finished.has(index)) {
        finished.add(index);
        chunks.push(chunk([{ index, delta: {}, finish_reason: finish(candidate.finishReason, calls.size > 0) }]));
      }
    }
    const totals = usage(value);
    if (totals) chunks.push(chunk([], { usage: totals }));
    if (object(value.promptFeedback).blockReason && array(value.candidates).length === 0) {
      chunks.push(chunk([{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: "content_filter" }]));
    }
    return chunks;
  }
  const output = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!streaming) {
          let result = "";
          let bytes = 0;
          while (true) {
            const next = await reader.read();
            if (done) return;
            if (next.done) break;
            bytes += next.value.length;
            if (bytes > 16 * 1024 * 1024) throw new Error(sourceText("error.app.subscription.googleResponseTooLarge"));
            result += decoder.decode(next.value, { stream: true });
          }
          result += decoder.decode();
          const value = parsePayload(result);
          if (value.error) throw new Error(sourceText("error.app.subscription.googleResponseFailed"));
          const choices = array(value.candidates).map((raw, index) => {
            const candidate = object(raw);
            const message: PluginJsonObject = { role: "assistant", content: "" };
            const tools: PluginJsonValue[] = [];
            let thought = "";
            for (const rawPart of array(object(candidate.content).parts)) {
              const part = object(rawPart);
              if (typeof part.text === "string") {
                if (part.thought) thought += part.text;
                else message.content = string(message.content) + part.text;
              }
              if (part.functionCall) {
                const call = object(part.functionCall);
                tools.push({
                  id: string(call.id) || `call_${randomUUID()}`,
                  type: "function",
                  function: { name: string(call.name), arguments: JSON.stringify(call.args ?? {}) },
                  ...(part.thoughtSignature
                    ? { extra_content: { google: { thought_signature: part.thoughtSignature } } }
                    : {}),
                });
              }
            }
            if (thought) message.reasoning_content = thought;
            if (tools.length) {
              message.tool_calls = tools;
              if (!message.content) message.content = null;
            }
            return {
              index: numeric(candidate.index) || index,
              message,
              finish_reason: finish(candidate.finishReason, tools.length > 0),
            };
          });
          if (!choices.length && object(value.promptFeedback).blockReason) {
            choices.push({ index: 0, message: { role: "assistant", content: "" }, finish_reason: "content_filter" });
          }
          controller.enqueue(
            encoder.encode(
              JSON.stringify({ id, object: "chat.completion", created, model, choices, usage: usage(value) }),
            ),
          );
          done = true;
          controller.close();
          reader.releaseLock();
          return;
        }
        while (!done) {
          pending = pending.replace(/\r\n/gu, "\n");
          const end = pending.indexOf("\n\n");
          if (end >= 0) {
            const frame = pending.slice(0, end);
            pending = pending.slice(end + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            if (data && data !== "[DONE]")
              for (const value of converted(parsePayload(data))) controller.enqueue(encode(value));
            if (data) return;
          } else {
            const next = await reader.read();
            if (next.done) {
              pending += decoder.decode();
              if (pending.trim()) {
                pending += "\n\n";
                continue;
              }
              for (const index of announced)
                if (!finished.has(index))
                  controller.enqueue(
                    encode(
                      chunk([
                        { index, delta: {}, finish_reason: finish("STOP", (toolIndexes.get(index)?.size ?? 0) > 0) },
                      ]),
                    ),
                  );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              done = true;
              controller.close();
              reader.releaseLock();
              return;
            }
            pending += decoder.decode(next.value, { stream: true });
            if (pending.length > 4 * 1024 * 1024)
              throw new Error(sourceText("error.app.subscription.googleFrameTooLarge"));
          }
        }
      } catch (error) {
        done = true;
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      done = true;
      await reader.cancel(reason).catch(() => undefined);
      reader.releaseLock();
    },
  });
  return new Response(output, {
    status: response.status,
    headers: { "content-type": streaming ? "text/event-stream" : "application/json", "cache-control": "no-store" },
  });
}
