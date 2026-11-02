/**
 * The plugins the marketplace offers.
 *
 * Generated from marketplace/plugin-catalog/ by scripts/build-plugin-catalog.ts.
 * Do not edit by hand: run bun run marketplace:build:plugins, or
 * bun run marketplace:build:plugins -- --check to verify.
 */

import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { MarketplacePluginApp, MarketplacePluginDetail } from "@openbot/ui/features/settings/marketplace-plugins";

/**
 * The configuration an app installs as. The catalog states the name and how the server is reached -
 * an address, or a command and its words; the rest of the record and `enabled` are made here rather
 * than stored as catalog data that could disagree with `normalizeMcpConfig`.
 *
 * A credential is never among them. What a server asks for is declared in `server.auth`, and the
 * value is typed by the user in the connect dialog, which hands back the configuration that
 * connected.
 *
 * The id is empty, which is what the store reads as "new". An id it does not hold is an edit of a
 * row that is gone, and the save is refused.
 */
export function createPluginAppConfig(app: MarketplacePluginApp): McpServerConfig {
  return {
    id: "",
    name: app.server.name,
    transport: app.server.transport,
    enabled: true,
    command: app.server.transport === "stdio" ? app.server.command : "",
    args: app.server.transport === "stdio" ? [...app.server.args] : [],
    env: [],
    envPassthrough: [],
    workingDirectory: "",
    url: app.server.transport === "http" ? app.server.url : "",
    headers: [],
  };
}

const AAVE: MarketplacePluginDetail = {
  id: "plugin-aave",
  slug: "aave",
  name: "Aave",
  tagline: "Aave data and transactions",
  description:
    "Aave helps users explore live Aave V3 and V4 markets, review wallet positions and DAO governance, simulate lending actions, and prepare non-custodial transactions. Every transaction is returned unsigned: the plugin reads the markets and writes the call, and the wallet stays with the user.",
  category: "data-analytics",
  creatorName: "Avara",
  iconUrl: "https://aave.com/images/icon-aave.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-stablecoin-yield", text: "Where can I earn the most on stablecoins across Aave right now?" },
    { id: "prompt-usdc-rates", text: "Which pays more for USDC right now, Aave V3 or V4 on Ethereum?" },
    {
      id: "prompt-health-factor",
      text: "What's the health factor of 0x0a42b2f3a0d54157dbd7cc346335a4f1909fc02c, and how far from liquidation?",
    },
  ],
  apps: [
    {
      id: "app-aave-mcp",
      name: "Aave",
      description:
        "Live V3 and V4 markets, wallet positions, DAO governance, and prepared transactions, over one MCP server.",
      iconUrl: "https://aave.com/images/icon-aave.png",
      server: { name: "aave", transport: "http", url: "https://mcp.aave.com/mcp" },
    },
  ],
  skills: [],
  websiteUrl: "https://aave.com",
  privacyPolicyUrl: "https://aave.com/privacy",
  termsUrl: "https://aave.com/terms",
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/aave",
};

const CANVA: MarketplacePluginDetail = {
  id: "plugin-canva",
  slug: "canva",
  name: "Canva",
  tagline: "Designs, assets and exports",
  description:
    "Canva lets users create and edit designs in words, search their own design library, upload and organize assets, export in the format a channel needs, and leave comments where the work is. Each user signs in to their own Canva account, and the agent can do what that account can do.",
  category: "design",
  creatorName: "Canva",
  iconUrl: "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-recent-design", text: "Show me my most recently edited Canva design." },
    { id: "prompt-social-resize", text: "Resize my launch poster for Instagram and export both as PNG." },
    { id: "prompt-deck-from-notes", text: "Turn these release notes into a six-slide Canva presentation." },
  ],
  apps: [
    {
      id: "app-canva-mcp",
      name: "Canva",
      description:
        "Design creation and editing, library search, asset and brand management, exports, and comments, over one MCP server.",
      iconUrl: "https://static.canva.com/static/images/apple-touch-icon-180x180.png",
      server: {
        name: "canva",
        transport: "http",
        url: "https://mcp.canva.com/mcp",
        auth: [{ id: "canva-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.canva.com",
  privacyPolicyUrl: "https://www.canva.com/policies/privacy-policy/",
  termsUrl: "https://www.canva.com/policies/terms-of-use/",
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/canva",
};

const LINEAR: MarketplacePluginDetail = {
  id: "plugin-linear",
  slug: "linear",
  name: "Linear",
  tagline: "Issues and project triage",
  description:
    "Linear lets agents list assigned issues, triage the backlog, update statuses, and draft new issues in the workspace the signed-in account belongs to. Each user signs in to their own Linear account through the browser.",
  category: "coding",
  creatorName: "Linear",
  iconUrl: "https://linear.app/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-my-week", text: "What is assigned to me this week?" },
    { id: "prompt-backlog", text: "Triage the backlog: what is stale, blocked, or missing an owner?" },
    { id: "prompt-new-issue", text: "File an issue for the crash in the sync queue with reproduction steps." },
  ],
  apps: [
    {
      id: "app-linear-mcp",
      name: "Linear",
      description:
        "Issue search, triage, status updates, and issue creation, over Linear's MCP server with browser sign-in.",
      iconUrl: "https://linear.app/favicon.ico",
      server: {
        name: "linear",
        transport: "http",
        url: "https://mcp.linear.app/mcp",
        auth: [{ id: "linear-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://linear.app",
  privacyPolicyUrl: "https://linear.app/privacy",
  termsUrl: "https://linear.app/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/linear",
};

const NOTION: MarketplacePluginDetail = {
  id: "plugin-notion",
  slug: "notion",
  name: "Notion",
  tagline: "Docs and knowledge base",
  description:
    "Notion lets agents read and write pages, search the workspace, and keep meeting notes and specs where the team already works. Each user signs in to their own Notion account through the browser.",
  category: "productivity",
  creatorName: "Notion",
  iconUrl: "https://www.notion.so/images/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-find-spec", text: "Find the current launch spec and summarize the open questions." },
    { id: "prompt-meeting-notes", text: "Turn these bullets into a structured meeting note in my team space." },
    { id: "prompt-update-doc", text: "Update the onboarding doc with the new release checklist." },
  ],
  apps: [
    {
      id: "app-notion-mcp",
      name: "Notion",
      description:
        "Page search, reading, writing, and workspace navigation, over Notion's MCP server with browser sign-in.",
      iconUrl: "https://www.notion.so/images/favicon.ico",
      server: {
        name: "notion",
        transport: "http",
        url: "https://mcp.notion.com/mcp",
        auth: [{ id: "notion-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.notion.so",
  privacyPolicyUrl: "https://www.notion.so/privacy",
  termsUrl: "https://www.notion.so/terms",
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/notion",
};

const OBSIDIAN: MarketplacePluginDetail = {
  id: "plugin-obsidian",
  slug: "obsidian",
  name: "Obsidian",
  tagline: "Notes in your vault",
  description:
    "Obsidian lets agents search, read and write the notes in your vault, so the vault can be their memory. The local server connects to the Local REST API plugin in the Obsidian app on this computer. The plugin's API key is passed to the local server as one environment variable. Keep Obsidian open while agents use it.",
  category: "productivity",
  creatorName: "Obsidian",
  iconUrl: "https://obsidian.md/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-recall", text: "What do my notes say about the decisions on this project?" },
    { id: "prompt-save", text: "Save this decision as a new note in my vault." },
    { id: "prompt-log", text: "Add a summary of today's work to my Work log note." },
  ],
  apps: [
    {
      id: "app-obsidian-mcp",
      name: "Obsidian",
      description: "Note search, reading and editing, over a local MCP server with the Local REST API plugin key.",
      iconUrl: "https://obsidian.md/favicon.ico",
      server: {
        name: "obsidian",
        transport: "stdio",
        command: "npx",
        args: ["-y", "obsidian-mcp-server@3.7.2"],
        auth: [
          {
            id: "obsidian-key",
            kind: "key",
            label: "API key",
            fields: [
              {
                id: "token",
                label: "API key",
                env: "OBSIDIAN_API_KEY",
                hint: 'In Obsidian, open Settings > Local REST API. Copy the API key and turn on "Enable non-encrypted (HTTP) server".',
              },
            ],
            docsUrl: "https://github.com/coddingtonbear/obsidian-local-rest-api",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://obsidian.md",
  privacyPolicyUrl: "https://obsidian.md/privacy",
  termsUrl: "https://obsidian.md/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/obsidian",
};

const ATLASSIAN: MarketplacePluginDetail = {
  id: "plugin-atlassian",
  slug: "atlassian",
  name: "Atlassian",
  tagline: "Jira work items and Confluence pages",
  description:
    "Atlassian lets agents search and read Jira work items, Confluence pages and Bitbucket pull requests, and create or update work items, pages and comments. Each user signs in to their own Atlassian account through the browser and approves the access on a consent screen. Agents get the same permissions as the user: they can change work items and pages, change page permissions, and merge pull requests. Tools that delete Jira data stay off until an organization admin turns them on. Each tool call uses Rovo credits.",
  category: "productivity",
  creatorName: "Atlassian",
  iconUrl: "https://www.atlassian.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-assigned", text: "Which open Jira work items are assigned to me?" },
    { id: "prompt-release-page", text: "Find the Confluence page about our release process and summarize it." },
    { id: "prompt-new-item", text: "Create a Jira work item for the login bug with steps to reproduce." },
  ],
  apps: [
    {
      id: "app-atlassian-mcp",
      name: "Atlassian",
      description: "Jira, Confluence, and Bitbucket, over Atlassian's MCP server with browser sign-in.",
      iconUrl: "https://www.atlassian.com/favicon.ico",
      server: {
        name: "atlassian",
        transport: "http",
        url: "https://mcp.atlassian.com/v2/mcp",
        auth: [{ id: "atlassian-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.atlassian.com",
  privacyPolicyUrl: "https://www.atlassian.com/legal/privacy-policy",
  termsUrl: "https://www.atlassian.com/legal/atlassian-customer-agreement",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/atlassian",
};

const TODOIST: MarketplacePluginDetail = {
  id: "plugin-todoist",
  slug: "todoist",
  name: "Todoist",
  tagline: "Tasks, projects and reminders",
  description:
    "Todoist lets agents find tasks by date, text, label or filter, add and reschedule tasks, and manage projects, sections, labels, comments and reminders. Each user signs in to their own Todoist account through the browser. Agents get read and write access: they can change, complete and delete tasks, projects and other items.",
  category: "productivity",
  creatorName: "Doist",
  iconUrl: "https://www.todoist.com/static/apple-touch-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-today", text: "Which Todoist tasks are due today?" },
    { id: "prompt-capture", text: "Add these action items to my Todoist Inbox." },
    { id: "prompt-overdue", text: "Move my overdue Todoist tasks to tomorrow." },
  ],
  apps: [
    {
      id: "app-todoist-mcp",
      name: "Todoist",
      description: "Tasks, projects, and reminders, over Todoist's MCP server with browser sign-in.",
      iconUrl: "https://www.todoist.com/static/apple-touch-icon.png",
      server: {
        name: "todoist",
        transport: "http",
        url: "https://ai.todoist.net/mcp",
        auth: [{ id: "todoist-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.todoist.com",
  privacyPolicyUrl: "https://www.todoist.com/privacy",
  termsUrl: "https://www.todoist.com/terms-of-service",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/todoist",
};

const COBRAIN: MarketplacePluginDetail = {
  id: "plugin-cobrain",
  slug: "cobrain",
  name: "Cobrain",
  tagline: "Shared memory for your AI agents",
  description:
    "Cobrain is a Markdown memory that every AI you connect can read and write. Agents load the context of a client or project before working, search past notes and decisions, and save what they learn so the next thread starts where the last one ended. Each user signs in to their own Cobrain account.",
  category: "productivity",
  creatorName: "Cobrain",
  iconUrl: "https://cobrain.space/apple-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-start-session", text: "Load my Cobrain context for this project before we start." },
    { id: "prompt-search-decision", text: "Search my Cobrain notes for what we decided about pricing." },
    { id: "prompt-save-note", text: "Save a note in Cobrain with what we did today and what is left." },
  ],
  apps: [
    {
      id: "app-cobrain-mcp",
      name: "Cobrain",
      description: "Read, search and write notes in your Cobrain brain over one MCP server.",
      iconUrl: "https://cobrain.space/apple-icon.png",
      server: {
        name: "cobrain",
        transport: "http",
        url: "https://cobrain.space/mcp",
        auth: [{ id: "cobrain-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://cobrain.space",
  privacyPolicyUrl: "https://cobrain.space/privacy",
  termsUrl: "https://cobrain.space/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/cobrain",
};

const FIGMA: MarketplacePluginDetail = {
  id: "plugin-figma",
  slug: "figma",
  name: "Figma",
  tagline: "Designs and prototypes",
  description:
    "Figma lets agents read design files, inspect components, styles and variables, and hand production specs to engineers. It connects to the MCP server in the Figma desktop app, on this computer. The server can read designs only; write support is in progress.",
  category: "design",
  creatorName: "Figma",
  iconUrl: "https://static.figma.com/app/icon/1/favicon.ico",
  version: "1.1.0",
  prompts: [
    { id: "prompt-handoff", text: "Hand off the checkout file: list screens, components, and styles." },
    { id: "prompt-audit", text: "Audit this file for inconsistent spacing and color use." },
    { id: "prompt-assets", text: "Extract the marketing icons at 2x for the app bundle." },
  ],
  apps: [
    {
      id: "app-figma-mcp",
      name: "Figma",
      description:
        "Design context, metadata, variables and screenshots, over the MCP server in the Figma desktop app. Read-only for now.",
      iconUrl: "https://static.figma.com/app/icon/1/favicon.ico",
      server: {
        name: "figma-desktop",
        transport: "http",
        url: "http://127.0.0.1:3845/mcp",
        auth: [
          {
            id: "figma-desktop",
            label: "Figma desktop app",
            kind: "local",
            steps: [
              "Open the Figma desktop app and sign in. The server needs a Dev or Full seat on a paid plan.",
              "Open a design file from a team project, not from Drafts.",
              'Press ⌘K (Ctrl+K on Windows), search for "MCP", and turn on "Enable desktop MCP server".',
              "Keep Figma open while agents use it.",
            ],
            note: "The local server can only read designs: layout, code context, variables and screenshots. It cannot draw or edit yet. We are working on write support.",
            docsUrl: "https://developers.figma.com/docs/figma-mcp-server/local-server-installation/",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.figma.com",
  privacyPolicyUrl: "https://www.figma.com/privacy/",
  termsUrl: "https://www.figma.com/tos/",
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/figma",
};

const PAPER: MarketplacePluginDetail = {
  id: "plugin-paper",
  slug: "paper",
  name: "Paper",
  tagline: "Design canvas built on HTML and CSS",
  description:
    "Paper lets agents read and write the design file that is open in Paper Desktop: inspect artboards, selections, computed styles, JSX and tokens, and create or change frames, text and styles. Install Paper Desktop, open it once, and open a file before you start. OpenBot starts the Paper CLI that Paper Desktop installs. Paper needs no key. Write tools change the open file, so review each write before you approve it.",
  category: "design",
  creatorName: "Paper",
  iconUrl: "https://paper.design/apple-touch-icon.png",
  version: "1.0.1",
  prompts: [
    { id: "prompt-implement", text: "Implement the selected Paper frame in this codebase, with our code conventions." },
    { id: "prompt-code-to-design", text: "Use the styles in this repository and design a settings page in Paper." },
    { id: "prompt-tokens", text: "List the design tokens in the open Paper file and compare them with our theme." },
  ],
  apps: [
    {
      id: "app-paper-mcp",
      name: "Paper",
      description:
        "Reads and writes the open Paper Desktop file, over the local MCP server that the Paper CLI relays. Needs Paper Desktop with a file open.",
      iconUrl: "https://paper.design/apple-touch-icon.png",
      server: { name: "paper", transport: "stdio", command: "~/.paper/bin/paper", args: ["mcp"] },
    },
  ],
  skills: [],
  websiteUrl: "https://paper.design",
  privacyPolicyUrl: "https://paper.design/legal/privacy",
  termsUrl: "https://paper.design/legal/tos",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/paper",
};

const APPLE_APPS: MarketplacePluginDetail = {
  id: "plugin-apple-apps",
  slug: "apple-apps",
  name: "Apple apps",
  tagline: "Mail, Calendar and more on your Mac",
  description:
    "Apple apps lets agents use Mail, Calendar, Contacts, Reminders, Notes, Messages and Safari on this Mac. It works on macOS only. OpenBot starts mcp-icloud, a community server that is not made by Apple or OpenBot. The server controls the apps through AppleScript, on this computer, and needs no account and no key. The first time an agent uses an app, macOS asks if OpenBot can control it. To change this later, open System Settings › Privacy & Security › Automation. Agents can send email and iMessages, and change or delete events, contacts and reminders, so review each write before you approve it. What the tools read, such as email text, goes to the model provider of the agent.",
  category: "productivity",
  creatorName: "MrGo2",
  iconUrl: "https://www.apple.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-unread", text: "Summarize my unread email in Apple Mail from today." },
    { id: "prompt-today", text: "What is on my Apple Calendar today and tomorrow?" },
    {
      id: "prompt-schedule",
      text: "Find the latest email about the project meeting and add the meeting to my calendar.",
    },
  ],
  apps: [
    {
      id: "app-apple-apps-mcp",
      name: "Apple apps",
      description:
        "Mail, Calendar, Contacts, Reminders, Notes, Messages and Safari, over the local mcp-icloud server. Needs macOS and Automation access.",
      iconUrl: "https://www.apple.com/favicon.ico",
      server: { name: "apple-apps", transport: "stdio", command: "npx", args: ["-y", "mcp-icloud@2.1.3"] },
    },
  ],
  skills: [],
  websiteUrl: "https://github.com/MrGo2/icloud-mcp",
  privacyPolicyUrl: "https://github.com/MrGo2/icloud-mcp/blob/main/PRIVACY.md",
  termsUrl: "https://github.com/MrGo2/icloud-mcp/blob/main/LICENSE",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/apple-apps",
};

const SENTRY: MarketplacePluginDetail = {
  id: "plugin-sentry",
  slug: "sentry",
  name: "Sentry",
  tagline: "Errors and crash triage",
  description:
    "Sentry lets agents search recent errors, inspect stack traces and affected releases, and summarize what broke after a deploy. Each user signs in to their own Sentry account through the browser.",
  category: "coding",
  creatorName: "Sentry",
  iconUrl: "https://sentry.io/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-new-errors", text: "What new errors appeared since yesterday's deploy?" },
    { id: "prompt-top-crash", text: "Explain the top crash in the mobile project and its likely cause." },
    { id: "prompt-release-health", text: "How healthy is the current release compared to the last one?" },
  ],
  apps: [
    {
      id: "app-sentry-mcp",
      name: "Sentry",
      description: "Error search, issue inspection, and release health, over Sentry's MCP server with browser sign-in.",
      iconUrl: "https://sentry.io/favicon.ico",
      server: {
        name: "sentry",
        transport: "http",
        url: "https://mcp.sentry.dev/mcp",
        auth: [{ id: "sentry-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://sentry.io",
  privacyPolicyUrl: "https://sentry.io/privacy/",
  termsUrl: "https://sentry.io/terms/",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/sentry",
};

const VERCEL: MarketplacePluginDetail = {
  id: "plugin-vercel",
  slug: "vercel",
  name: "Vercel",
  tagline: "Deployments, build logs and projects",
  description:
    "Vercel lets agents list projects and recent deployments, read build and runtime logs, and find why a build failed. Each user signs in to their own Vercel account through the browser and chooses the teams that agents can use. In those teams, agents get the same rights as the user's account. They can also change environment variables, domains, DNS records and deployments, and buy domains.",
  category: "coding",
  creatorName: "Vercel",
  iconUrl: "https://vercel.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-failed-build", text: "Why did the last production deployment fail?" },
    { id: "prompt-recent-deployments", text: "List the deployments from today and their status." },
    { id: "prompt-runtime-errors", text: "Which routes had runtime errors in the last hour?" },
  ],
  apps: [
    {
      id: "app-vercel-mcp",
      name: "Vercel",
      description:
        "Projects, deployments, build logs, and runtime logs, over Vercel's MCP server with browser sign-in.",
      iconUrl: "https://vercel.com/favicon.ico",
      server: {
        name: "vercel",
        transport: "http",
        url: "https://mcp.vercel.com",
        auth: [{ id: "vercel-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://vercel.com",
  privacyPolicyUrl: "https://vercel.com/legal/privacy-notice",
  termsUrl: "https://vercel.com/legal/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/vercel",
};

const CLOUDFLARE: MarketplacePluginDetail = {
  id: "plugin-cloudflare",
  slug: "cloudflare",
  name: "Cloudflare",
  tagline: "Workers, DNS, storage and logs",
  description:
    "Cloudflare lets agents list and manage Workers, DNS records, R2, D1 and KV through the Cloudflare API, query Workers logs, and search the Cloudflare docs. Each user signs in to their own Cloudflare account through the browser. On Cloudflare's consent page, choose Read only: the default, Minimal, does not let agents see Workers, logs or DNS records. With write permissions, agents can deploy and delete Workers, change DNS records and change other account settings.",
  category: "coding",
  creatorName: "Cloudflare",
  iconUrl: "https://developers.cloudflare.com/favicon.png",
  version: "1.0.1",
  prompts: [
    { id: "prompt-workers", text: "Which Workers are deployed in my Cloudflare account?" },
    { id: "prompt-errors", text: "Which Cloudflare Workers logged errors in the last hour?" },
    { id: "prompt-dns", text: "List the DNS records of each zone in my Cloudflare account." },
  ],
  apps: [
    {
      id: "app-cloudflare-mcp",
      name: "Cloudflare",
      description: "Workers, DNS, storage, and logs, over Cloudflare's API MCP server with browser sign-in.",
      iconUrl: "https://developers.cloudflare.com/favicon.png",
      server: {
        name: "cloudflare",
        transport: "http",
        url: "https://mcp.cloudflare.com/mcp",
        auth: [{ id: "cloudflare-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.cloudflare.com",
  privacyPolicyUrl: "https://www.cloudflare.com/privacypolicy/",
  termsUrl: "https://www.cloudflare.com/website-terms/",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/cloudflare",
};

const SUPABASE: MarketplacePluginDetail = {
  id: "plugin-supabase",
  slug: "supabase",
  name: "Supabase",
  tagline: "Databases, logs and edge functions",
  description:
    "Supabase lets agents list projects, run SQL, read table schemas and logs, check security and performance advisors, manage edge functions and branches, and search the Supabase docs. Each user signs in to their own Supabase account through the browser and chooses an organization. Agents get full access: they can run SQL that changes or deletes data, apply migrations, deploy edge functions, and create or pause projects.",
  category: "coding",
  creatorName: "Supabase",
  iconUrl: "https://supabase.com/favicon/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-projects", text: "Which projects are in my Supabase organization?" },
    { id: "prompt-tables", text: "List the tables and columns of my Supabase database." },
    { id: "prompt-errors", text: "Which errors did my Supabase project log in the last hour?" },
  ],
  apps: [
    {
      id: "app-supabase-mcp",
      name: "Supabase",
      description: "Databases, logs, and edge functions, over Supabase's MCP server with browser sign-in.",
      iconUrl: "https://supabase.com/favicon/favicon.ico",
      server: {
        name: "supabase",
        transport: "http",
        url: "https://mcp.supabase.com/mcp",
        auth: [{ id: "supabase-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://supabase.com",
  privacyPolicyUrl: "https://supabase.com/privacy",
  termsUrl: "https://supabase.com/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/supabase",
};

const NEON: MarketplacePluginDetail = {
  id: "plugin-neon",
  slug: "neon",
  name: "Neon",
  tagline: "Postgres projects, branches and migrations",
  description:
    "Neon lets agents list projects and branches, run SQL, read table schemas, test schema changes on a temporary branch, find slow queries, and search the Neon docs. Each user signs in to their own Neon account through the browser and can choose read-only access when they authorize. With full access, agents can run SQL that changes or deletes data, and create, reset or delete branches, databases and projects. Neon recommends its MCP server for development and testing, not for production databases.",
  category: "coding",
  creatorName: "Neon",
  iconUrl: "https://neon.com/apple-touch-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-projects", text: "Which projects and branches are in my Neon account?" },
    { id: "prompt-slow-queries", text: "Which queries are the slowest on my Neon database, and why?" },
    {
      id: "prompt-migration",
      text: "Add an index on the orders table in a temporary branch, and show me the result before you apply it.",
    },
  ],
  apps: [
    {
      id: "app-neon-mcp",
      name: "Neon",
      description: "Postgres projects, branches, SQL, and migrations, over Neon's MCP server with browser sign-in.",
      iconUrl: "https://neon.com/apple-touch-icon.png",
      server: {
        name: "neon",
        transport: "http",
        url: "https://mcp.neon.tech/mcp",
        auth: [{ id: "neon-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://neon.com",
  privacyPolicyUrl: "https://www.databricks.com/legal/privacynotice",
  termsUrl: "https://neon.com/platform-terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/neon",
};

const PRISMA: MarketplacePluginDetail = {
  id: "plugin-prisma",
  slug: "prisma",
  name: "Prisma",
  tagline: "Postgres databases, backups and Compute apps",
  description:
    "Prisma lets agents list and create Prisma Postgres databases, read schemas, run SQL, list backups and restore them to a new database, manage Object Storage buckets, read Compute builds and logs, and search the Prisma docs. Each user signs in to their own Prisma account through the browser and selects a workspace. Agents get full access: they can run SQL that changes or deletes data, update schemas, delete databases and buckets, and stop, roll back or delete Compute deployments.",
  category: "coding",
  creatorName: "Prisma",
  iconUrl: "https://www.prisma.io/apple-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-databases", text: "Which databases are in my Prisma workspace?" },
    { id: "prompt-backups", text: "Show me all available backups of my database." },
    { id: "prompt-logs", text: "Show the runtime logs of my latest Compute deployment." },
  ],
  apps: [
    {
      id: "app-prisma-mcp",
      name: "Prisma",
      description: "Databases, SQL, backups, and Compute apps, over Prisma's MCP server with browser sign-in.",
      iconUrl: "https://www.prisma.io/apple-icon.png",
      server: {
        name: "prisma",
        transport: "http",
        url: "https://mcp.prisma.io/mcp",
        auth: [{ id: "prisma-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.prisma.io",
  privacyPolicyUrl: "https://www.prisma.io/legal/privacy",
  termsUrl: "https://www.prisma.io/legal/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/prisma",
};

const NETLIFY: MarketplacePluginDetail = {
  id: "plugin-netlify",
  slug: "netlify",
  name: "Netlify",
  tagline: "Projects, deploys and request logs",
  description:
    "Netlify lets agents list projects and deploys, read edge request logs, create projects, and deploy code to an existing project. Each user signs in to their own Netlify account through the browser. Agents get the same access as the user's account: they can change environment variables, forms and visitor access, install or remove extensions, and delete form submissions and environment variables.",
  category: "coding",
  creatorName: "Netlify",
  iconUrl: "https://www.netlify.com/favicon/apple-touch-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-latest-deploy", text: "What is the status of the latest deploy of each of my Netlify projects?" },
    { id: "prompt-errors", text: "Which URLs of my site returned server errors in the last day?" },
    { id: "prompt-deploy", text: "Deploy this folder to my existing Netlify project." },
  ],
  apps: [
    {
      id: "app-netlify-mcp",
      name: "Netlify",
      description:
        "Projects, deploys, request logs, and site settings, over Netlify's MCP server with browser sign-in.",
      iconUrl: "https://www.netlify.com/favicon/apple-touch-icon.png",
      server: {
        name: "netlify",
        transport: "http",
        url: "https://netlify-mcp.netlify.app/mcp",
        auth: [{ id: "netlify-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.netlify.com",
  privacyPolicyUrl: "https://www.netlify.com/privacy/",
  termsUrl: "https://www.netlify.com/pdf/self-serve-subscription-agreement.pdf",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/netlify",
};

const RAILWAY: MarketplacePluginDetail = {
  id: "plugin-railway",
  slug: "railway",
  name: "Railway",
  tagline: "Projects, services and deployments",
  description:
    "Railway lets agents list projects and services, create projects, redeploy services, and manage feature flags. Agents can also give multi-step work to the Railway Agent, which reads logs, finds why a deploy failed, creates services and sets variables. Each user signs in to their own Railway account through the browser and chooses the workspaces and projects that agents can use. Agents get full access in those projects: they can deploy staged changes, delete feature flags, and change services, variables, databases and networking through the Railway Agent.",
  category: "coding",
  creatorName: "Railway",
  iconUrl: "https://railway.com/apple-touch-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-projects", text: "Which projects and services are in my Railway workspace?" },
    { id: "prompt-crash", text: "Why does my backend service on Railway crash on deploy?" },
    { id: "prompt-redeploy", text: "Redeploy the API service in my Railway project." },
  ],
  apps: [
    {
      id: "app-railway-mcp",
      name: "Railway",
      description: "Projects, services, and deployments, over Railway's MCP server with browser sign-in.",
      iconUrl: "https://railway.com/apple-touch-icon.png",
      server: {
        name: "railway",
        transport: "http",
        url: "https://mcp.railway.com",
        auth: [{ id: "railway-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://railway.com",
  privacyPolicyUrl: "https://railway.com/legal/privacy",
  termsUrl: "https://railway.com/legal/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/railway",
};

const CONTEXT7: MarketplacePluginDetail = {
  id: "plugin-context7",
  slug: "context7",
  name: "Context7",
  tagline: "Current library documentation",
  description:
    "Context7 fetches current documentation and API references for libraries and frameworks, so answers use the version the project actually runs. It needs no account and no key.",
  category: "research",
  creatorName: "Upstash",
  iconUrl: "https://context7.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-api-check", text: "What is the current API for virtualized lists in this framework?" },
    { id: "prompt-migrate", text: "What changed between v2 and v3 of this router?" },
    { id: "prompt-example", text: "Show a current example for authenticated file uploads." },
  ],
  apps: [
    {
      id: "app-context7-mcp",
      name: "Context7",
      description: "Current library documentation lookup, over the Context7 MCP server with no sign-in.",
      iconUrl: "https://context7.com/favicon.ico",
      server: { name: "context7", transport: "http", url: "https://mcp.context7.com/mcp" },
    },
  ],
  skills: [],
  websiteUrl: "https://context7.com",
  privacyPolicyUrl: "https://context7.com/privacy",
  termsUrl: "https://context7.com/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/context7",
};

const HUGGINGFACE: MarketplacePluginDetail = {
  id: "plugin-huggingface",
  slug: "huggingface",
  name: "Hugging Face",
  tagline: "Models, datasets and papers on the Hub",
  description:
    "Hugging Face lets agents search models, datasets, Spaces, collections and papers on the Hugging Face Hub, read model cards and repository files, preview datasets, and search the Hugging Face documentation. It uses public Hub data and needs no account and no key. The tools only read: agents cannot create repositories or run jobs.",
  category: "research",
  creatorName: "Hugging Face",
  iconUrl: "https://huggingface.co/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-models", text: "Find small open models for speech recognition on Hugging Face." },
    { id: "prompt-papers", text: "Which papers are trending on Hugging Face today?" },
    { id: "prompt-dataset", text: "Find a dataset of weather time series and show its columns." },
  ],
  apps: [
    {
      id: "app-huggingface-mcp",
      name: "Hugging Face",
      description: "Model, dataset, Space, paper, and docs search, over Hugging Face's MCP server with no sign-in.",
      iconUrl: "https://huggingface.co/favicon.ico",
      server: { name: "huggingface", transport: "http", url: "https://huggingface.co/mcp" },
    },
  ],
  skills: [],
  websiteUrl: "https://huggingface.co",
  privacyPolicyUrl: "https://huggingface.co/privacy",
  termsUrl: "https://huggingface.co/terms-of-service",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/huggingface",
};

const STRIPE: MarketplacePluginDetail = {
  id: "plugin-stripe",
  slug: "stripe",
  name: "Stripe",
  tagline: "Payments and billing review",
  description:
    "Stripe lets agents look up payments, customers, and invoices, and draft payment links, in the account the signed-in user can reach. Each user signs in to their own Stripe account through the browser.",
  category: "other",
  creatorName: "Stripe",
  iconUrl: "https://stripe.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-payment", text: "Look up this payment and explain why it failed." },
    { id: "prompt-customer", text: "Summarize this customer's invoices and outstanding balance." },
    { id: "prompt-link", text: "Draft a payment link for the Pro plan at 49 per month." },
  ],
  apps: [
    {
      id: "app-stripe-mcp",
      name: "Stripe",
      description: "Payment, customer, and invoice lookup, over Stripe's MCP server with browser sign-in.",
      iconUrl: "https://stripe.com/favicon.ico",
      server: {
        name: "stripe",
        transport: "http",
        url: "https://mcp.stripe.com",
        auth: [{ id: "stripe-oauth", kind: "link", label: "Sign in" }],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://stripe.com",
  privacyPolicyUrl: "https://stripe.com/privacy",
  termsUrl: "https://stripe.com/ssa",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/stripe",
};

const POSTHOG: MarketplacePluginDetail = {
  id: "plugin-posthog",
  slug: "posthog",
  name: "PostHog",
  tagline: "Product analytics and flags",
  description:
    "PostHog lets agents query events and funnels, inspect feature flags, and summarize what changed after a release. A personal API key from the project settings goes into one Authorization header.",
  category: "data-analytics",
  creatorName: "PostHog",
  iconUrl: "https://app.posthog.com/static/icons/apple-touch-icon.png",
  version: "1.0.0",
  prompts: [
    { id: "prompt-funnel", text: "How does the signup funnel look for the last 14 days?" },
    { id: "prompt-flag", text: "Which feature flags are enabled for this user?" },
    { id: "prompt-release", text: "Did activation change after last week's release?" },
  ],
  apps: [
    {
      id: "app-posthog-mcp",
      name: "PostHog",
      description: "Event, funnel, and feature-flag access, over PostHog's MCP server with a personal API key.",
      iconUrl: "https://app.posthog.com/static/icons/apple-touch-icon.png",
      server: {
        name: "posthog",
        transport: "http",
        url: "https://mcp.posthog.com/mcp",
        auth: [
          {
            id: "posthog-key",
            kind: "key",
            label: "Personal API key",
            fields: [
              {
                id: "token",
                label: "Personal API key",
                header: "Authorization",
                prefix: "Bearer ",
                placeholder: "phx_…",
                hint: "PostHog Project settings → Personal API keys",
              },
            ],
            docsUrl: "https://posthog.com/docs/api",
            docsLabel: "Create a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://posthog.com",
  privacyPolicyUrl: "https://posthog.com/privacy",
  termsUrl: "https://posthog.com/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/posthog",
};

const AIRTABLE: MarketplacePluginDetail = {
  id: "plugin-airtable",
  slug: "airtable",
  name: "Airtable",
  tagline: "Bases and records",
  description:
    "Airtable lets agents list bases, read and update records, and summarize table contents. An API key from the account page is passed to the local server as one environment variable.",
  category: "data-analytics",
  creatorName: "Airtable",
  iconUrl: "https://static.airtable.com/images/favicon/baymax/apple-touch-icon.png",
  version: "1.0.1",
  prompts: [
    { id: "prompt-bases", text: "What bases do I have access to?" },
    { id: "prompt-records", text: "Summarize the launch tracker table." },
    { id: "prompt-update", text: "Mark the shipped features as done in the roadmap base." },
  ],
  apps: [
    {
      id: "app-airtable-mcp",
      name: "Airtable",
      description: "Base listing and record access, over a local MCP server with an Airtable API key.",
      iconUrl: "https://static.airtable.com/images/favicon/baymax/apple-touch-icon.png",
      server: {
        name: "airtable",
        transport: "stdio",
        command: "npx",
        args: ["-y", "airtable-mcp-server"],
        auth: [
          {
            id: "airtable-key",
            kind: "key",
            label: "API key",
            fields: [{ id: "token", label: "API key", env: "AIRTABLE_API_KEY", hint: "Airtable account page → API" }],
            docsUrl: "https://airtable.com/developers/web/api/introduction",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.airtable.com",
  privacyPolicyUrl: "https://www.airtable.com/privacy",
  termsUrl: "https://www.airtable.com/tos",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/airtable",
};

const FIRECRAWL: MarketplacePluginDetail = {
  id: "plugin-firecrawl",
  slug: "firecrawl",
  name: "Firecrawl",
  tagline: "Web extraction and search",
  description:
    "Firecrawl lets agents scrape pages, extract structured data, and search the web through one API. An API key from the Firecrawl dashboard is passed to the local server as one environment variable.",
  category: "research",
  creatorName: "Firecrawl",
  iconUrl: "https://www.firecrawl.dev/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-scrape", text: "Extract the pricing table from this page as structured data." },
    { id: "prompt-research", text: "Research competitor pricing and cite each source page." },
    { id: "prompt-monitor", text: "What changed on our changelog page this month?" },
  ],
  apps: [
    {
      id: "app-firecrawl-mcp",
      name: "Firecrawl",
      description: "Page scraping, extraction, and web search, over a local MCP server with a Firecrawl API key.",
      iconUrl: "https://www.firecrawl.dev/favicon.ico",
      server: {
        name: "firecrawl",
        transport: "stdio",
        command: "npx",
        args: ["-y", "firecrawl-mcp"],
        auth: [
          {
            id: "firecrawl-key",
            kind: "key",
            label: "API key",
            fields: [
              {
                id: "token",
                label: "API key",
                env: "FIRECRAWL_API_KEY",
                prefix: "",
                hint: "Firecrawl dashboard → API keys",
              },
            ],
            docsUrl: "https://docs.firecrawl.dev",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://www.firecrawl.dev",
  privacyPolicyUrl: "https://www.firecrawl.dev/privacy",
  termsUrl: "https://www.firecrawl.dev/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/firecrawl",
};

const BRAVE_SEARCH: MarketplacePluginDetail = {
  id: "plugin-brave-search",
  slug: "brave-search",
  name: "Brave Search",
  tagline: "Private web search",
  description:
    "Brave Search lets agents search the web and local results without tracking. An API key from the Brave Search API dashboard is passed to the local server as one environment variable.",
  category: "research",
  creatorName: "Brave",
  iconUrl: "https://brave.com/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-search", text: "What are reviewers saying about this framework version?" },
    { id: "prompt-news", text: "Find today's announcements for this product area." },
    { id: "prompt-compare", text: "Compare these two vendors with cited sources." },
  ],
  apps: [
    {
      id: "app-brave-search-mcp",
      name: "Brave Search",
      description: "Web and local search, over a local MCP server with a Brave API key.",
      iconUrl: "https://brave.com/favicon.ico",
      server: {
        name: "brave-search",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@brave/brave-search-mcp-server"],
        auth: [
          {
            id: "brave-key",
            kind: "key",
            label: "API key",
            fields: [
              { id: "token", label: "API key", env: "BRAVE_API_KEY", hint: "Brave Search API dashboard → API keys" },
            ],
            docsUrl: "https://brave.com/search/api/",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://brave.com",
  privacyPolicyUrl: "https://brave.com/privacy/",
  termsUrl: "https://brave.com/terms-of-use/",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/brave-search",
};

const RESEND: MarketplacePluginDetail = {
  id: "plugin-resend",
  slug: "resend",
  name: "Resend",
  tagline: "Transactional email",
  description:
    "Resend lets agents send transactional email and check delivery through one API. An API key from the Resend dashboard is passed to the local server as one environment variable.",
  category: "automation",
  creatorName: "Resend",
  iconUrl: "https://resend.com/static/favicons/favicon.ico",
  version: "1.0.0",
  prompts: [
    { id: "prompt-send", text: "Send the launch announcement draft to the beta list." },
    { id: "prompt-status", text: "Did the invoice email reach the customer?" },
    { id: "prompt-template", text: "Draft a password-reset email for the new flow." },
  ],
  apps: [
    {
      id: "app-resend-mcp",
      name: "Resend",
      description: "Email sending and delivery checks, over a local MCP server with a Resend API key.",
      iconUrl: "https://resend.com/static/favicons/favicon.ico",
      server: {
        name: "resend",
        transport: "stdio",
        command: "npx",
        args: ["-y", "resend-mcp"],
        auth: [
          {
            id: "resend-key",
            kind: "key",
            label: "API key",
            fields: [
              { id: "token", label: "API key", env: "RESEND_API_KEY", prefix: "", hint: "Resend dashboard → API keys" },
            ],
            docsUrl: "https://resend.com/docs/dashboard/api-keys/introduction",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://resend.com",
  privacyPolicyUrl: "https://resend.com/legal/privacy-policy",
  termsUrl: "https://resend.com/legal/terms",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/resend",
};

const COMPOSIO: MarketplacePluginDetail = {
  id: "plugin-composio",
  slug: "composio",
  name: "Composio",
  tagline: "Many apps through your own Composio link",
  description:
    "Composio connects agents to Gmail, Slack, GitHub, and hundreds of other apps through one MCP server. Connect the apps you want in your Composio account, then paste its MCP URL and API key here.",
  category: "automation",
  creatorName: "Composio",
  iconUrl: "https://composio.dev/favicon.ico",
  version: "1.1.0",
  prompts: [
    { id: "prompt-inbox", text: "Summarize my unread email and draft replies to the urgent ones." },
    { id: "prompt-handoff", text: "Post a summary of this pull request to our team channel." },
    { id: "prompt-apps", text: "Which apps and actions can you use through Composio?" },
  ],
  apps: [
    {
      id: "app-composio-mcp",
      name: "Composio",
      description: "The apps you add to your Composio MCP server, over the link from your Composio account.",
      iconUrl: "https://composio.dev/favicon.ico",
      server: {
        name: "composio",
        transport: "http",
        url: "https://composio.dev/",
        auth: [
          {
            id: "composio-link",
            kind: "key",
            label: "MCP link",
            fields: [
              {
                id: "url",
                label: "MCP URL",
                url: true,
                placeholder: "https://connect.composio.dev/mcp",
                hint: "The URL of an MCP server in your Composio account",
              },
              {
                id: "api-key",
                label: "API key",
                header: "x-consumer-api-key",
                placeholder: "ck_…",
                hint: "Find it in your Composio account, in Settings > Sessions & API Key.",
              },
            ],
            docsUrl: "https://docs.composio.dev/kb/guide/consumer-project-boundaries-and-auth-selection",
            docsLabel: "Get a key",
          },
        ],
      },
    },
  ],
  skills: [],
  websiteUrl: "https://composio.dev",
  privacyPolicyUrl: "https://composio.dev/privacy-policy",
  termsUrl: "https://composio.dev/terms-of-service",
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/composio",
};

const PSTACK: MarketplacePluginDetail = {
  id: "plugin-pstack",
  slug: "pstack",
  name: "PSTACK",
  tagline: "52 working-method skills for engineering, writing and thinking",
  description:
    "PSTACK is a pack of working methods: sketch before code, prove it works, attack the premise, subtract before you add. Each skill teaches one discipline an agent applies on request or on its own — architect, tdd, unslop, technical-writing, and the full set of principles. Install once; every skill lands in the agent's workspace as its own folder.",
  category: "productivity",
  creatorName: "OpenBot",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-architect", text: "Architect this feature before writing any code." },
    { id: "prompt-unslop", text: "Review this UI copy with the unslop skill and rewrite the slop." },
    { id: "prompt-principle", text: "Use the subtract-before-you-add principle to shrink this module." },
  ],
  apps: [],
  skills: [
    {
      id: "preset-pstack",
      slug: "pstack",
      name: "PSTACK",
      description: "52 working-method skills: architect, tdd, unslop, technical-writing and the principle set.",
    },
  ],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/pstack",
};

const SUPERPOWERS: MarketplacePluginDetail = {
  id: "plugin-superpowers",
  slug: "superpowers",
  name: "Superpowers",
  tagline: "14 engineering-method skills: brainstorming, TDD, debugging, planning",
  description:
    "The well-known Superpowers collection: brainstorm before building, test-driven development, systematic debugging, writing plans, subagent-driven work and more. Each skill is one discipline the agent applies on request.",
  category: "coding",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-superpowers-1", text: "Brainstorm approaches for this feature before writing code." },
    { id: "prompt-superpowers-2", text: "Use test-driven development for this module." },
    { id: "prompt-superpowers-3", text: "Debug this failure systematically, not by guessing." },
  ],
  apps: [],
  skills: [{ id: "preset-superpowers", slug: "superpowers", name: "Superpowers", description: "14 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/superpowers",
};

const DOCUMENTS: MarketplacePluginDetail = {
  id: "plugin-documents",
  slug: "documents",
  name: "Documents",
  tagline: "Create and edit DOCX, XLSX, PPTX and text documents",
  description:
    "Office-document skills: produce and revise Word, Excel and PowerPoint files, and work with plain text documents, following format conventions that survive real editors.",
  category: "documents",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-documents-1", text: "Draft a project one-pager as a Word document." },
    { id: "prompt-documents-2", text: "Turn this table into an Excel sheet with formulas." },
  ],
  apps: [],
  skills: [{ id: "preset-documents", slug: "documents", name: "Documents", description: "2 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/documents",
};

const PDF: MarketplacePluginDetail = {
  id: "plugin-pdf",
  slug: "pdf",
  name: "PDF",
  tagline: "Extract, merge, split and generate PDF files",
  description:
    "PDF skills for pulling text and tables out of PDFs, merging and splitting documents, and generating PDFs from structured content.",
  category: "documents",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-pdf-1", text: "Extract every table from this PDF into markdown." },
    { id: "prompt-pdf-2", text: "Merge these three reports into one PDF." },
  ],
  apps: [],
  skills: [{ id: "preset-pdf", slug: "pdf", name: "PDF", description: "2 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/pdf",
};

const SPREADSHEETS: MarketplacePluginDetail = {
  id: "plugin-spreadsheets",
  slug: "spreadsheets",
  name: "Spreadsheets",
  tagline: "Build and audit spreadsheets with formulas and charts",
  description:
    "Spreadsheet skills: model data, write formulas that survive editing, and audit a workbook for broken references and inconsistent ranges.",
  category: "data-analytics",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-spreadsheets-1", text: "Build a budget spreadsheet with monthly rollups." },
    { id: "prompt-spreadsheets-2", text: "Audit this workbook for broken formulas." },
  ],
  apps: [],
  skills: [{ id: "preset-spreadsheets", slug: "spreadsheets", name: "Spreadsheets", description: "2 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/spreadsheets",
};

const PRESENTATIONS: MarketplacePluginDetail = {
  id: "plugin-presentations",
  slug: "presentations",
  name: "Presentations",
  tagline: "Compose slide decks with clean structure and layout",
  description:
    "Presentation skills: outline a story, lay out slides, and produce a deck that reads well on a screen instead of a wall of bullets.",
  category: "documents",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-presentations-1", text: "Turn this design doc into a 10-slide deck." },
    { id: "prompt-presentations-2", text: "Rebuild these slides with a cleaner narrative." },
  ],
  apps: [],
  skills: [{ id: "preset-presentations", slug: "presentations", name: "Presentations", description: "2 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/presentations",
};

const SKILL_CREATOR: MarketplacePluginDetail = {
  id: "plugin-skill-creator",
  slug: "skill-creator",
  name: "Skill Creator",
  tagline: "Design and package new agent skills from scratch",
  description:
    "Walks the agent through creating a new skill: naming, frontmatter, structure and packaging, so the skills you author install cleanly anywhere.",
  category: "automation",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-skill-creator-1", text: "Create a skill that reviews pull-request descriptions." }],
  apps: [],
  skills: [{ id: "preset-skill-creator", slug: "skill-creator", name: "Skill Creator", description: "1 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/skill-creator",
};

const VISUALIZE: MarketplacePluginDetail = {
  id: "plugin-visualize",
  slug: "visualize",
  name: "Visualize",
  tagline: "Interactive visualizations and exploratory graphics",
  description:
    "Visualization skills for turning data and ideas into interactive charts, maps and simulations that run in the browser.",
  category: "design",
  creatorName: "Z.ai",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-visualize-1", text: "Visualize this dataset as an interactive chart." }],
  apps: [],
  skills: [{ id: "preset-visualize", slug: "visualize", name: "Visualize", description: "1 skills" }],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/visualize",
};

const ANTHROPIC_WEB: MarketplacePluginDetail = {
  id: "plugin-anthropic-web",
  slug: "anthropic-web",
  name: "Web Builder (Anthropic)",
  tagline: "Frontend design, artifact building and web-app testing from Anthropic",
  description:
    "Three production skills from Anthropic: frontend-design shapes distinctive interfaces, web-artifacts-builder ships polished single-page artifacts, and webapp-testing drives a real browser to verify what was built.",
  category: "coding",
  creatorName: "Anthropic",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-anthropic-web-1", text: "Design a landing page with a distinctive editorial look." },
    { id: "prompt-anthropic-web-2", text: "Build this idea as a polished single-file web artifact." },
    { id: "prompt-anthropic-web-3", text: "Test this web app end to end in a real browser." },
  ],
  apps: [],
  skills: [
    { id: "preset-anthropic-web", slug: "anthropic-web", name: "Web Builder (Anthropic)", description: "3 skills" },
  ],
  websiteUrl: "https://github.com/anthropics/skills",
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: true,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/anthropic-web",
};

const ANTHROPIC_MCP_BUILDER: MarketplacePluginDetail = {
  id: "plugin-anthropic-mcp-builder",
  slug: "anthropic-mcp-builder",
  name: "MCP Builder (Anthropic)",
  tagline: "Build high-quality MCP servers that agents can actually use",
  description:
    "Anthropic's guide-skill for creating Model Context Protocol servers: tool design, schema hygiene, and the integration patterns that make servers pleasant for agents to call.",
  category: "coding",
  creatorName: "Anthropic",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-anthropic-mcp-builder-1", text: "Design an MCP server for our internal project tracker." }],
  apps: [],
  skills: [
    {
      id: "preset-anthropic-mcp-builder",
      slug: "anthropic-mcp-builder",
      name: "MCP Builder (Anthropic)",
      description: "1 skills",
    },
  ],
  websiteUrl: "https://github.com/anthropics/skills",
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/anthropic-mcp-builder",
};

const ANTHROPIC_CREATIVE: MarketplacePluginDetail = {
  id: "plugin-anthropic-creative",
  slug: "anthropic-creative",
  name: "Creative Studio (Anthropic)",
  tagline: "Generative art, canvas design, theme systems and GIF creation",
  description:
    "Four creative skills from Anthropic: algorithmic-art generates art from code, canvas-design composes visual artwork, theme-factory builds consistent color and type themes, and slack-gif-creator makes animated reactions.",
  category: "design",
  creatorName: "Anthropic",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-anthropic-creative-1", text: "Create generative art for this album cover." },
    { id: "prompt-anthropic-creative-2", text: "Design a theme for our product from our logo colors." },
  ],
  apps: [],
  skills: [
    {
      id: "preset-anthropic-creative",
      slug: "anthropic-creative",
      name: "Creative Studio (Anthropic)",
      description: "4 skills",
    },
  ],
  websiteUrl: "https://github.com/anthropics/skills",
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/anthropic-creative",
};

const ANTHROPIC_COMMS: MarketplacePluginDetail = {
  id: "plugin-anthropic-comms",
  slug: "anthropic-comms",
  name: "Comms & Brand (Anthropic)",
  tagline: "Internal comms, document co-authoring and brand guidelines",
  description:
    "Communication skills from Anthropic: internal-comms drafts announcements and updates, doc-coauthoring runs a real co-writing process, and brand-guidelines keeps output on-brand.",
  category: "documents",
  creatorName: "Anthropic",
  iconUrl: null,
  version: "1.0.0",
  prompts: [
    { id: "prompt-anthropic-comms-1", text: "Draft a launch announcement for the whole company." },
    { id: "prompt-anthropic-comms-2", text: "Co-author this blog post with me, section by section." },
  ],
  apps: [],
  skills: [
    {
      id: "preset-anthropic-comms",
      slug: "anthropic-comms",
      name: "Comms & Brand (Anthropic)",
      description: "3 skills",
    },
  ],
  websiteUrl: "https://github.com/anthropics/skills",
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/anthropic-comms",
};

const ANTHROPIC_CLAUDE_API: MarketplacePluginDetail = {
  id: "plugin-anthropic-claude-api",
  slug: "anthropic-claude-api",
  name: "Claude API (Anthropic)",
  tagline: "Write correct code against the Claude API",
  description:
    "Anthropic's reference skill for integrating with the Claude API: model names, streaming, tool use, and the error handling that production code needs.",
  category: "coding",
  creatorName: "Anthropic",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-anthropic-claude-api-1", text: "Write a streaming chat client against the Claude API." }],
  apps: [],
  skills: [
    {
      id: "preset-anthropic-claude-api",
      slug: "anthropic-claude-api",
      name: "Claude API (Anthropic)",
      description: "1 skills",
    },
  ],
  websiteUrl: "https://github.com/anthropics/skills",
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/anthropic-claude-api",
};

const MCP_EVERYTHING: MarketplacePluginDetail = {
  id: "plugin-mcp-everything",
  slug: "mcp-everything",
  name: "Everything",
  tagline: "The everything test server: tools, resources and prompts for verifying an MCP connection",
  description:
    "The everything test server: tools, resources and prompts for verifying an MCP connection. Runs locally via npx, no credentials needed.",
  category: "other",
  creatorName: "Model Context Protocol",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-mcp-everything-1", text: "List the tools this MCP server offers and try one." }],
  apps: [
    {
      id: "app-mcp-everything",
      name: "Everything",
      description: "The everything test server: tools, resources and prompts for verifying an MCP connection.",
      iconUrl: null,
      server: {
        name: "mcp-everything",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
  ],
  skills: [],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/mcp-everything",
};

const MCP_MEMORY: MarketplacePluginDetail = {
  id: "plugin-mcp-memory",
  slug: "mcp-memory",
  name: "Memory",
  tagline: "Persistent knowledge-graph memory for your agents",
  description: "Persistent knowledge-graph memory for your agents. Runs locally via npx, no credentials needed.",
  category: "other",
  creatorName: "Model Context Protocol",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-mcp-memory-1", text: "List the tools this MCP server offers and try one." }],
  apps: [
    {
      id: "app-mcp-memory",
      name: "Memory",
      description: "Persistent knowledge-graph memory for your agents.",
      iconUrl: null,
      server: {
        name: "mcp-memory",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
    },
  ],
  skills: [],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/mcp-memory",
};

const MCP_SEQUENTIAL_THINKING: MarketplacePluginDetail = {
  id: "plugin-mcp-sequential-thinking",
  slug: "mcp-sequential-thinking",
  name: "Sequential Thinking",
  tagline: "Structured step-by-step reasoning for complex problems",
  description: "Structured step-by-step reasoning for complex problems. Runs locally via npx, no credentials needed.",
  category: "automation",
  creatorName: "Model Context Protocol",
  iconUrl: null,
  version: "1.0.0",
  prompts: [{ id: "prompt-mcp-sequential-thinking-1", text: "List the tools this MCP server offers and try one." }],
  apps: [
    {
      id: "app-mcp-sequential-thinking",
      name: "Sequential Thinking",
      description: "MCP 结构化思维服务器:把复杂问题拆成可反思的分步推理",
      iconUrl: null,
      server: {
        name: "mcp-sequential-thinking",
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      },
    },
  ],
  skills: [],
  websiteUrl: null,
  privacyPolicyUrl: null,
  termsUrl: null,
  installs: 0,
  featured: false,
  updatedAt: "2026-09-30T00:00:00.000Z",
  shareUrl: "https://openbot.run/plugins/mcp-sequential-thinking",
};

export const MARKETPLACE_PLUGINS: MarketplacePluginDetail[] = [
  AAVE,
  CANVA,
  LINEAR,
  NOTION,
  OBSIDIAN,
  ATLASSIAN,
  TODOIST,
  COBRAIN,
  FIGMA,
  PAPER,
  APPLE_APPS,
  SENTRY,
  VERCEL,
  CLOUDFLARE,
  SUPABASE,
  NEON,
  PRISMA,
  NETLIFY,
  RAILWAY,
  CONTEXT7,
  HUGGINGFACE,
  STRIPE,
  POSTHOG,
  AIRTABLE,
  FIRECRAWL,
  BRAVE_SEARCH,
  RESEND,
  COMPOSIO,
  PSTACK,
  SUPERPOWERS,
  DOCUMENTS,
  PDF,
  SPREADSHEETS,
  PRESENTATIONS,
  SKILL_CREATOR,
  VISUALIZE,
  ANTHROPIC_WEB,
  ANTHROPIC_MCP_BUILDER,
  ANTHROPIC_CREATIVE,
  ANTHROPIC_COMMS,
  ANTHROPIC_CLAUDE_API,
  MCP_EVERYTHING,
  MCP_MEMORY,
  MCP_SEQUENTIAL_THINKING,
];
