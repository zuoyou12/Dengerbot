/** Provider-plugin identities from Magpie's MIT community registry. No model or account state is preset. */
export interface SubscriptionPluginListing {
  id: string;
  name: string;
  packageName: string;
  icon: string;
  providerIds: readonly string[];
  description: { en: string; zh: string };
  community: boolean;
}

export interface SubscriptionPackageMetadata {
  packageName: string;
  version: string | null;
  description: string;
  license?: string;
  homepage?: string;
}

export interface SubscriptionMarketSnapshot {
  entries: readonly SubscriptionPluginListing[];
  source: "registry" | "cached" | "offline";
  error?: string;
}

/** Only npm package identities are accepted, never paths, URLs, versions or install flags. */
export function isSubscriptionPackageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}

export const SUBSCRIPTION_PLUGIN_MARKET_URL =
  "https://raw.githubusercontent.com/magpie-community/plugins/main/registry.json";

/** Offline directory; installed versions and provider capabilities must come from the live plugin host. */
export const SUBSCRIPTION_PLUGIN_CATALOG: readonly SubscriptionPluginListing[] = [
  {
    id: "opencode-copilot-auth",
    name: "GitHub Copilot",
    packageName: "@magpie-community/opencode-copilot-auth",
    icon: "githubcopilot",
    providerIds: ["github-copilot"],
    description: {
      en: "GitHub Copilot on GitHub.com or GitHub Enterprise, with premium request or credit usage, remaining allowance and quota reset dates.",
      zh: "GitHub Copilot：支持 GitHub.com 与 GitHub Enterprise，显示高级请求或积分用量、剩余额度和重置时间。",
    },
    community: true,
  },
  {
    id: "opencode-joycode-auth",
    name: "JoyCode",
    packageName: "@magpie-community/opencode-joycode-auth",
    icon: "generic",
    providerIds: ["joycode"],
    description: {
      en: "Unofficial JoyCode provider: JD account browser sign-in, live models and credit multipliers, plan credits and streaming tool calls.",
      zh: "非官方 JoyCode 插件：京东账号浏览器登录，动态模型与积分倍率、套餐额度及流式工具调用。",
    },
    community: true,
  },
  {
    id: "opencode-kimi-work-auth",
    name: "Kimi Work",
    packageName: "@magpie-community/opencode-kimi-work-auth",
    icon: "kimi",
    providerIds: ["kimi-work"],
    description: {
      en: "Kimi desktop Work subscription through its local sign-in, with live Work models and shared membership usage. Separate from Kimi Code.",
      zh: "使用本机普通 Kimi 桌面版的 Work 登录，自动读取 Work 模型和会员共享用量；独立于 Kimi Code。",
    },
    community: true,
  },
  {
    id: "opencode-zen-free-auth",
    name: "OpenCode Zen Free",
    packageName: "@magpie-community/opencode-zen-free-auth",
    icon: "opencode",
    providerIds: ["opencode-zen-free"],
    description: {
      en: "OpenCode Zen's free models with the public credential, automatic discovery and native streaming protocols.",
      zh: "使用 public 凭证接入 OpenCode Zen 免费模型，自动发现模型并支持原生流式协议。",
    },
    community: true,
  },
  {
    id: "opencode-zcode-auth",
    name: "ZCode",
    packageName: "@magpie-community/opencode-zcode-auth",
    icon: "zcode",
    providerIds: ["zcode"],
    description: {
      en: "Z.ai and BigModel GLM Coding Plan, team seats and ZCode's free Start Plan, with a daily claim of its gift plans.",
      zh: "Z.ai 与智谱 GLM Coding Plan，支持团队席位和 ZCode 免费 Start Plan，可每日领取 ZCode 活动包。",
    },
    community: true,
  },
  {
    id: "opencode-qoder-auth",
    name: "Qoder",
    packageName: "@magpie-community/opencode-qoder-auth",
    icon: "qoder",
    providerIds: ["qoder", "qoder-cn", "qwenwork", "qwenwork-enterprise"],
    description: {
      en: "Your Qoder subscription (qoder.com or Qoder CN), and QwenWork (千问办公): the public cloud or the enterprise flagship with its own domain. Unofficial for QwenWork.",
      zh: "用 Qoder 自己的设备登录使用 Qoder 订阅（国际版或 Qoder CN）；也接入千问办公：公有云与企业旗舰版（输入企业自己的域名）。千问办公部分非官方。",
    },
    community: true,
  },
  {
    id: "opencode-devin-auth",
    name: "Devin",
    packageName: "@magpie-community/opencode-devin-auth",
    icon: "devin",
    providerIds: ["devin"],
    description: {
      en: "Devin's models with your Devin account — a browser sign-in or the devin CLI's.",
      zh: "用 Devin 账号使用 Devin 的模型：浏览器登录，或沿用 devin CLI 的登录。",
    },
    community: true,
  },
  {
    id: "opencode-zed-auth",
    name: "Zed",
    packageName: "@magpie-community/opencode-zed-auth",
    icon: "zed",
    providerIds: ["zed"],
    description: {
      en: "Claude, GPT, Gemini and Grok hosted by Zed, on your Zed plan.",
      zh: "用 Zed 订阅使用 Zed 托管的 Claude、GPT、Gemini 和 Grok。",
    },
    community: true,
  },
  {
    id: "opencode-factory-auth",
    name: "Factory",
    packageName: "@magpie-community/opencode-factory-auth",
    icon: "factory",
    providerIds: ["factory"],
    description: {
      en: "Factory's Droid subscription: 30 models from Anthropic, OpenAI, xAI and open labs.",
      zh: "Factory Droid 订阅：Anthropic、OpenAI、xAI 及开源模型共 30 个。",
    },
    community: true,
  },
  {
    id: "opencode-grok-auth",
    name: "Grok",
    packageName: "@magpie-community/opencode-grok-auth",
    icon: "xai",
    providerIds: ["grok"],
    description: {
      en: "SuperGrok and X Premium+, through the Grok Build CLI's sign-in.",
      zh: "通过 Grok Build CLI 的登录使用 SuperGrok 和 X Premium+。",
    },
    community: true,
  },
  {
    id: "opencode-commandcode-auth",
    name: "Command Code",
    packageName: "@magpie-community/opencode-commandcode-auth",
    icon: "commandcode",
    providerIds: ["commandcode-plan"],
    description: {
      en: "Command Code plans — Pro, GOAT, Max, Ultra, Go and Teams.",
      zh: "Command Code 各档套餐：Pro、GOAT、Max、Ultra、Go 和 Teams。",
    },
    community: true,
  },
  {
    id: "opencode-mimo-auth",
    name: "Xiaomi MiMo",
    packageName: "@magpie-community/opencode-mimo-auth",
    icon: "mimocode",
    providerIds: ["mimo-app"],
    description: {
      en: "Xiaomi MiMo models with your Xiaomi account.",
      zh: "用小米账号使用小米 MiMo 模型。",
    },
    community: true,
  },
  {
    id: "opencode-cursor-auth",
    name: "Cursor",
    packageName: "@magpie-community/opencode-cursor-auth",
    icon: "cursor",
    providerIds: ["cursor"],
    description: {
      en: "Cursor Pro, Pro+, Ultra and Teams — every model your plan has, with tool calls.",
      zh: "Cursor Pro、Pro+、Ultra 与 Teams：套餐里的所有模型，支持工具调用。",
    },
    community: true,
  },
  {
    id: "opencode-kiro-auth",
    name: "Kiro",
    packageName: "@magpie-community/opencode-kiro-auth",
    icon: "kiro-color",
    providerIds: ["kiro"],
    description: {
      en: "Kiro Free, Pro, Pro+ and Power — Kiro's sign-in, kiro-cli's, or an API key.",
      zh: "Kiro Free、Pro、Pro+ 与 Power：Kiro 登录、沿用 kiro-cli 的登录，或 API key。",
    },
    community: true,
  },
  {
    id: "opencode-minimax-auth",
    name: "MiniMax Code",
    packageName: "@magpie-community/opencode-minimax-auth",
    icon: "minimax-color",
    providerIds: ["minimax-code", "minimax-code-global"],
    description: {
      en: "MiniMax Code account credits (daily check-in) and M Plan, with MiniMax Code's own device sign-in.",
      zh: "用 MiniMax Code 账号的积分（每日签到）与 M Plan，使用 MiniMax Code 自己的设备登录。",
    },
    community: true,
  },
  {
    id: "opencode-workbuddy-auth",
    name: "WorkBuddy",
    packageName: "@magpie-community/opencode-workbuddy-auth",
    icon: "workbuddy-color",
    providerIds: ["workbuddy", "workbuddy-ai"],
    description: {
      en: "WorkBuddy's China build (CodeBuddy plan) and its international build.",
      zh: "WorkBuddy 国内版（CodeBuddy 套餐）与国际版。",
    },
    community: true,
  },
  {
    id: "opencode-cline-auth",
    name: "Cline",
    packageName: "@magpie-community/opencode-cline-auth",
    icon: "cline",
    providerIds: ["cline"],
    description: {
      en: "Cline's models on your own Cline account — usage billing, ClinePass and Cline's free models — with Cline's device sign-in or an API key.",
      zh: "用自己的 Cline 账号使用 Cline 的模型——用量计费、ClinePass 与免费模型——支持 Cline 设备登录或 API key。",
    },
    community: true,
  },
  {
    id: "opencode-trae-auth",
    name: "Trae",
    packageName: "@magpie-community/opencode-trae-auth",
    icon: "trae",
    providerIds: ["trae-cn", "trae-global"],
    description: {
      en: "Trae CN (trae.cn) and Trae international (trae.ai) models with your own account, free tier included — Trae's own browser sign-in. Experimental.",
      zh: "用 Trae CN（trae.cn）与 Trae 国际版（trae.ai）账号使用各自的模型，含免费版，使用 Trae 自己的浏览器登录。实验性。",
    },
    community: true,
  },
  {
    id: "opencode-opendesign-auth",
    name: "Open Design",
    packageName: "@magpie-community/opencode-opendesign-auth",
    icon: "generic",
    providerIds: ["opendesign"],
    description: {
      en: "Open Design Cloud's Design Plan (open-design.ai): the account's device sign-in, the models the plan entitles it to, and the plan's 5-hour and 7-day allowance and wallet balance.",
      zh: "Open Design Cloud 的 Design Plan（open-design.ai）：账号设备登录、套餐可用的模型，以及 5 小时与 7 天额度、钱包余额。",
    },
    community: true,
  },
  {
    id: "opencode-catpaw-auth",
    name: "CatPaw",
    packageName: "@magpie-community/opencode-catpaw-auth",
    icon: "generic",
    providerIds: ["catpaw"],
    description: {
      en: "Meituan's 妙手 CatPaw (ai.catpaw.meituan.com): a browser web sign-in or the desktop client's saved credentials, chat through its round/event/turn conversation protocol, models and credit balance.",
      zh: "美团妙手 CatPaw（ai.catpaw.meituan.com）：浏览器网页登录或妙手桌面端已保存的登录态，经其 round/event/turn 会话协议对话，含模型与积分余额。",
    },
    community: true,
  },
  {
    id: "opencode-loomy-auth",
    name: "Loomy",
    packageName: "@magpie-community/opencode-loomy-auth",
    icon: "generic",
    providerIds: ["loomy"],
    description: {
      en: "iFlytek's Loomy (loomyad.xunfei.cn): SMS sign-in, OpenAI-compatible chat with reasoning-effort folding and image markers, the live model catalog, two point wallets and the daily first-login grant.",
      zh: "讯飞 Loomy（loomyad.xunfei.cn）：短信验证码登录，OpenAI 兼容对话（思考档折叠与图片标记适配），实时模型目录、双积分钱包与每日首登赠送。",
    },
    community: true,
  },
  {
    id: "opencode-nous-auth",
    name: "Nous Portal (OAuth)",
    packageName: "@magpie-community/opencode-nous-auth",
    icon: "nousresearch",
    providerIds: ["nous-portal"],
    description: {
      en: "Nous Portal models, with Nous Portal's device sign-in.",
      zh: "通过 Nous Portal 自己的设备码登录使用 Nous Portal 模型。",
    },
    community: true,
  },
  {
    id: "opencode-raccoon-auth",
    name: "商汤小浣熊",
    packageName: "@magpie-community/opencode-raccoon-auth",
    icon: "sensenova-color",
    providerIds: ["raccoon"],
    description: {
      en: "SenseTime Raccoon (xiaohuanxiong.com) models, account credits and daily check-in, with browser sign-in or Raccoon desktop's live sign-in.",
      zh: "商汤小浣熊（xiaohuanxiong.com）模型、积分余额与每日签到，支持浏览器登录或直接复用小浣熊桌面端登录态。",
    },
    community: true,
  },
  {
    id: "opencode-autoclaw-auth",
    name: "AutoClaw",
    packageName: "@magpie-community/opencode-autoclaw-auth",
    icon: "generic",
    providerIds: ["autoclaw", "autoclaw-cn"],
    description: {
      en: "AutoClaw (Zhipu OpenClaw) cloud accounts: oversea web sign-in (Google/z.ai) or CN phone SMS, credit balance and daily check-in.",
      zh: "AutoClaw（智谱澳龙/OpenClaw）云端账号：国际版网页登录（Google/z.ai）或国内手机验证码，积分余额与每日签到。",
    },
    community: true,
  },
  {
    id: "opencode-codearts-auth",
    name: "CodeArts / OfficeAce",
    packageName: "@magpie-community/opencode-codearts-auth",
    icon: "generic",
    providerIds: ["codearts", "officeace"],
    description: {
      en: "Unofficial: Huawei Cloud CodeArts (码道) coding plans and OfficeAce (AgentArts), each signed in with Huawei Cloud OAuth on its own card — GLM, DeepSeek, openPangu and OfficeAce's MaaS models, live models and credit rates, credit usage by bucket and the daily check-in. Replaces officeace-auth; accounts signed in there keep working.",
      zh: "非官方：华为云码道（CodeArts）编码套餐与 OfficeAce（AgentArts），两张卡各自用华为云 OAuth 登录；GLM、DeepSeek、openPangu 与 OfficeAce 的 MaaS 模型，实时模型与积分倍率、分桶积分用量和每日签到。取代 officeace-auth，原已登录的账号继续可用。",
    },
    community: true,
  },
  {
    id: "opencode-gcp-ai-auth",
    name: "GCP AI",
    packageName: "@magpie-community/opencode-gcp-ai-auth",
    icon: "generic",
    providerIds: ["gcp-ai"],
    description: {
      en: "Vertex AI models and Google Cloud promotional credits, signed with your own gcloud or ADC login. Lists only the models your project can call.",
      zh: "用本机 gcloud / ADC 登录使用 Vertex AI 模型，并读取 Google Cloud 促销赠金；只列出项目实际能调用的模型。",
    },
    community: true,
  },
  {
    id: "opencode-cloudflare-workers-ai-auth",
    name: "Cloudflare Workers AI",
    packageName: "@magpie-community/opencode-cloudflare-workers-ai-auth",
    icon: "generic",
    providerIds: ["cloudflare-workers-ai"],
    description: {
      en: "Cloudflare Workers AI with your API token (Workers AI:Edit): 28+ models discovered live from models.dev, the 8 paid-only models flagged, and a Neurons/day allowance row in magpie quota.",
      zh: "用你的 Cloudflare API Token（Workers AI:Edit 权限）登录 Workers AI：28+ 模型经 models.dev 实时发现，付费专属模型自动标注，magpie quota 显示每日 Neurons 免费额度。",
    },
    community: true,
  },
  {
    id: "opencode-river-auth",
    name: "River",
    packageName: "@magpie-community/opencode-river-auth",
    icon: "generic",
    providerIds: ["river"],
    description: {
      en: "River (river.ai) pay-as-you-go inference with your API key: per-account models from /v1/models, documented reasoning efforts and live prices from River's public pricing endpoint.",
      zh: "用你的 API key 接入 River (river.ai) 按量计费推理：按账号从 /v1/models 列出模型，带官方推理档位与实时价格。",
    },
    community: true,
  },
  {
    id: "opencode-orcaterm-auth",
    name: "OrcaTerm",
    packageName: "@magpie-community/opencode-orcaterm-auth",
    icon: "generic",
    providerIds: ["orcaterm"],
    description: {
      en: "Tencent Cloud OrcaTerm (遨驰终端) AI assistant models — DeepSeek, Hunyuan, GLM, Kimi — on the account's monthly question allowance. Unofficial; the README sets out the terms.",
      zh: "用腾讯云遨驰终端（OrcaTerm）AI 助手的模型——DeepSeek、混元、GLM、Kimi——走账号每月问答额度。非官方，条款风险见 README。",
    },
    community: true,
  },
  {
    id: "magpie-aws-bedrock-sso",
    name: "AWS Bedrock SSO",
    packageName: "magpie-aws-bedrock-sso",
    icon: "generic",
    providerIds: ["bedrock-sso"],
    description: {
      en: "Use Amazon Bedrock Claude and GPT models with your AWS CLI profile, including SSO / IAM Identity Center. SigV4 authentication; no Bedrock API key needed.",
      zh: "使用 AWS CLI 配置（支持 SSO / IAM Identity Center）接入 Amazon Bedrock 的 Claude 和 GPT 模型，通过 SigV4 签名，无需 Bedrock API 密钥。",
    },
    community: false,
  },
  {
    id: "magpie-providers-hub",
    name: "Providers Hub",
    packageName: "magpie-providers-hub",
    icon: "generic",
    providerIds: ["hub-astudio", "hub-accio", "hub-lobsterai", "hub-magicrew", "hub-magicrew-intl"],
    description: {
      en: "Third-party Magpie adapter for dsh-providers-hub (by JetLi): five providers, each a separate channel you can sign in to, meter and switch off on its own — AStudio (iFlytek), Accio (Alibaba), LobsterAI (Youdao), MagiCrew (letsmagic.cn / magicrew.ai). Channels that already exist in the registry are not shipped. Runs without DSH.",
      zh: "dsh-providers-hub（作者 JetLi）的第三方适配：五条供应商（每渠道一条，可各自登录/看额度/单独关闭）——AStudio（讯飞）、Accio（阿里）、LobsterAI（有道）、超级麦吉/MagiCrew（letsmagic.cn / magicrew.ai）。与社区 registry 已有插件重叠的渠道不随包提供。不依赖 DSH 运行。",
    },
    community: true,
  },
];

export function findSubscriptionPlugin(idOrPackage: string): SubscriptionPluginListing | undefined {
  return SUBSCRIPTION_PLUGIN_CATALOG.find(
    (plugin) =>
      plugin.id === idOrPackage || plugin.packageName === idOrPackage || plugin.providerIds.includes(idOrPackage),
  );
}
