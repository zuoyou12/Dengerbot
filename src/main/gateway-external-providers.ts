import { createDecipheriv, createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { ExternalProviderInfo } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import type { CustomProviderConfig } from "../backend/custom-provider-types";
import type { GatewaySource } from "./local-gateway";

const logger = createOpenBotLogger("gateway-external-providers");

export type FetchFunction = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ---- Schemas ----

interface WorkBuddyAuthPayload {
  account?: {
    uid?: string;
    nickname?: string;
    phoneNumber?: string;
  };
  auth?: {
    accessToken?: string | Record<string, string>;
    refreshToken?: string | Record<string, string>;
    domain?: string;
    tokenType?: string;
  };
}

const workBuddyAuthPayloadSchema: z.ZodType<WorkBuddyAuthPayload> = z.object({
  account: z
    .object({
      uid: z.string().optional(),
      nickname: z.string().optional(),
      phoneNumber: z.string().optional(),
    })
    .optional(),
  auth: z
    .object({
      accessToken: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
      refreshToken: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
      domain: z.string().optional(),
      tokenType: z.string().optional(),
    })
    .optional(),
});

const savedProviderStateSchema = z.object({
  enabledProviders: z.record(z.string(), z.boolean()),
  customKeys: z.record(z.string(), z.string()).optional(),
  deviceId: z.string().optional(),
});

const ollamaTagsSchema = z.object({
  models: z.array(z.object({ name: z.string().optional(), model: z.string().optional() })).optional(),
});

const qoderSettingsSchema = z.object({
  token: z.string().optional(),
  apiKey: z.string().optional(),
  auth: z
    .object({
      token: z.string().optional(),
      accessToken: z.string().optional(),
    })
    .optional(),
  user: z
    .object({
      email: z.string().optional(),
      uid: z.string().optional(),
    })
    .optional(),
  account: z
    .object({
      uid: z.string().optional(),
      email: z.string().optional(),
    })
    .optional(),
});

const traeConfigSchema = z.object({
  auth: z
    .object({
      token: z.string().optional(),
      accessToken: z.string().optional(),
    })
    .optional(),
  token: z.string().optional(),
  accessToken: z.string().optional(),
  apiKey: z.string().optional(),
  jwt: z.string().optional(),
  "Cloud-IDE-JWT": z.string().optional(),
});

const zcodeConfigSchema = z.object({
  provider: z
    .record(
      z.string(),
      z
        .object({
          options: z.object({ apiKey: z.string().optional() }).optional(),
        })
        .optional(),
    )
    .optional(),
});

const zcodeCredentialsSchema = z.record(z.string(), z.string());

const userInfoSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  user_id: z.string().optional(),
});

const genericAuthSchema = z.object({
  token: z.string().optional(),
  accessToken: z.string().optional(),
  uid: z.string().optional(),
  email: z.string().optional(),
});

const qoderStatusSchema = z.object({
  userInfo: z
    .object({
      email: z.string().optional(),
      uid: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
});

const zcodeSettingSchema = z.object({
  dataBaseDir: z.string().optional(),
});

// ---- Utility Helpers ----

function resolveUserHome(): string {
  if (process.platform === "win32") {
    const home = process.env.HOME?.trim();
    if (home && isAbsolute(home) && existsSync(home)) {
      return home;
    }
    const userProfile = process.env.USERPROFILE?.trim();
    if (userProfile && existsSync(userProfile)) {
      return userProfile;
    }
  }
  return homedir();
}

function parseJsonSafe<T>(filePath: string, schema: z.ZodType<T>): T | null {
  if (!existsSync(filePath)) return null;
  try {
    const text = readFileSync(filePath, "utf-8");
    const result = schema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ---- WorkBuddy Reader ----

function getWorkBuddyBasePath(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(localAppData, "CodeBuddyExtension", "Data", "Public", "auth");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth");
  }
  return join(homedir(), ".local", "share", "CodeBuddyExtension", "Data", "Public", "auth");
}

export function readWorkBuddyAuth(fileName: string): { uid: string; token: string; domain: string } | null {
  const filePath = join(getWorkBuddyBasePath(), fileName);
  const json = parseJsonSafe(filePath, workBuddyAuthPayloadSchema);
  if (!json) return null;

  const uid = json.account?.uid ?? "";
  const rawToken = json.auth?.accessToken;
  const token = typeof rawToken === "string" ? rawToken : "";
  const domain = json.auth?.domain ?? "";
  if (!uid || !token) return null;
  return { uid, token, domain };
}

// ---- ZCode Reader & Decryptor ----

export function getZCodeSecret(): Buffer {
  const custom = process.env.ZCODE_CREDENTIAL_SECRET?.trim();
  if (custom) {
    return createHash("sha256").update(custom).digest();
  }
  const home = resolveUserHome();
  let username = "";
  try {
    username = userInfo().username;
  } catch {
    username = process.env.USERNAME || "";
  }
  if (username.includes("\\")) {
    username = username.split("\\").pop() || username;
  }
  const platform = process.platform === "win32" ? "win32" : process.platform;
  const seed = `zcode-credential-fallback:${platform}:${home}:${username}`;
  return createHash("sha256").update(seed).digest();
}

export function decryptZCodeValue(encrypted: string, secret: Buffer): string | null {
  if (!encrypted.startsWith("enc:v1:")) return null;
  const rest = encrypted.slice("enc:v1:".length);
  const parts = rest.split(".");
  if (parts.length !== 3) return null;
  const [rawIv, rawTag, rawCipher] = parts;
  if (!rawIv || !rawTag || !rawCipher) return null;
  try {
    const iv = Buffer.from(rawIv, "base64url");
    const tag = Buffer.from(rawTag, "base64url");
    const ciphertext = Buffer.from(rawCipher, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", secret, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, undefined, "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

function getZCodeDir(): string {
  const home = resolveUserHome();
  const settingPath = join(home, ".zcode", "v2", "setting.json");
  const setting = parseJsonSafe(settingPath, zcodeSettingSchema);
  if (setting?.dataBaseDir) {
    const d = setting.dataBaseDir.trim();
    if (d && isAbsolute(d) && existsSync(d)) {
      return join(d, ".zcode", "v2");
    }
  }
  return join(home, ".zcode", "v2");
}

export function readZCodeAuth(): { apiKey: string; account: string } | null {
  const zcodeDir = getZCodeDir();
  const secret = getZCodeSecret();

  // 1. Check config.json (ZCode 3.15+)
  const configPath = join(zcodeDir, "config.json");
  const cfg = parseJsonSafe(configPath, zcodeConfigSchema);

  if (cfg?.provider) {
    const targetKeys = [
      "builtin:bigmodel-coding-plan",
      "builtin:zai-coding-plan",
      "account:bigmodel-individual-coding-plan",
      "account:zai-individual-coding-plan",
    ];
    for (const key of targetKeys) {
      let candidate = cfg.provider[key]?.options?.apiKey?.trim() ?? "";
      if (candidate.startsWith("enc:v1:")) {
        candidate = decryptZCodeValue(candidate, secret)?.trim() ?? "";
      }
      if (candidate.length > 0 && !candidate.startsWith("${")) {
        return { apiKey: candidate, account: "GLM Coding Plan (config.json)" };
      }
    }
  }

  // 2. Check credentials.json
  const credPath = join(zcodeDir, "credentials.json");
  const creds = parseJsonSafe(credPath, zcodeCredentialsSchema);
  if (creds) {
    let accountName = "";
    // Discover user info
    for (const infoKey of ["oauth:bigmodel:user_info", "oauth:zai:user_info"]) {
      const encryptedUserInfo = creds[infoKey];
      if (encryptedUserInfo) {
        const decrypted = decryptZCodeValue(encryptedUserInfo, secret);
        if (decrypted) {
          try {
            const parsed = userInfoSchema.safeParse(JSON.parse(decrypted));
            if (parsed.success) {
              const info = parsed.data;
              accountName = info.email || info.name || (info.user_id ? `UID: ${info.user_id}` : "");
              break;
            }
          } catch {
            // Ignore JSON parse error
          }
        }
      }
    }

    // Discover coding plan API key
    for (const [k, v] of Object.entries(creds)) {
      if (k.includes(":coding-plan:") && k.endsWith(":api-key")) {
        const decrypted = decryptZCodeValue(v, secret);
        if (decrypted?.includes(".")) {
          return {
            apiKey: decrypted.trim(),
            account: accountName || "GLM Coding Plan",
          };
        }
      }
    }

    // Fallback: Start plan JWT
    if (creds.zcodejwttoken) {
      const jwt = decryptZCodeValue(creds.zcodejwttoken, secret);
      if (jwt) {
        const cleanJwt = jwt.replace(/^Bearer\s+/iu, "").trim();
        if (cleanJwt.length > 0) {
          return {
            apiKey: cleanJwt,
            account: accountName || "ZCode Start Plan",
          };
        }
      }
    }
  }

  return null;
}

// ---- Qoder & Qoder CN Reader ----

function getQoderDir(isCn: boolean): string {
  if (isCn) {
    const envDir = process.env.QODERCN_CONFIG_DIR?.trim();
    if (envDir && existsSync(envDir)) return envDir;
    return join(resolveUserHome(), ".qoder-cn");
  }
  const envDir = process.env.QODER_CONFIG_DIR?.trim();
  if (envDir && existsSync(envDir)) return envDir;
  return join(resolveUserHome(), ".qoder");
}

export function readQoderAuth(isCn: boolean): { token: string; account: string } | null {
  const dir = getQoderDir(isCn);
  if (!existsSync(dir)) return null;

  let token = "";
  let account = "";

  // 1. settings.json
  const settings = parseJsonSafe(join(dir, "settings.json"), qoderSettingsSchema);
  if (settings) {
    if (settings.token?.trim()) {
      token = settings.token.trim();
    } else if (settings.auth?.token?.trim()) {
      token = settings.auth.token.trim();
    } else if (settings.auth?.accessToken?.trim()) {
      token = settings.auth.accessToken.trim();
    } else if (settings.apiKey?.trim()) {
      token = settings.apiKey.trim();
    }

    if (settings.user?.email) {
      account = settings.user.email;
    } else if (settings.account?.uid) {
      account = `UID: ${settings.account.uid.slice(0, 8)}...`;
    }
  }

  // 2. auth.json
  if (!token) {
    const auth = parseJsonSafe(join(dir, "auth.json"), genericAuthSchema);
    if (auth?.token || auth?.accessToken) {
      token = (auth.token || auth.accessToken || "").trim();
      account = auth.email || (auth.uid ? `UID: ${auth.uid.slice(0, 8)}...` : account);
    }
  }

  // 3. .qoder-app-status.json for metadata
  if (!account) {
    const status = parseJsonSafe(join(dir, ".qoder-app-status.json"), qoderStatusSchema);
    if (status?.userInfo) {
      account =
        status.userInfo.email ||
        status.userInfo.name ||
        (status.userInfo.uid ? `UID: ${status.userInfo.uid.slice(0, 8)}...` : "");
    }
  }

  if (token) {
    return { token, account: account || (isCn ? "Qoder CN" : "Qoder Global") };
  }
  return null;
}

// ---- Trae CN Reader ----

export function readTraeAuth(): { token: string; account: string } | null {
  const home = resolveUserHome();
  const candidateDirs: string[] = [];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    candidateDirs.push(join(appData, "Trae", "User"));
  } else if (process.platform === "darwin") {
    candidateDirs.push(join(homedir(), "Library", "Application Support", "Trae", "User"));
  } else {
    candidateDirs.push(join(homedir(), ".config", "Trae", "User"));
  }
  candidateDirs.push(join(home, ".trae"));

  for (const dir of candidateDirs) {
    if (!existsSync(dir)) continue;

    // settings.json
    const settings = parseJsonSafe(join(dir, "settings.json"), traeConfigSchema);
    if (settings) {
      const candidate =
        settings.token ||
        settings.accessToken ||
        settings["Cloud-IDE-JWT"] ||
        settings.jwt ||
        settings.apiKey ||
        settings.auth?.token ||
        settings.auth?.accessToken;
      if (candidate?.trim()) {
        return { token: candidate.trim(), account: "Trae Client" };
      }
    }

    // auth.json
    const auth = parseJsonSafe(join(dir, "auth.json"), genericAuthSchema);
    if (auth?.token || auth?.accessToken) {
      const token = (auth.token || auth.accessToken || "").trim();
      const account = auth.uid ? `UID: ${auth.uid.slice(0, 8)}...` : "Trae Client";
      return { token, account };
    }

    // config.json
    const config = parseJsonSafe(join(dir, "config.json"), traeConfigSchema);
    if (config) {
      const candidate =
        config.auth?.token || config.auth?.accessToken || config.token || config.accessToken || config.apiKey;
      if (candidate?.trim()) {
        return { token: candidate.trim(), account: "Trae Client" };
      }
    }
  }

  return null;
}

// ---- Manager Implementation ----

export class ExternalProvidersManager {
  private static sharedInstances = new Map<string, ExternalProvidersManager>();

  public static getOrCreate(stateDirectory: string): ExternalProvidersManager {
    let instance = ExternalProvidersManager.sharedInstances.get(stateDirectory);
    if (!instance) {
      instance = new ExternalProvidersManager(stateDirectory);
    }
    return instance;
  }

  public static setShared(stateDirectory: string, instance: ExternalProvidersManager): void {
    ExternalProvidersManager.sharedInstances.set(stateDirectory, instance);
  }

  private readonly configPath: string;
  private state: z.infer<typeof savedProviderStateSchema>;
  public onStateChanged?: () => void | Promise<unknown>;

  constructor(stateDirectory: string) {
    this.configPath = join(stateDirectory, "external-providers.json");
    this.state = this.readConfig();
    ExternalProvidersManager.sharedInstances.set(stateDirectory, this);
  }

  private readConfig(): z.infer<typeof savedProviderStateSchema> {
    try {
      if (existsSync(this.configPath)) {
        const text = readFileSync(this.configPath, "utf-8");
        const parsed = savedProviderStateSchema.safeParse(JSON.parse(text));
        if (parsed.success) {
          const data = parsed.data;
          if (!data.deviceId) {
            data.deviceId = randomUUID();
          }
          if (!data.customKeys) {
            data.customKeys = {};
          }
          return data;
        }
      }
    } catch {
      // Ignore
    }
    return {
      enabledProviders: {
        "workbuddy-ai": true,
        workbuddy: true,
        ollama: true,
        qoder: true,
        "qoder-cn": true,
        zcode: true,
        "trae-cn": true,
      },
      customKeys: {},
      deviceId: randomUUID(),
    };
  }

  private saveConfig(): void {
    try {
      const dir = dirname(this.configPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.configPath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (error) {
      logger.warn("Failed saving external providers config:", error);
    }
  }

  public getDeviceId(): string {
    if (!this.state.deviceId) {
      this.state.deviceId = randomUUID();
      this.saveConfig();
    }
    return this.state.deviceId;
  }

  public async detect(fetchImpl: FetchFunction = fetch): Promise<readonly ExternalProviderInfo[]> {
    const list: ExternalProviderInfo[] = [];

    // 1. WorkBuddy AI
    const wbAi = readWorkBuddyAuth("workbuddy-desktop-ai.info");
    const wbAiCustomKey = this.state.customKeys?.["workbuddy-ai"]?.trim();
    const wbAiFileDetected = wbAi !== null;
    const wbAiConfigured = Boolean(wbAiCustomKey);
    const wbAiDetected = wbAiFileDetected || wbAiConfigured;
    const wbAiEnabled = this.state.enabledProviders["workbuddy-ai"] ?? true;
    list.push({
      id: "workbuddy-ai",
      name: "WorkBuddy AI (腾讯国际版)",
      detected: wbAiDetected,
      account: wbAi ? `UID: ${wbAi.uid.slice(0, 8)}...` : wbAiConfigured ? "自定义 API Key" : undefined,
      status: wbAiFileDetected ? "已登录 (Token 活跃)" : wbAiConfigured ? "已配置 (手动配置)" : "未检测到登录账户",
      models: ["deepseek-chat", "deepseek-reasoner", "claude-3-7-sonnet", "claude-3-5-sonnet", "gpt-4o"],
      enabled: wbAiDetected && wbAiEnabled,
      configuredKey: wbAiConfigured,
      requiresManualKey: !wbAiFileDetected,
    });

    // 2. WorkBuddy CN
    const wbCn = readWorkBuddyAuth("workbuddy-desktop.info");
    const wbCnCustomKey = this.state.customKeys?.workbuddy?.trim();
    const wbCnFileDetected = wbCn !== null;
    const wbCnConfigured = Boolean(wbCnCustomKey);
    const wbCnDetected = wbCnFileDetected || wbCnConfigured;
    const wbCnEnabled = this.state.enabledProviders.workbuddy ?? true;
    list.push({
      id: "workbuddy",
      name: "WorkBuddy (腾讯国内版)",
      detected: wbCnDetected,
      account: wbCn ? `UID: ${wbCn.uid.slice(0, 8)}...` : wbCnConfigured ? "自定义 API Key" : undefined,
      status: wbCnFileDetected ? "已登录 (Token 活跃)" : wbCnConfigured ? "已配置 (手动配置)" : "未检测到登录账户",
      models: ["deepseek-chat", "deepseek-reasoner", "qwen-2.5-coder-32b"],
      enabled: wbCnDetected && wbCnEnabled,
      configuredKey: wbCnConfigured,
      requiresManualKey: !wbCnFileDetected,
    });

    // 3. Ollama
    let ollamaDetected = false;
    let ollamaModels: string[] = [];
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetchImpl("http://127.0.0.1:11434/api/tags", { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        ollamaDetected = true;
        const parsedTags = ollamaTagsSchema.safeParse(await res.json());
        if (parsedTags.success) {
          ollamaModels = (parsedTags.data.models ?? []).map((m) => m.name || m.model || "").filter(Boolean);
        }
      }
    } catch {
      // Ollama not running or not installed
    }
    const ollamaEnabled = this.state.enabledProviders.ollama ?? true;
    list.push({
      id: "ollama",
      name: "Ollama (本地运行环境)",
      detected: ollamaDetected,
      account: ollamaDetected ? "http://127.0.0.1:11434" : undefined,
      status: ollamaDetected ? `正在运行 (${ollamaModels.length} 个模型)` : "未启动服务 (11434 端口未响应)",
      models: ollamaModels,
      enabled: ollamaDetected && ollamaEnabled,
      requiresManualKey: false,
    });

    // 4. Qoder (Global)
    const qoder = readQoderAuth(false);
    const qoderCustomKey = this.state.customKeys?.qoder?.trim();
    const qoderFileDetected = qoder !== null;
    const qoderConfigured = Boolean(qoderCustomKey);
    const qoderDetected = qoderFileDetected || qoderConfigured;
    const qoderEnabled = this.state.enabledProviders.qoder ?? true;
    list.push({
      id: "qoder",
      name: "Qoder (国际版)",
      detected: qoderDetected,
      account: qoder?.account || (qoderConfigured ? "自定义 API Key" : undefined),
      status: qoderFileDetected ? "已登录 (Token 活跃)" : qoderConfigured ? "已配置 (手动配置)" : "未检测到登录账户",
      models: [
        "qoder/fast",
        "qoder/ultimate",
        "claude-3-7-sonnet",
        "claude-3-5-sonnet",
        "gpt-4o",
        "deepseek-chat",
        "deepseek-reasoner",
      ],
      enabled: qoderDetected && qoderEnabled,
      configuredKey: qoderConfigured,
      requiresManualKey: !qoderFileDetected,
    });

    // 5. Qoder CN
    const qoderCn = readQoderAuth(true);
    const qoderCnCustomKey = this.state.customKeys?.["qoder-cn"]?.trim();
    const qoderCnFileDetected = qoderCn !== null;
    const qoderCnConfigured = Boolean(qoderCnCustomKey);
    const qoderCnDetected = qoderCnFileDetected || qoderCnConfigured;
    const qoderCnEnabled = this.state.enabledProviders["qoder-cn"] ?? true;
    list.push({
      id: "qoder-cn",
      name: "Qoder CN (国内版)",
      detected: qoderCnDetected,
      account: qoderCn?.account || (qoderCnConfigured ? "自定义 API Key" : undefined),
      status: qoderCnFileDetected
        ? "已登录 (Token 活跃)"
        : qoderCnConfigured
          ? "已配置 (手动配置)"
          : "未检测到登录账户",
      models: [
        "qoder/fast",
        "qoder/ultimate",
        "claude-3-7-sonnet",
        "claude-3-5-sonnet",
        "deepseek-chat",
        "deepseek-reasoner",
        "qwen-2.5-coder-32b",
      ],
      enabled: qoderCnDetected && qoderCnEnabled,
      configuredKey: qoderCnConfigured,
      requiresManualKey: !qoderCnFileDetected,
    });

    // 6. ZCode (GLM Coding Plan)
    const zcode = readZCodeAuth();
    const zcodeCustomKey = this.state.customKeys?.zcode?.trim();
    const zcodeFileDetected = zcode !== null;
    const zcodeConfigured = Boolean(zcodeCustomKey);
    const zcodeDetected = zcodeFileDetected || zcodeConfigured;
    const zcodeEnabled = this.state.enabledProviders.zcode ?? true;
    list.push({
      id: "zcode",
      name: "ZCode (智谱 GLM Coding Plan)",
      detected: zcodeDetected,
      account: zcode?.account || (zcodeConfigured ? "自定义 API Key" : undefined),
      status: zcodeFileDetected ? "已登录 (Token 活跃)" : zcodeConfigured ? "已配置 (手动配置)" : "未检测到登录账户",
      models: [
        "glm-5.3",
        "GLM-5.3",
        "glm-5.2",
        "glm-5.1",
        "glm-5",
        "glm-4-plus",
        "glm-4-air",
        "glm-4-flash",
        "glm-4-long",
        "codegeex-4",
      ],
      enabled: zcodeDetected && zcodeEnabled,
      configuredKey: zcodeConfigured,
      requiresManualKey: !zcodeFileDetected,
    });

    // 7. Trae CN
    const trae = readTraeAuth();
    const traeCustomKey = this.state.customKeys?.["trae-cn"]?.trim();
    const traeFileDetected = trae !== null;
    const traeConfigured = Boolean(traeCustomKey);
    const traeDetected = traeFileDetected || traeConfigured;
    const traeEnabled = this.state.enabledProviders["trae-cn"] ?? true;
    list.push({
      id: "trae-cn",
      name: "Trae (字节跳动)",
      detected: traeDetected,
      account: trae?.account || (traeConfigured ? "自定义 API Key" : undefined),
      status: traeFileDetected ? "已登录 (Token 活跃)" : traeConfigured ? "已配置 (手动配置)" : "未检测到登录账户",
      models: ["kimi-k3-max", "claude-3-7-sonnet", "claude-3-5-sonnet", "gpt-4o", "deepseek-chat", "deepseek-reasoner"],
      enabled: traeDetected && traeEnabled,
      configuredKey: traeConfigured,
      requiresManualKey: !traeFileDetected,
    });

    return list;
  }

  public async setEnabled(
    providerId: string,
    enabled: boolean,
    apiKey?: string,
  ): Promise<readonly ExternalProviderInfo[]> {
    this.state.enabledProviders[providerId] = enabled;
    if (apiKey !== undefined) {
      if (!this.state.customKeys) {
        this.state.customKeys = {};
      }
      const trimmed = apiKey.trim();
      if (trimmed.length > 0) {
        this.state.customKeys[providerId] = trimmed;
      } else {
        delete this.state.customKeys[providerId];
      }
    }
    this.saveConfig();
    try {
      await this.onStateChanged?.();
    } catch {
      // Ignore reload error
    }
    return this.detect();
  }

  /**
   * Returns active CustomProviderConfig entries for all enabled and detected subscribed providers.
   * Fully synchronous since underlying file reads and decryptors use synchronous APIs.
   */
  public getSubscribedCustomProviders(): CustomProviderConfig[] {
    const configs: CustomProviderConfig[] = [];
    const deviceId = this.getDeviceId();

    // 1. WorkBuddy CN
    if (this.state.enabledProviders.workbuddy !== false) {
      const wbCn = readWorkBuddyAuth("workbuddy-desktop.info");
      const key = this.state.customKeys?.workbuddy?.trim() || wbCn?.token;
      if (key) {
        configs.push({
          id: "workbuddy",
          name: "WorkBuddy CN",
          baseUrl: "https://copilot.tencent.com",
          apiKey: key,
          headers: [
            { name: "User-Agent", value: "WorkBuddy/5.5.6" },
          ],
          models: [
            { id: "deepseek-chat", name: "DeepSeek V3 (WorkBuddy CN)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (WorkBuddy CN)" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (WorkBuddy CN)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (WorkBuddy CN)" },
            { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (WorkBuddy CN)" },
          ],
        });
      }
    }

    // 2. WorkBuddy AI
    if (this.state.enabledProviders["workbuddy-ai"] !== false) {
      const wbAi = readWorkBuddyAuth("workbuddy-desktop-ai.info");
      const key = this.state.customKeys?.["workbuddy-ai"]?.trim() || wbAi?.token;
      if (key) {
        configs.push({
          id: "workbuddy-ai",
          name: "WorkBuddy AI",
          baseUrl: "https://www.workbuddy.ai",
          apiKey: key,
          headers: [
            { name: "User-Agent", value: "WorkBuddy/5.5.6" },
          ],
          models: [
            { id: "deepseek-chat", name: "DeepSeek V3 (WorkBuddy)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (WorkBuddy)" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (WorkBuddy)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (WorkBuddy)" },
            { id: "gpt-4o", name: "GPT-4o (WorkBuddy)" },
          ],
        });
      }
    }

    // 3. Qoder Global
    if (this.state.enabledProviders.qoder !== false) {
      const qoder = readQoderAuth(false);
      const key = this.state.customKeys?.qoder?.trim() || qoder?.token;
      if (key) {
        configs.push({
          id: "qoder",
          name: "Qoder",
          baseUrl: "https://openapi.qoder.sh/v1",
          apiKey: key,
          headers: [
            { name: "User-Agent", value: "Qoder/1.1" },
            { name: "Cosy-Version", value: "1.1.69" },
            { name: "X-Device-Id", value: deviceId },
          ],
          models: [
            { id: "qoder/fast", name: "Qoder Fast (0.8x)" },
            { id: "qoder/ultimate", name: "Qoder Ultimate" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Qoder)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Qoder)" },
            { id: "gpt-4o", name: "GPT-4o (Qoder)" },
            { id: "deepseek-chat", name: "DeepSeek V3 (Qoder)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (Qoder)" },
          ],
        });
      }
    }

    // 4. Qoder CN
    if (this.state.enabledProviders["qoder-cn"] !== false) {
      const qoderCn = readQoderAuth(true);
      const key = this.state.customKeys?.["qoder-cn"]?.trim() || qoderCn?.token;
      if (key) {
        configs.push({
          id: "qoder-cn",
          name: "Qoder CN",
          baseUrl: "https://openapi.qoder.com.cn/v1",
          apiKey: key,
          headers: [
            { name: "User-Agent", value: "Qoder/1.1" },
            { name: "Cosy-Version", value: "1.1.69" },
            { name: "X-Device-Id", value: deviceId },
          ],
          models: [
            { id: "qoder/fast", name: "Qoder Fast (0.8x)" },
            { id: "qoder/ultimate", name: "Qoder Ultimate" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Qoder CN)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Qoder CN)" },
            { id: "deepseek-chat", name: "DeepSeek V3 (Qoder CN)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (Qoder CN)" },
            { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (Qoder CN)" },
          ],
        });
      }
    }

    // 5. ZCode (GLM Coding Plan)
    if (this.state.enabledProviders.zcode !== false) {
      const zcode = readZCodeAuth();
      const key = this.state.customKeys?.zcode?.trim() || zcode?.apiKey;
      if (key) {
        configs.push({
          id: "zcode",
          name: "ZCode",
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          apiKey: key,
          headers: [
            { name: "User-Agent", value: "ZCode/3.14.3" },
            { name: "X-Device-Mid", value: deviceId },
          ],
          models: [
            { id: "glm-5.3", name: "GLM-5.3" },
            { id: "GLM-5.3", name: "GLM-5.3 (Uppercase)" },
            { id: "glm-5.2", name: "GLM-5.2" },
            { id: "glm-5.1", name: "GLM-5.1" },
            { id: "glm-5", name: "GLM-5" },
            { id: "glm-4-plus", name: "GLM-4 Plus" },
            { id: "glm-4-air", name: "GLM-4 Air" },
            { id: "glm-4-flash", name: "GLM-4 Flash" },
            { id: "glm-4-long", name: "GLM-4 Long" },
            { id: "codegeex-4", name: "CodeGeeX-4" },
          ],
        });
      }
    }

    // 6. Trae CN
    if (this.state.enabledProviders["trae-cn"] !== false) {
      const trae = readTraeAuth();
      const key = this.state.customKeys?.["trae-cn"]?.trim() || trae?.token;
      if (key) {
        configs.push({
          id: "trae-cn",
          name: "Trae",
          baseUrl: "https://api.trae.cn/v1",
          apiKey: key,
          headers: [
            { name: "User-Agent", value: "Trae/1.0" },
          ],
          models: [
            { id: "kimi-k3-max", name: "Kimi K3 Max (Trae)" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Trae)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Trae)" },
            { id: "gpt-4o", name: "GPT-4o (Trae)" },
            { id: "deepseek-chat", name: "DeepSeek V3 (Trae)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (Trae)" },
          ],
        });
      }
    }

    return configs;
  }

  public async getGatewaySources(fetchImpl: FetchFunction = fetch): Promise<GatewaySource[]> {
    const sources: GatewaySource[] = [];
    const deviceId = this.getDeviceId();

    // 1. WorkBuddy AI
    if (this.state.enabledProviders["workbuddy-ai"] !== false) {
      const wbAi = readWorkBuddyAuth("workbuddy-desktop-ai.info");
      const key = this.state.customKeys?.["workbuddy-ai"]?.trim() || wbAi?.token;
      if (key) {
        sources.push({
          id: "workbuddy-ai",
          name: "WorkBuddy AI",
          baseUrl: "https://www.workbuddy.ai",
          apiKey: key,
          headers: {
            "User-Agent": "WorkBuddy/5.5.6",
          },
          models: [
            { id: "deepseek-chat", name: "DeepSeek V3 (WorkBuddy)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (WorkBuddy)" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (WorkBuddy)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (WorkBuddy)" },
            { id: "gpt-4o", name: "GPT-4o (WorkBuddy)" },
          ],
        });
      }
    }

    // 2. WorkBuddy CN
    if (this.state.enabledProviders.workbuddy !== false) {
      const wbCn = readWorkBuddyAuth("workbuddy-desktop.info");
      const key = this.state.customKeys?.workbuddy?.trim() || wbCn?.token;
      if (key) {
        sources.push({
          id: "workbuddy",
          name: "WorkBuddy CN",
          baseUrl: "https://copilot.tencent.com",
          apiKey: key,
          headers: {
            "User-Agent": "WorkBuddy/5.5.6",
          },
          models: [
            { id: "deepseek-chat", name: "DeepSeek V3 (WorkBuddy CN)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (WorkBuddy CN)" },
            { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (WorkBuddy CN)" },
          ],
        });
      }
    }

    // 3. Ollama
    if (this.state.enabledProviders.ollama !== false) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1000);
        const res = await fetchImpl("http://127.0.0.1:11434/api/tags", { signal: controller.signal });
        clearTimeout(timeout);
        if (res.ok) {
          const parsedTags = ollamaTagsSchema.safeParse(await res.json());
          const models = (parsedTags.success ? (parsedTags.data.models ?? []) : [])
            .map((m) => {
              const id = m.name || m.model || "";
              return { id, name: id };
            })
            .filter((m) => m.id);

          sources.push({
            id: "ollama",
            name: "Ollama Local",
            baseUrl: "http://127.0.0.1:11434/v1",
            apiKey: "ollama",
            headers: {},
            models,
          });
        }
      } catch {
        // Ollama offline
      }
    }

    // 4. Qoder (Global)
    if (this.state.enabledProviders.qoder !== false) {
      const qoder = readQoderAuth(false);
      const key = this.state.customKeys?.qoder?.trim() || qoder?.token;
      if (key) {
        sources.push({
          id: "qoder",
          name: "Qoder",
          baseUrl: "https://openapi.qoder.sh/v1",
          apiKey: key,
          headers: {
            "User-Agent": "Qoder/1.1",
            "Cosy-Version": "1.1.69",
            "X-Device-Id": deviceId,
          },
          models: [
            { id: "qoder/fast", name: "Qoder Fast (0.8x)" },
            { id: "qoder/ultimate", name: "Qoder Ultimate" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Qoder)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Qoder)" },
            { id: "gpt-4o", name: "GPT-4o (Qoder)" },
            { id: "deepseek-chat", name: "DeepSeek V3 (Qoder)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (Qoder)" },
          ],
        });
      }
    }

    // 5. Qoder CN
    if (this.state.enabledProviders["qoder-cn"] !== false) {
      const qoderCn = readQoderAuth(true);
      const key = this.state.customKeys?.["qoder-cn"]?.trim() || qoderCn?.token;
      if (key) {
        sources.push({
          id: "qoder-cn",
          name: "Qoder CN",
          baseUrl: "https://openapi.qoder.com.cn/v1",
          apiKey: key,
          headers: {
            "User-Agent": "Qoder/1.1",
            "Cosy-Version": "1.1.69",
            "X-Device-Id": deviceId,
          },
          models: [
            { id: "qoder/fast", name: "Qoder Fast (0.8x)" },
            { id: "qoder/ultimate", name: "Qoder Ultimate" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Qoder CN)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Qoder CN)" },
            { id: "deepseek-chat", name: "DeepSeek V3 (Qoder CN)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (Qoder CN)" },
            { id: "qwen-2.5-coder-32b", name: "Qwen 2.5 Coder 32B (Qoder CN)" },
          ],
        });
      }
    }

    // 6. ZCode (GLM Coding Plan)
    if (this.state.enabledProviders.zcode !== false) {
      const zcode = readZCodeAuth();
      const key = this.state.customKeys?.zcode?.trim() || zcode?.apiKey;
      if (key) {
        sources.push({
          id: "zcode",
          name: "ZCode (智谱 GLM Coding Plan)",
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          apiKey: key,
          headers: {
            "User-Agent": "ZCode/3.14.3",
            "X-Device-Mid": deviceId,
          },
          models: [
            { id: "glm-5.3", name: "GLM-5.3" },
            { id: "GLM-5.3", name: "GLM-5.3 (Uppercase)" },
            { id: "glm-5.2", name: "GLM-5.2" },
            { id: "glm-5.1", name: "GLM-5.1" },
            { id: "glm-5", name: "GLM-5" },
            { id: "glm-4-plus", name: "GLM-4 Plus" },
            { id: "glm-4-air", name: "GLM-4 Air" },
            { id: "glm-4-flash", name: "GLM-4 Flash" },
            { id: "glm-4-long", name: "GLM-4 Long" },
            { id: "codegeex-4", name: "CodeGeeX-4" },
          ],
        });
      }
    }

    // 7. Trae CN
    if (this.state.enabledProviders["trae-cn"] !== false) {
      const trae = readTraeAuth();
      const key = this.state.customKeys?.["trae-cn"]?.trim() || trae?.token;
      if (key) {
        sources.push({
          id: "trae-cn",
          name: "Trae CN",
          baseUrl: "https://api.trae.cn/v1",
          apiKey: key,
          headers: {
            "User-Agent": "Trae/1.0",
          },
          models: [
            { id: "kimi-k3-max", name: "Kimi K3 Max (Trae)" },
            { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (Trae)" },
            { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet (Trae)" },
            { id: "gpt-4o", name: "GPT-4o (Trae)" },
            { id: "deepseek-chat", name: "DeepSeek V3 (Trae)" },
            { id: "deepseek-reasoner", name: "DeepSeek R1 (Trae)" },
          ],
        });
      }
    }

    return sources;
  }
}
