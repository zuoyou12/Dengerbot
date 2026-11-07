// Checks the paired DeepSeek visibility of the Team API. A paired phone on protocol 8 that
// advertises `paired-deepseek-v1` and whose WebRTC session id names a live paired session may see
// the DeepSeek assistant; every other peer never does, and the provider-secret routes stay refused
// even for it. The unit rows cover the visibility truth table, the frozen provider lists and the
// model id round trip; the server rows drive the real `TeamApiServer` on loopback with the real
// team store on a temporary file, fake agent, mailbox and browser stand-ins that record each call,
// and `isPairedMobileSession` injected as a set of paired session ids the test controls. Writes
// .openbot-build/paired-deepseek-e2e/report.json.
// Run: `bun run test:paired-deepseek` (the preload gives the server's import graph an `electron`).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { KEY_ONLY_PROVIDERS } from "@openbot/contracts/agent-providers";
import type { AgentProviderId, AgentSummary } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { TEAM_PAIRED_DEEPSEEK_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import type { TeamApiAgents, TeamApiBrowser, TeamApiMailbox } from "../src/main/team-api/dependencies";
import {
  hiddenProviderAgentIds,
  isPeerHiddenProvider,
  pairedDeepSeekVisible,
  peerDeepSeekModelId,
  restorePeerDeepSeekModelId,
} from "../src/main/team-api/provider-visibility";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/paired-deepseek-e2e");
const APP_VERSION = "0.43.0";
/** The header that names the WebRTC session a forwarded phone request rides (see `#pairedDeepSeek`). */
const WEBRTC_SESSION_HEADER = "x-openbot-webrtc-session";
const PAIRED_SESSION_ID = "webrtc-paired-1";
const DSH_AGENT = "agent-dsh";
const PLAIN_AGENT = "agent-ada";
const DSH_MODEL = "mimo-v2.6-flash";

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

/** A parsed JSON response body. `JSON.parse` gives only these values. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Reply {
  status: number;
  body: Json;
  text: string;
}

interface ReplySummary {
  status: number;
  body: Json;
}

interface CallOptions {
  token?: string;
  json?: unknown;
  protocol?: number | null;
  capabilities?: string[];
  headers?: Record<string, string>;
}

interface RecordedCall {
  method: string;
  args: readonly unknown[];
}

mkdirSync(OUT, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "openbot-paired-deepseek-"));
const checks: Check[] = [];
const calls: RecordedCall[] = [];
const logged: string[] = [];
// The live paired sessions, as the pairing registry would hold them. The rows add and remove the
// one session id, and the server reads it through `isPairedMobileSession`.
const pairedSessions = new Set<string>();

function check(name: string, passed: boolean, detail: unknown = null): void {
  checks.push({ name, passed, detail });
}

function record(method: string, ...args: unknown[]): void {
  calls.push({ method, args });
}

function callsOf(method: string): readonly (readonly unknown[])[] {
  return calls.filter((call) => call.method === method).map((call) => call.args);
}

function parseJson(text: string): Json {
  const value: Json = JSON.parse(text);
  return value;
}

function field(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let current = value;
  for (const key of path) {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) current = typeof key === "number" ? current[key] : undefined;
    else current = typeof key === "string" ? current[key] : undefined;
  }
  return current;
}

function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the paired DeepSeek E2E run.`);
  };
}

function agent(id: string, name: string, provider: AgentProviderId, model: string): AgentSummary {
  return {
    id,
    name,
    title: "",
    description: "",
    notifications: true,
    provider,
    model,
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, "workspaces", id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

// `agent-dsh` is the DeepSeek assistant whose visibility this run checks; `agent-ada` on Claude is
// the control that every client sees. The stored model is a plain id, which the frozen protocol 8
// model field accepts as it is; a stored DSH tuple would leave the agent unrepresentable for every
// peer, paired or not (the frozen field has no quotes), so the round trip stays a unit check.
const agents = [
  agent(DSH_AGENT, "DeepSeek", "deepseek", DSH_MODEL),
  agent(PLAIN_AGENT, "Ada", "claude", "claude-sonnet-4-5"),
];

const fakeAgents: TeamApiAgents = {
  on: () => undefined,
  off: () => undefined,
  preferredProvider: () => "claude",
  newAgentProvider: () => "claude",
  getStatus: unused("getStatus"),
  listAgents: () => agents,
  listQueue: unused("listQueue"),
  acknowledgeFailedTurn: unused("acknowledgeFailedTurn"),
  cancelQueuedMessage: unused("cancelQueuedMessage"),
  steerQueuedMessage: unused("steerQueuedMessage"),
  updateQueuedMessage: unused("updateQueuedMessage"),
  editQueuedMessage: unused("editQueuedMessage"),
  reorderQueue: unused("reorderQueue"),
  interrupt: unused("interrupt"),
  prepareImportedAttachments: unused("prepareImportedAttachments"),
  discardDraftAttachment: unused("discardDraftAttachment"),
  resolveSharedFile: unused("resolveSharedFile"),
  resolveWorkspaceFile: unused("resolveWorkspaceFile"),
  deleteAgent: unused("deleteAgent"),
  getRuntimeSnapshot: unused("getRuntimeSnapshot"),
  getUsage: unused("getUsage"),
  getAnalytics: unused("getAnalytics"),
  getHostAnalytics: unused("getHostAnalytics"),
  listModels: unused("listModels"),
  sidebarChatIds: unused("sidebarChatIds"),
  listConversationReads: unused("listConversationReads"),
  generateProfile: unused("generateProfile"),
  askSideQuestion: unused("askSideQuestion"),
  saveProfile: unused("saveProfile"),
  createAgent: unused("createAgent"),
  committedAgentDuplication: unused("committedAgentDuplication"),
  duplicateAgent: unused("duplicateAgent"),
  commitAgentDuplication: unused("commitAgentDuplication"),
  updateAgent: unused("updateAgent"),
  getMemorySelection: unused("getMemorySelection"),
  setMemoryInclusion: unused("setMemoryInclusion"),
  listMemories: unused("listMemories"),
  createMemory: unused("createMemory"),
  updateMemory: unused("updateMemory"),
  deleteMemory: unused("deleteMemory"),
  clearMemories: unused("clearMemories"),
  listRoutines: unused("listRoutines"),
  createRoutine: unused("createRoutine"),
  updateRoutine: unused("updateRoutine"),
  deleteRoutine: unused("deleteRoutine"),
  testRoutine: unused("testRoutine"),
  listRoutineRuns: unused("listRoutineRuns"),
  listChannelMemories: unused("listChannelMemories"),
  createChannelMemory: unused("createChannelMemory"),
  updateChannelMemory: unused("updateChannelMemory"),
  deleteChannelMemory: unused("deleteChannelMemory"),
  clearChannelMemories: unused("clearChannelMemories"),
  listChannelRoutines: unused("listChannelRoutines"),
  createChannelRoutine: unused("createChannelRoutine"),
  updateChannelRoutine: unused("updateChannelRoutine"),
  deleteChannelRoutine: unused("deleteChannelRoutine"),
  testChannelRoutine: unused("testChannelRoutine"),
  listChannelRoutineRuns: unused("listChannelRoutineRuns"),
  setAvatar: unused("setAvatar"),
  resolveAvatar: unused("resolveAvatar"),
  readConversation: unused("readConversation"),
  readConversationFor: unused("readConversationFor"),
  readConversationPageFor: unused("readConversationPageFor"),
  searchConversationMessages: unused("searchConversationMessages"),
  searchConversationFiles: unused("searchConversationFiles"),
  markConversationRead: unused("markConversationRead"),
  markConversationUnread: unused("markConversationUnread"),
  listWorkspaceDirectory: unused("listWorkspaceDirectory"),
  sendMessage: (input, sender, timezone) => {
    record("sendMessage", input, sender, timezone);
    return Effect.succeed({
      messageId: "message-1",
      deliveries: [{ id: "delivery-1", recipientAgentId: input.agentId, status: "queued" as const, position: 1 }],
    });
  },
  setMessageReaction: unused("setMessageReaction"),
  clearAgentContext: unused("clearAgentContext"),
  agentIdForRequest: () => undefined,
  respondToPrompt: unused("respondToPrompt"),
  respondToApproval: unused("respondToApproval"),
  respondToBrowserSecret: unused("respondToBrowserSecret"),
  respondToBrowserTakeover: unused("respondToBrowserTakeover"),
};

const mailbox: TeamApiMailbox = {
  resolveAttachment: () => Effect.succeed(null),
};

const browser: TeamApiBrowser = {
  listTabs: unused("listTabs"),
  getControlState: unused("getControlState"),
  open: unused("open"),
  activate: unused("activate"),
  navigate: unused("navigate"),
  reload: unused("reload"),
  stop: unused("stop"),
  takeUserControl: unused("takeUserControl"),
  releaseUserControl: unused("releaseUserControl"),
  releaseUserControlHeldBy: unused("releaseUserControlHeldBy"),
  close: unused("close"),
  capturePreview: unused("capturePreview"),
  setVisible: unused("setVisible"),
  getDisplayState: unused("getDisplayState"),
  loadUrl: unused("loadUrl"),
  isPrivate: unused("isPrivate"),
  startView: unused("startView"),
  dispatchViewInput: unused("dispatchViewInput"),
  copyViewSelection: unused("copyViewSelection"),
  importSignIn: unused("importSignIn"),
};

const store = new TeamStore(join(root, "team.json"));
let server: TeamApiServer | null = null;

try {
  const OWNER_PASSWORD = "owner-password-e2e";
  await runCauseEffect(store.initialize());
  await runCauseEffect(store.configure("E2E Server", "owner", OWNER_PASSWORD));
  const owner = await runCauseEffect(store.login("owner", OWNER_PASSWORD));

  server = new TeamApiServer({
    appVersion: APP_VERSION,
    store,
    agents: fakeAgents,
    mailbox,
    browser,
    isPairedMobileSession: (sessionId) => pairedSessions.has(sessionId),
    logger: createOpenBotLogger("paired-deepseek-e2e", (line) => logged.push(line)),
  });
  const port = await Effect.runPromise(server.start());
  const base = `http://127.0.0.1:${port}`;

  // The capabilities a protocol 8 remote client advertises. The paired client adds the
  // `paired-deepseek-v1` capability on top; neither client advertises `providers-v8`, which the
  // fork's phone does not hold.
  const memberCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY];
  const pairedCapabilities = [...memberCapabilities, TEAM_PAIRED_DEEPSEEK_CAPABILITY];

  function protocolHeaders(options: CallOptions): Record<string, string> {
    const protocol = options.protocol === undefined ? 8 : options.protocol;
    return {
      ...(protocol === null
        ? {}
        : {
            [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
            [TEAM_APP_VERSION_HEADER]: APP_VERSION,
            [TEAM_CAPABILITIES_HEADER]: (options.capabilities ?? memberCapabilities).join(","),
          }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    };
  }

  async function call(method: string, path: string, options: CallOptions = {}): Promise<Reply> {
    const headers = protocolHeaders(options);
    let body: string | null = null;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }
    const response = await fetch(`${base}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed: Json = null;
    if (response.headers.get("content-type")?.startsWith("application/json")) parsed = parseJson(text);
    return { status: response.status, body: parsed, text };
  }

  function errorIs(reply: Reply, status: number, message: string): boolean {
    return reply.status === status && field(reply.body, "error") === message;
  }

  function summary(reply: Reply): ReplySummary {
    return { status: reply.status, body: reply.body ?? reply.text.slice(0, 200) };
  }

  const notFound = sourceText("error.team.agentNotFound");
  const providersUnsupported = sourceText("error.team.providersUnsupported");
  const agentIds = (reply: Reply) => list(reply.body).map((item) => field(item, "id"));

  // ---- Check 1: the visibility truth table ----
  {
    const rows = [
      { pairing: "no paired session", protocol: 8, capabilities: [TEAM_PAIRED_DEEPSEEK_CAPABILITY], session: false },
      { pairing: "protocol 7", protocol: 7, capabilities: [TEAM_PAIRED_DEEPSEEK_CAPABILITY], session: true },
      { pairing: "capability missing", protocol: 8, capabilities: [], session: true },
      { pairing: "all three hold", protocol: 8, capabilities: [TEAM_PAIRED_DEEPSEEK_CAPABILITY], session: true },
    ].map((row) => ({ ...row, visible: pairedDeepSeekVisible(row.protocol, new Set(row.capabilities), row.session) }));
    check(
      "1 pairedDeepSeekVisible is false unless the paired session, protocol 8 and the capability all hold",
      rows.slice(0, 3).every((row) => !row.visible) && rows[3]?.visible === true,
      rows,
    );
  }

  // ---- Check 2: the hidden-provider test ----
  // This fork's agent provider list is `["deepseek", "claude", "codex", "acp"]`, so the frozen-list
  // gate applies to `acp`, which protocol 5 added; upstream's pi, muse, inception and openrouter are
  // not agent providers here and stay visible at every protocol. The key-only set holds deepseek
  // alone, so the paired exemption can only ever open deepseek.
  {
    const rows = [
      { provider: "deepseek", protocol: 7, paired: true },
      { provider: "deepseek", protocol: 8, paired: false },
      { provider: "deepseek", protocol: 8, paired: true },
      { provider: "acp", protocol: 4, paired: false },
      { provider: "acp", protocol: 4, paired: true },
      { provider: "acp", protocol: 5, paired: false },
      { provider: "claude", protocol: 1, paired: true },
      { provider: "codex", protocol: 3, paired: false },
      { provider: "openrouter", protocol: 7, paired: true },
      { provider: "openrouter", protocol: 8, paired: false },
    ].map((row) => ({ ...row, hidden: isPeerHiddenProvider(row.provider, row.protocol, row.paired) }));
    check(
      "2 isPeerHiddenProvider opens only deepseek on a paired protocol 8 peer, never a frozen-list provider below its protocol",
      isDeepStrictEqual([...KEY_ONLY_PROVIDERS], ["deepseek"]) &&
        rows[0]?.hidden === true &&
        rows[1]?.hidden === true &&
        rows[2]?.hidden === false &&
        rows[3]?.hidden === true &&
        rows[4]?.hidden === true &&
        rows[5]?.hidden === false &&
        rows[6]?.hidden === false &&
        rows[7]?.hidden === false &&
        rows[8]?.hidden === false &&
        rows[9]?.hidden === false,
      { keyOnlyProviders: KEY_ONLY_PROVIDERS, rows },
    );
  }

  // ---- Check 3: the model id round trip ----
  {
    const tuple = '["xiaomi","mimo-v2.6-flash"]';
    const slash = "xiaomi/mimo-v2.6-flash";
    const rows = [
      { name: "stored tuple to the phone", toPhone: peerDeepSeekModelId(tuple), expected: slash },
      { name: "phone choice to the host", toPhone: restorePeerDeepSeekModelId(slash), expected: tuple },
      { name: "plain model to the phone", toPhone: peerDeepSeekModelId(DSH_MODEL), expected: DSH_MODEL },
      { name: "plain model to the host", toPhone: restorePeerDeepSeekModelId(DSH_MODEL), expected: DSH_MODEL },
      { name: "empty head to the host", toPhone: restorePeerDeepSeekModelId("/mimo"), expected: "/mimo" },
      { name: "empty tail to the host", toPhone: restorePeerDeepSeekModelId("xiaomi/"), expected: "xiaomi/" },
      { name: "three parts to the phone", toPhone: peerDeepSeekModelId("qwen/qwen3/30b"), expected: "qwen/qwen3/30b" },
    ];
    check(
      "3 the model id round trip converts the DSH tuple both ways and passes every other shape through",
      rows.every((row) => row.toPhone === row.expected),
      rows,
    );
  }

  // ---- Check 4: a plain protocol 8 client does not see the DeepSeek agent ----
  const plainList = await call("GET", TEAM_API_ROUTES.agents.all, { token: owner.sessionToken });
  check(
    "4 a plain remote client on protocol 8 lists no deepseek-provider agent",
    plainList.status === 200 &&
      !agentIds(plainList).includes(DSH_AGENT) &&
      isDeepStrictEqual(agentIds(plainList), [PLAIN_AGENT]),
    summary(plainList),
  );

  // ---- Check 5: the same client, paired and announced, sees it ----
  pairedSessions.add(PAIRED_SESSION_ID);
  const pairedList = await call("GET", TEAM_API_ROUTES.agents.all, {
    token: owner.sessionToken,
    capabilities: pairedCapabilities,
    headers: { [WEBRTC_SESSION_HEADER]: PAIRED_SESSION_ID },
  });
  const pairedDsh = list(pairedList.body).find((item) => field(item, "id") === DSH_AGENT);
  check(
    "5 the same client with the capability header and a paired session id lists the deepseek agent",
    pairedList.status === 200 && agentIds(pairedList).includes(DSH_AGENT) && field(pairedDsh, "model") === DSH_MODEL,
    summary(pairedList),
  );

  // ---- Check 6: the provider-secret routes stay refused ----
  {
    const secretRoutes = [
      PROVIDERS_V8_ROUTES.apiKeyState,
      PROVIDERS_V8_ROUTES.apiKeySet,
      PROVIDERS_V8_ROUTES.apiKeyClear,
    ];
    const replies: Reply[] = [];
    for (const route of secretRoutes) {
      replies.push(
        await call("POST", route, {
          token: owner.sessionToken,
          capabilities: pairedCapabilities,
          headers: { [WEBRTC_SESSION_HEADER]: PAIRED_SESSION_ID },
          json:
            route === PROVIDERS_V8_ROUTES.apiKeySet
              ? { provider: "deepseek", key: "unused" }
              : { provider: "deepseek" },
        }),
      );
    }
    check(
      "6 the three provider-secret routes answer 400 providersUnsupported even for the paired client",
      replies.every((reply) => reply.status === 400 && field(reply.body, "error") === providersUnsupported),
      replies.map(summary),
    );
  }

  // ---- Check 7: a chat request reaches the agent only for the paired client ----
  {
    const sendsBefore = callsOf("sendMessage").length;
    const message = { text: "hello dsh", attachmentDraftIds: [], replyToMessageId: null };
    const pairedSend = await call("POST", TEAM_API_ROUTES.agent.messages(DSH_AGENT), {
      token: owner.sessionToken,
      capabilities: pairedCapabilities,
      headers: { [WEBRTC_SESSION_HEADER]: PAIRED_SESSION_ID },
      json: message,
    });
    const recorded = callsOf("sendMessage").at(-1)?.[0];
    const recordedOk = isDynamicRecord(recorded) && recorded.agentId === DSH_AGENT && recorded.text === "hello dsh";
    check(
      "7 the paired client's message reaches the deepseek agent service",
      pairedSend.status === 202 && callsOf("sendMessage").length === sendsBefore + 1 && recordedOk,
      { reply: summary(pairedSend), recorded },
    );
    const unpairedSend = await call("POST", TEAM_API_ROUTES.agent.messages(DSH_AGENT), {
      token: owner.sessionToken,
      json: message,
    });
    check(
      "7 the unpaired client's message to the hidden agent gets 404 agentNotFound and reaches no service",
      errorIs(unpairedSend, 404, notFound) && callsOf("sendMessage").length === sendsBefore + 1,
      summary(unpairedSend),
    );
  }

  // ---- Check 8: the event encode path agrees with the list ----
  {
    const hiddenUnpaired = server.hiddenAgentIds(8, new Set(memberCapabilities), undefined, false);
    const hiddenPaired = server.hiddenAgentIds(8, new Set(pairedCapabilities), undefined, true);
    // The list answers carry the agents the hidden set does NOT name.
    check(
      "8 the hiddenAgentIds the event encode path calls hides exactly the agents the list answers left out",
      isDeepStrictEqual(
        agentIds(plainList),
        agents.filter((item) => !hiddenUnpaired.has(item.id)).map((item) => item.id),
      ) &&
        isDeepStrictEqual(
          agentIds(pairedList),
          agents.filter((item) => !hiddenPaired.has(item.id)).map((item) => item.id),
        ) &&
        hiddenProviderAgentIds(agents, 8, false).has(DSH_AGENT) &&
        !hiddenProviderAgentIds(agents, 8, true).has(DSH_AGENT),
      { unpaired: [...hiddenUnpaired], paired: [...hiddenPaired] },
    );
  }

  // ---- Check 9: revocation flips the visibility back ----
  {
    pairedSessions.delete(PAIRED_SESSION_ID);
    const revokedList = await call("GET", TEAM_API_ROUTES.agents.all, {
      token: owner.sessionToken,
      capabilities: pairedCapabilities,
      headers: { [WEBRTC_SESSION_HEADER]: PAIRED_SESSION_ID },
    });
    const revokedSend = await call("POST", TEAM_API_ROUTES.agent.messages(DSH_AGENT), {
      token: owner.sessionToken,
      capabilities: pairedCapabilities,
      headers: { [WEBRTC_SESSION_HEADER]: PAIRED_SESSION_ID },
      json: { text: "hello dsh", attachmentDraftIds: [], replyToMessageId: null },
    });
    check(
      "9 after the pairing registry drops the session, the same paired request stops seeing and reaching the deepseek agent",
      revokedList.status === 200 &&
        !agentIds(revokedList).includes(DSH_AGENT) &&
        isDeepStrictEqual(agentIds(revokedList), [PLAIN_AGENT]) &&
        errorIs(revokedSend, 404, notFound),
      { list: summary(revokedList), send: summary(revokedSend) },
    );
  }

  check(
    "no log line holds the owner session token",
    logged.every((line) => !line.includes(owner.sessionToken)),
    { lines: logged.length },
  );
} finally {
  if (server) await Effect.runPromise(server.stop());
  rmSync(root, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "ok" : "FAILED"} ${item.name}\n`);
assert.equal(failed.length, 0, `${failed.length} checks failed; see ${join(OUT, "report.json")}`);
