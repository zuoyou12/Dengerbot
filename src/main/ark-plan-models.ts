import { createHash, createHmac } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { ArkPlanDiscoveryCredentials, DetectedModel } from "@openbot/contracts/ipc";
import { PROVIDER_DETECTION_LIMITS } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { readLimitedBody } from "../backend/limited-body";

const HOST = "ark.cn-beijing.volcengineapi.com";
const REGION = "cn-beijing";
const BODY_LIMIT = 1024 * 1024;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const mac = (key: string | Buffer, text: string) => createHmac("sha256", key).update(text).digest();

export class ArkPlanModelFailure extends Schema.TaggedError<ArkPlanModelFailure>()("ArkPlanModelFailure", {
  message: Schema.String,
}) {}

/** Volcengine HMAC signing. The host and read-only action are fixed, never supplied by the renderer. */
export function arkPlanRequest(kind: "coding" | "agent", credentials: ArkPlanDiscoveryCredentials, now: Date) {
  const action = kind === "coding" ? "ListArkCodingPlanModel" : "ListArkAgentPlanModel";
  const query = `Action=${action}&Version=2024-01-01`;
  const body = kind === "agent" ? JSON.stringify({ Edition: credentials.edition ?? "personal" }) : "{}";
  const xDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = xDate.slice(0, 8);
  const bodyHash = hash(body);
  const signed = "content-type;host;x-content-sha256;x-date";
  const canonical = [
    "POST",
    "/",
    query,
    `content-type:application/json\nhost:${HOST}\nx-content-sha256:${bodyHash}\nx-date:${xDate}\n`,
    signed,
    bodyHash,
  ].join("\n");
  const scope = `${date}/${REGION}/ark/request`;
  let key = mac(credentials.secretAccessKey, date);
  for (const part of [REGION, "ark", "request"]) key = mac(key, part);
  const signature = mac(key, ["HMAC-SHA256", xDate, scope, hash(canonical)].join("\n")).toString("hex");
  return {
    url: `https://${HOST}/?${query}`,
    body,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Date": xDate,
      "X-Content-Sha256": bodyHash,
      Authorization: `HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
  };
}

const Envelope = Schema.Struct({
  Result: Schema.Struct({ Datas: Schema.Array(Schema.Struct({ ModelID: Schema.String })) }),
});

/** No raw response text, credentials, signatures, or network causes enter public failures. */
export const probeArkPlanModels = Effect.fn("ArkPlanModels.probe")(function* (
  kind: "coding" | "agent",
  credentials: ArkPlanDiscoveryCredentials,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
) {
  const request = arkPlanRequest(kind, credentials, new Date());
  const failed = () => new ArkPlanModelFailure({ message: sourceText("error.provider.planModelsFailed") });
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetchImpl(request.url, {
              method: "POST",
              headers: request.headers,
              body: request.body,
              redirect: "manual",
              signal: controller.signal,
            }),
          catch: failed,
        });
        if (!response.ok) return yield* Effect.fail(failed());
        const raw = yield* readLimitedBody(response, BODY_LIMIT, failed);
        const decoded = yield* Effect.try({ try: (): unknown => JSON.parse(raw.toString("utf8")), catch: failed });
        const result = yield* Schema.decodeUnknownEffect(Envelope)(decoded).pipe(Effect.mapError(failed));
        const seen = new Set<string>();
        const models: DetectedModel[] = [];
        for (const row of result.Result.Datas) {
          const id = row.ModelID.trim();
          if (!id || id.length > INPUT_LIMITS.identifier || seen.has(id)) continue;
          seen.add(id);
          models.push({ id });
          if (models.length === PROVIDER_DETECTION_LIMITS.models) break;
        }
        return models;
      }).pipe(Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(failed()) })),
    (controller) => Effect.sync(() => controller.abort()),
  );
});
