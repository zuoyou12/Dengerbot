// The agent marketplace, local only: browsing and installing the curated agent catalog that ships
// with the app. Upstream serves the same flows from the central account API; here the catalog is
// the bundled `marketplace-agents` resource and skills install from its preset directory. There is
// no account, so nothing lists or submits an agent of one's own, and no install receipt is recorded.

import { join } from "node:path";
import type {
  InstallMarketplaceAgentInput,
  InstallMarketplaceAgentResult,
  MarketplaceAgentDetail,
  MarketplaceAgentPage,
  MarketplaceAgentQuery,
  MarketplaceAgentSummary,
} from "@openbot/contracts/ipc";
import { decodeMarketplaceAgentDetail, isAvatarHue, isReleasedRoutineSchedule, isSkillCategory } from "@openbot/contracts/ipc";
import type { AgentService } from "../backend/agent-service";
import { runCauseEffect } from "../backend/effect-boundary";
import type { SkillMarketplaceService } from "./skill-marketplace-service";
import { Effect } from "effect";

interface CatalogAgentEntry {
  readonly slug: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly avatarHue?: number | null;
  readonly skills?: readonly string[];
  readonly routines?: readonly { name: string; instruction: string; active: boolean; schedule: unknown }[];
  readonly category?: string;
  readonly featured?: boolean;
  readonly installs?: number;
  readonly updatedAt?: string;
}

interface CatalogFile {
  readonly catalogVersion: string;
  readonly agents: readonly CatalogAgentEntry[];
}

/** The interval anchor of a released schedule is a remote time; a local install anchors it at now. */
function localSchedule(schedule: unknown): unknown {
  if (
    typeof schedule === "object" &&
    schedule !== null &&
    "kind" in schedule &&
    (schedule as { kind: unknown }).kind === "interval"
  ) {
    return { ...(schedule as object), anchorAt: new Date().toISOString() };
  }
  return structuredClone(schedule);
}

export function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export class AgentMarketplaceService {
  private catalog: CatalogFile | null = null;

  constructor(
    private readonly agents: AgentService,
    private readonly skills: SkillMarketplaceService,
    private readonly catalogRoot: string,
  ) {}

  private async loadCatalog(): Promise<CatalogFile> {
    if (this.catalog) return this.catalog;
    const { readFile } = await import("node:fs/promises");
    const data = JSON.parse(await readFile(join(this.catalogRoot, "catalog.json"), "utf8")) as CatalogFile;
    if (!Array.isArray(data.agents)) throw new Error("The marketplace agent catalog is invalid.");
    this.catalog = data;
    return data;
  }

  /** A catalog entry, as the summary shape the marketplace UI reads. */
  private toSummary(entry: CatalogAgentEntry): MarketplaceAgentSummary {
    const skills = entry.skills ?? [];
    const routines = entry.routines ?? [];
    return {
      id: entry.slug,
      name: entry.name,
      title: entry.title,
      description: entry.description,
      creatorName: "",
      category: isSkillCategory(entry.category) ? entry.category : undefined,
      version: 1,
      installs: entry.installs ?? 0,
      featured: entry.featured ?? false,
      // The seed pattern only allows lowercase ids, which a catalog slug always is.
      avatarSeed: entry.slug.toLowerCase(),
      avatarHue: entry.avatarHue !== null && entry.avatarHue !== undefined && isAvatarHue(entry.avatarHue) ? entry.avatarHue : null,
      avatarUrl: null,
      skillCount: skills.length,
      routineCount: routines.length,
      activeRoutineCount: routines.filter((routine) => routine.active).length,
      updatedAt: entry.updatedAt ?? new Date(0).toISOString(),
    };
  }

  private toDetail(entry: CatalogAgentEntry, catalogVersion: string): MarketplaceAgentDetail {
    const routines = (entry.routines ?? []).filter((routine) => isReleasedRoutineSchedule(routine.schedule));
    return decodeMarketplaceAgentDetail({
      ...this.toSummary(entry),
      versionId: `${entry.slug}@${catalogVersion}`,
      skills: (entry.skills ?? []).map((slug) => ({
        skillId: slug,
        versionId: `${slug}@${catalogVersion}`,
        slug,
        name: slug,
        version: 1,
      })),
      routines: routines.map((routine) => ({
        name: routine.name,
        instruction: routine.instruction,
        active: routine.active,
        schedule: routine.schedule,
      })),
    });
  }

  async list(query: MarketplaceAgentQuery = {}): Promise<MarketplaceAgentPage> {
    const catalog = await this.loadCatalog();
    const text = query.query?.trim().toLowerCase();
    const matched = catalog.agents.filter((entry) => {
      if (query.category && entry.category !== query.category) return false;
      if (query.featured && !entry.featured) return false;
      if (!text) return true;
      return `${entry.name} ${entry.title} ${entry.description}`.toLowerCase().includes(text);
    });
    const sorted =
      query.sort === "installs"
        ? [...matched].sort((left, right) => (right.installs ?? 0) - (left.installs ?? 0))
        : matched;
    const start = query.cursor ? Number(query.cursor) : 0;
    const limit = query.limit ?? 50;
    return {
      agents: sorted.slice(start, start + limit).map((entry) => this.toSummary(entry)),
      nextCursor: start + limit < sorted.length ? String(start + limit) : null,
    };
  }

  /** The catalog holds one version of each agent, so the listing is the entry itself. */
  async get(listingId: string): Promise<MarketplaceAgentDetail | undefined> {
    const catalog = await this.loadCatalog();
    const entry = catalog.agents.find((candidate) => candidate.slug === listingId);
    return entry ? this.toDetail(entry, catalog.catalogVersion) : undefined;
  }

  async getListing(listingId: string): Promise<MarketplaceAgentDetail | undefined> {
    return this.get(listingId);
  }

  async listMine(): Promise<never> {
    throw new Error("There is no agent account in this build.");
  }

  async submit(): Promise<never> {
    throw new Error("There is no agent account in this build.");
  }

  async install(input: InstallMarketplaceAgentInput): Promise<InstallMarketplaceAgentResult> {
    if (!validTimezone(input.timezone)) throw new Error("The timezone of the install request is not valid.");
    const detail = await this.getListing(input.listingId);
    if (!detail) throw new Error(`No marketplace agent matches ${input.listingId}.`);
    const existing = input.agentId
      ? this.agents.listAgents().find((candidate) => candidate.id === input.agentId)
      : undefined;
    if (input.agentId && !existing) throw new Error("The installed agent to update is gone.");
    if (existing?.marketplaceSource?.listingId !== detail.id) {
      if (existing) throw new Error("The installed agent came from a different listing.");
    }
    if (existing?.marketplaceSource?.versionId === detail.versionId) return { agent: existing as never };

    let agent =
      existing ??
      (await runCauseEffect(
        this.agents.createAgentProfile({
          name: detail.name,
          title: detail.title,
          description: detail.description,
          avatarSeed: detail.avatarSeed,
          avatarHue: detail.avatarHue,
        }),
      ));
    const createdRoutineIds: string[] = [];
    try {
      for (const skill of detail.skills) {
        await runCauseEffect(
          this.skills
            .installPreset({ agentId: agent.id, pluginSlug: skill.slug }, join(this.catalogRoot, "skills"))
            .pipe(Effect.mapError((cause) => ({ cause }))),
        );
      }
      for (const routine of detail.routines) {
        const created = this.agents.createRoutine({
          agentId: agent.id,
          name: routine.name,
          instruction: routine.instruction,
          active: routine.active,
          timezone: input.timezone,
          schedule: localSchedule(routine.schedule) as never,
        });
        createdRoutineIds.push(created.id);
      }
      if (existing) {
        agent = await runCauseEffect(
          this.agents
            .updateAgent({
              agentId: agent.id,
              name: detail.name,
              title: detail.title,
              description: detail.description,
              avatarSeed: detail.avatarSeed,
              avatarHue: detail.avatarHue,
            })
            .pipe(Effect.mapError((cause) => ({ cause }))),
        );
      }
      const nextSkillIds = new Set(detail.skills.map((skill) => skill.skillId));
      for (const skillId of existing?.marketplaceSource?.skillIds ?? []) {
        if (!nextSkillIds.has(skillId)) {
          await runCauseEffect(
            this.skills.uninstall({ agentId: agent.id, skillId }).pipe(Effect.mapError((cause) => ({ cause }))),
          ).catch(() => undefined);
        }
      }
      const saved = this.agents.setMarketplaceSource(agent.id, {
        listingId: detail.id,
        versionId: detail.versionId,
        version: detail.version,
        skillIds: [...nextSkillIds],
        routineIds: createdRoutineIds,
      });
      agent = { ...agent, marketplaceSource: saved.marketplaceSource };
      for (const routineId of existing?.marketplaceSource?.routineIds ?? []) {
        await runCauseEffect(
          this.agents.deleteRoutine({ agentId: agent.id, routineId }).pipe(Effect.mapError((cause) => ({ cause }))),
        ).catch(() => undefined);
      }
    } catch (error) {
      if (!existing) {
        await runCauseEffect(this.agents.deleteAgent(agent.id)).catch(() => undefined);
      } else {
        for (const routineId of createdRoutineIds) {
          await runCauseEffect(
            this.agents.deleteRoutine({ agentId: agent.id, routineId }).pipe(Effect.mapError((cause) => ({ cause }))),
          ).catch(() => undefined);
        }
      }
      throw error;
    }
    // No install receipt: there is no central server to count installs in this build.
    return { agent: agent as never };
  }
}
