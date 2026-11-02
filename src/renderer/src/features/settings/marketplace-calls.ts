import type {
  AddedAgent,
  InstalledSkill,
  InstallMarketplaceAgentInput,
  MarketplaceAgentDetail,
  MarketplaceAgentPage,
  MarketplaceSkillDetail,
  MarketplaceSkillPage,
  MarketplaceSkillQuery,
  MarketplaceSkillSummary,
} from "@openbot/contracts/ipc";
import { appPort } from "../../app-port";
import { type AgentSkillCalls, agentSkillCalls, type SkillCatalogCalls, type SkillsPort, skillsPort } from "../../skills-port";
import { MARKETPLACE_PLUGINS } from "./marketplace-plugin-catalog";

/**
 * What the marketplace calls.
 *
 * The central marketplace catalog that served the skill listings is not part of this build, so
 * `skills` reads the curated catalog that ships with the app: a skill listing here is a bundled
 * preset pack, which installs through `installPackSkills`; the controller routes the install by
 * the absent `versionId` that every pack carries. `agents` reads the curated agent catalog main
 * serves offline, and installs from it through `marketplaceAgents.install`.
 */
export interface MarketplaceCalls {
  skills: {
    get(id: string): Promise<MarketplaceSkillDetail | undefined>;
    list(query: MarketplaceSkillQuery): Promise<MarketplaceSkillPage>;
    installPackSkills(input: { agentId: string; pluginSlug: string }): Promise<InstalledSkill>;
  };
  agents: {
    get(id: string): Promise<MarketplaceAgentDetail | undefined>;
    list(query: MarketplaceSkillQuery): Promise<MarketplaceAgentPage>;
  };
  agentSkills: (hostServerId?: string) => AgentSkillCalls;
  mcp: Pick<SkillsPort["agent"], "listMcpServers" | "removeMcpServer" | "saveMcpServer" | "testMcpServer">;
  /** `serverId` absent: this computer, which is also the only place an installed agent is updated. */
  addAgent: (input: InstallMarketplaceAgentInput, serverId: string | undefined) => Promise<AddedAgent>;
  openUrl: (url: string) => Promise<void>;
}

/** The bundled preset packs, as skill listings. The id matches what an install reports. */
const PACK_LISTINGS: readonly MarketplaceSkillSummary[] = MARKETPLACE_PLUGINS.filter(
  (plugin) => plugin.skills.length > 0,
).map((plugin) => ({
  id: `preset-${plugin.slug}`,
  slug: plugin.skills[0]?.slug ?? plugin.slug,
  name: plugin.name,
  description: plugin.description,
  category: plugin.category,
  creatorName: plugin.creatorName,
  version: 1,
  installs: plugin.installs,
  featured: plugin.featured,
  iconUrl: plugin.iconUrl,
  updatedAt: plugin.updatedAt,
}));

function packDetail(listing: MarketplaceSkillSummary): MarketplaceSkillDetail {
  const plugin = MARKETPLACE_PLUGINS.find(
    (candidate) => candidate.slug === listing.slug || `preset-${candidate.slug}` === listing.id,
  );
  return {
    ...listing,
    versionId: "",
    bundleSha256: "",
    files: [],
    instructions: plugin?.description ?? listing.description,
    examplePrompt: plugin?.prompts[0]?.text,
  };
}

function packPage(query: MarketplaceSkillQuery): MarketplaceSkillPage {
  const text = query.query?.trim().toLowerCase();
  const matched = PACK_LISTINGS.filter((listing) => {
    if (query.category && listing.category !== query.category) return false;
    if (query.featured && !listing.featured) return false;
    if (!text) return true;
    return `${listing.name} ${listing.description}`.toLowerCase().includes(text);
  });
  const sorted =
    query.sort === "installs" ? [...matched].sort((left, right) => right.installs - left.installs) : matched;
  const start = query.cursor ? Number(query.cursor) : 0;
  const limit = query.limit ?? 50;
  const page = sorted.slice(start, start + limit);
  const next = start + limit;
  return { skills: page, nextCursor: next < sorted.length ? String(next) : null };
}

/** Read on each call, as `skillsPort` is: tests and stories replace `window.openbot` per case. */
export function desktopMarketplaceCalls(): MarketplaceCalls {
  const port = skillsPort();
  return {
    skills: {
      get: async (id) => {
        const listing = PACK_LISTINGS.find((candidate) => candidate.id === id);
        return listing ? packDetail(listing) : undefined;
      },
      list: async (query) => packPage(query),
      installPackSkills: (input) => port.skills.installPreset(input),
    },
    agents: {
      get: (id) => port.marketplaceAgents.get(id),
      list: (query) => port.marketplaceAgents.list(query),
    },
    agentSkills: agentSkillCalls,
    mcp: port.agent,
    addAgent: async (input, serverId) => {
      // A joined server installs and updates its agents on its host, which this build does not
      // serve; the marketplace only adds an agent on this computer.
      if (serverId) throw new Error("Marketplace agents are not available on a joined server in this build.");
      return (await port.marketplaceAgents.install(input)).agent;
    },
    openUrl: (url) => appPort().openUrl(url),
  };
}

/** The marketplace catalog as the skills dialog reads it: a missing entry throws. */
export function desktopSkillCatalog(): SkillCatalogCalls {
  const calls = desktopMarketplaceCalls();
  return {
    get: async (id) => {
      const detail = await calls.skills.get(id);
      if (!detail) throw new Error(`No marketplace skill matches ${id}.`);
      return detail;
    },
    list: (query) => calls.skills.list(query),
  };
}
