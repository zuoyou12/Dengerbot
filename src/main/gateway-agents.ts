import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ConnectedAgentInfo } from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";

const logger = createOpenBotLogger("gateway-agents");

export interface AgentModelSummary {
  id: string;
  name: string;
}

/** A parsed JSON document, narrowed by the callers with `isDynamicRecord` and `Array.isArray`. */
// The JSON tree of an external CLI config: the fields this module does not own are preserved
// verbatim, so their shape stays opaque and the schema below is the parsing boundary.
const jsonObjectSchema = z.record(z.string(), z.unknown());
type JsonObject = z.infer<typeof jsonObjectSchema>;
type JsonDocument = JsonObject | unknown[] | string | number | boolean | null;

function safeReadJson(path: string): JsonDocument {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, "utf-8").trim();
    if (!content) return null;
    const parsed: JsonDocument = JSON.parse(content);
    return parsed;
  } catch (error) {
    logger.warn(`Failed to read JSON at ${path}:`, error);
    return null;
  }
}

function safeWriteJsonAtomic(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = `${path}.tmp.${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  renameSync(tempPath, path);
}

// ---- WorkBuddy / WorkBuddy AI ----

interface WorkBuddyModelEntry {
  id: string;
  name: string;
  vendor: string;
  apiKey: string;
  url: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  supportsToolCall?: boolean;
  supportsImages?: boolean;
  supportsReasoning?: boolean;
}

function isWorkBuddyModelEntry(val: unknown): val is WorkBuddyModelEntry {
  return isDynamicRecord(val) && typeof val.id === "string" && typeof val.vendor === "string";
}

function getWorkBuddyDir(intl: boolean): string {
  const envKey = intl ? "WORKBUDDY_AI_CONFIG_DIR" : "WORKBUDDY_CONFIG_DIR";
  const custom = process.env[envKey]?.trim();
  if (custom) return custom;
  return join(homedir(), intl ? ".workbuddy-ai" : ".workbuddy");
}

function checkWorkBuddyWired(configPath: string): boolean {
  const data = safeReadJson(configPath);
  if (!data) return false;
  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (isDynamicRecord(data) && Array.isArray(data.models)) {
    list = data.models;
  }
  return list.some((entry) => isWorkBuddyModelEntry(entry) && entry.vendor === "tecat");
}

function writeWorkBuddyConfig(
  configPath: string,
  wired: boolean,
  port: number,
  token: string,
  models: readonly AgentModelSummary[],
): void {
  const existing = safeReadJson(configPath);
  let isObjectShape = false;
  let rawList: unknown[] = [];
  let restFields: JsonObject = {};

  if (Array.isArray(existing)) {
    rawList = existing;
  } else if (isDynamicRecord(existing)) {
    isObjectShape = true;
    rawList = Array.isArray(existing.models) ? existing.models : [];
    restFields = { ...existing };
    delete restFields.models;
  }

  const kept = rawList.filter((m) => !isWorkBuddyModelEntry(m) || m.vendor !== "tecat");

  if (wired) {
    const defaultModels = models.length > 0 ? models : [{ id: "deepseek-chat", name: "DeepSeek Chat" }];
    const tecatEntries: WorkBuddyModelEntry[] = defaultModels.map((m) => ({
      id: m.id,
      name: `${m.name || m.id} (Dengerbot)`,
      vendor: "tecat",
      apiKey: token,
      url: `http://127.0.0.1:${port}/v1/chat/completions`,
      maxInputTokens: 128000,
      maxOutputTokens: 8192,
      supportsToolCall: true,
      supportsImages: false,
      supportsReasoning: m.id.includes("reasoner") || m.id.includes("r1"),
    }));
    kept.push(...tecatEntries);
  }

  if (isObjectShape) {
    safeWriteJsonAtomic(configPath, { ...restFields, models: kept });
  } else {
    safeWriteJsonAtomic(configPath, kept);
  }
}

// ---- Qoder / Qoder CN ----

function getQoderDir(cn: boolean): string {
  const envKey = cn ? "QODERCN_CONFIG_DIR" : "QODER_CONFIG_DIR";
  const custom = process.env[envKey]?.trim();
  if (custom) return custom;
  return join(homedir(), cn ? ".qoder-cn" : ".qoder");
}

function checkQoderWired(configPath: string): boolean {
  const data = safeReadJson(configPath);
  if (!isDynamicRecord(data) || !isDynamicRecord(data.providers)) return false;
  return "tecat" in data.providers;
}

function writeQoderConfig(
  configPath: string,
  wired: boolean,
  port: number,
  token: string,
  models: readonly AgentModelSummary[],
): void {
  const raw = safeReadJson(configPath);
  const settings: JsonObject = isDynamicRecord(raw) ? { ...raw } : {};
  const providers: JsonObject = isDynamicRecord(settings.providers) ? { ...settings.providers } : {};

  if (wired) {
    const defaultModels = models.length > 0 ? models : [{ id: "deepseek-chat", name: "DeepSeek Chat" }];
    providers.tecat = {
      displayName: "Dengerbot Gateway",
      protocol: "openai",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: token,
      models: defaultModels.map((m) => ({
        model: m.id,
        displayName: m.name || m.id,
        contextWindow: 128000,
        maxOutputTokens: 8192,
        capabilities: {
          tools: true,
          vision: false,
          thinking:
            m.id.includes("reasoner") || m.id.includes("r1")
              ? {
                  modes: ["enabled"],
                  supportsEffort: true,
                  supportedEffortLevels: ["low", "medium", "high"],
                }
              : undefined,
        },
      })),
    };
  } else {
    delete providers.tecat;
  }

  settings.providers = providers;
  safeWriteJsonAtomic(configPath, settings);
}

// ---- Claude Code ----

function getClaudeDir(): string {
  return join(homedir(), ".claude");
}

function checkClaudeWired(configPath: string): boolean {
  const raw = safeReadJson(configPath);
  if (!isDynamicRecord(raw) || !isDynamicRecord(raw.env)) return false;
  const base = raw.env.ANTHROPIC_BASE_URL;
  return typeof base === "string" && base.includes("127.0.0.1");
}

function writeClaudeConfig(configPath: string, wired: boolean, port: number, token: string): void {
  const raw = safeReadJson(configPath);
  const settings: JsonObject = isDynamicRecord(raw) ? { ...raw } : {};
  const env: JsonObject = isDynamicRecord(settings.env) ? { ...settings.env } : {};

  if (wired) {
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}/v1`;
    env.ANTHROPIC_AUTH_TOKEN = token;
  } else {
    if (typeof env.ANTHROPIC_BASE_URL === "string" && env.ANTHROPIC_BASE_URL.includes("127.0.0.1")) {
      delete env.ANTHROPIC_BASE_URL;
    }
    if (env.ANTHROPIC_AUTH_TOKEN === token) {
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
  }

  settings.env = env;
  safeWriteJsonAtomic(configPath, settings);
}

// ---- Public Interface ----

export function detectConnectedAgents(): readonly ConnectedAgentInfo[] {
  const list: ConnectedAgentInfo[] = [];

  // 1. WorkBuddy
  const wbDir = getWorkBuddyDir(false);
  const wbConfig = join(wbDir, "models.json");
  const wbInstalled = existsSync(wbDir) || existsSync(wbConfig);
  list.push({
    id: "workbuddy",
    name: "WorkBuddy (腾讯桌面端)",
    installed: wbInstalled,
    wired: checkWorkBuddyWired(wbConfig),
    configPath: wbConfig,
    description: "通过 ~/.workbuddy/models.json 注入 Dengerbot 本地模型，支持工具调用与长上下文",
  });

  // 2. WorkBuddy AI
  const wbAiDir = getWorkBuddyDir(true);
  const wbAiConfig = join(wbAiDir, "models.json");
  const wbAiInstalled = existsSync(wbAiDir) || existsSync(wbAiConfig);
  list.push({
    id: "workbuddy-ai",
    name: "WorkBuddy AI (国际版)",
    installed: wbAiInstalled,
    wired: checkWorkBuddyWired(wbAiConfig),
    configPath: wbAiConfig,
    description: "通过 ~/.workbuddy-ai/models.json 注入 Dengerbot 本地模型",
  });

  // 3. Qoder
  const qoderDir = getQoderDir(false);
  const qoderConfig = join(qoderDir, "settings.json");
  const qoderInstalled = existsSync(qoderDir) || existsSync(qoderConfig);
  list.push({
    id: "qoder",
    name: "Qoder CLI",
    installed: qoderInstalled,
    wired: checkQoderWired(qoderConfig),
    configPath: qoderConfig,
    description: "通过 ~/.qoder/settings.json 自动配置 Dengerbot OpenAI 协议服务提供商",
  });

  // 4. Qoder CN
  const qoderCnDir = getQoderDir(true);
  const qoderCnConfig = join(qoderCnDir, "settings.json");
  const qoderCnInstalled = existsSync(qoderCnDir) || existsSync(qoderCnConfig);
  list.push({
    id: "qoder-cn",
    name: "Qoder CN (国内版)",
    installed: qoderCnInstalled,
    wired: checkQoderWired(qoderCnConfig),
    configPath: qoderCnConfig,
    description: "通过 ~/.qoder-cn/settings.json 自动配置 Dengerbot 服务提供商",
  });

  // 5. Claude Code
  const claudeDir = getClaudeDir();
  const claudeConfig = join(claudeDir, "settings.json");
  const claudeInstalled = existsSync(claudeDir) || existsSync(claudeConfig);
  list.push({
    id: "claude",
    name: "Claude Code",
    installed: claudeInstalled,
    wired: checkClaudeWired(claudeConfig),
    configPath: claudeConfig,
    description: "通过 ~/.claude/settings.json 注入 ANTHROPIC_BASE_URL 代理到本地网关",
  });

  // 6. Ego Lite (AI 浏览器)
  const ego = getEgoLitePaths();
  list.push({
    id: "ego-lite",
    name: "Ego Lite (AI 自动化浏览器)",
    installed: ego.installed,
    wired: existsSync(ego.skillPath),
    configPath: ego.skillPath,
    description: "为 AI Agent 打造的多任务隔离浏览器，支持真实登录态免登复用与代码化网页操作",
  });

  return list;
}

function getEgoLitePaths(): { exe: string | null; installed: boolean; skillPath: string } {
  const localApp = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const candidates = [
    join(localApp, "Programs", "ego-lite", "ego.exe"),
    join(localApp, "Programs", "ego-lite", "ego lite.exe"),
    "C:\\Program Files\\ego-lite\\ego.exe",
    "C:\\Program Files (x86)\\ego-lite\\ego.exe",
  ];
  let foundExe: string | null = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      foundExe = c;
      break;
    }
  }
  const homeSkillsEgo = join(homedir(), ".agents", "skills", "ego-browser", "SKILL.md");
  return {
    exe: foundExe,
    installed: Boolean(foundExe) || existsSync(homeSkillsEgo),
    skillPath: homeSkillsEgo,
  };
}

export function wireAgent(
  agentId: string,
  enabled: boolean,
  port: number,
  token: string,
  models: readonly AgentModelSummary[],
): readonly ConnectedAgentInfo[] {
  switch (agentId) {
    case "workbuddy": {
      const config = join(getWorkBuddyDir(false), "models.json");
      writeWorkBuddyConfig(config, enabled, port, token, models);
      break;
    }
    case "workbuddy-ai": {
      const config = join(getWorkBuddyDir(true), "models.json");
      writeWorkBuddyConfig(config, enabled, port, token, models);
      break;
    }
    case "qoder": {
      const config = join(getQoderDir(false), "settings.json");
      writeQoderConfig(config, enabled, port, token, models);
      break;
    }
    case "qoder-cn": {
      const config = join(getQoderDir(true), "settings.json");
      writeQoderConfig(config, enabled, port, token, models);
      break;
    }
    case "claude": {
      const config = join(getClaudeDir(), "settings.json");
      writeClaudeConfig(config, enabled, port, token);
      break;
    }
    case "ego-lite": {
      const targetDir = join(homedir(), ".agents", "skills", "ego-browser");
      if (enabled) {
        const srcDir = join(__dirname, "../../resources/managed-skills/ego-browser");
        if (existsSync(srcDir)) {
          mkdirSync(targetDir, { recursive: true });
          cpSync(srcDir, targetDir, { recursive: true, force: true });
        }
      } else {
        if (existsSync(targetDir)) {
          rmSync(targetDir, { recursive: true, force: true });
        }
      }
      break;
    }
    default:
      throw new Error(`Unsupported agent: ${agentId}`);
  }

  return detectConnectedAgents();
}
