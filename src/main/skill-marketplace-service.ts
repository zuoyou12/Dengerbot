import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  AgentSummary,
  AgentTemplateSkill,
  InstalledSkill,
  InstallRemotePluginInput,
  InstallSkillInput,
  MarketplaceAgentSkill,
  MarketplaceSkillDetail,
  SetEnabledSkillInput,
  SkillPackagePreview,
  UninstallSkillInput,
} from "@openbot/contracts/ipc";
import { AGENT_TEMPLATE_LIMITS, SKILL_DESCRIPTION_MAX_LENGTH } from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema, Semaphore } from "effect";
import { parse as parseYaml } from "yaml";
import type { AgentLifecycleFailed } from "../backend/agent-service";
import { writeFileAtomically } from "../backend/atomic-json-file";
import { causeHelpers } from "../backend/effect-boundary";
import type { LocalSkillLibrary } from "./local-skill-library";
import { listManagedSkillsForChat, MANAGED_SKILL_FOLDERS, MANAGED_SKILL_SLUGS } from "./managed-skill-service";
import { listFolderSkills, listHomeFolderSkills } from "./skill-folder-discovery";
import { archiveDirectory, inspectArchive, inspectSkillMarkdown, normalizedFiles } from "./skill-package";

const DRAFT_LIFETIME_MS = 30 * 60 * 1000;
const SKILL_FOLDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

interface Draft {
  bytes: Uint8Array;
  preview: SkillPackagePreview;
  createdAt: number;
}
interface LockEntry {
  skillId: string;
  versionId?: string;
  slug: string;
  name: string;
  version: number;
  bundleSha256: string;
  receiptId: string;
  files: Record<string, string>;
  enabled?: boolean;
  description?: string;
  /** The skills of a pack, each installed as a folder of its own beside `slug`. */
  folders?: string[];
}
interface SkillsLock {
  version: 1;
  skills: Record<string, LockEntry>;
}

export class SkillMarketplaceService {
  readonly #drafts = new Map<string, Draft>();
  readonly #writes = new Map<string, { gate: Semaphore.Semaphore; users: number }>();

  constructor(
    private readonly listAgents: () => AgentSummary[],
    private readonly refreshAgentRuntime: (agentId: string) => Effect.Effect<void, AgentLifecycleFailed> = () =>
      Effect.void,
    readonly localLibrary?: LocalSkillLibrary,
  ) {}

  stage(path: string): Effect.Effect<SkillPackagePreview, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<SkillPackagePreview, SkillMarketplaceFailure> {
      this.expireDrafts();
      const stats = yield* skillIO(() => lstat(path));
      const bytes = stats.isDirectory()
        ? yield* archiveDirectory(path).pipe(Effect.mapError(({ cause }) => new SkillMarketplaceFailure({ cause })))
        : new Uint8Array(yield* skillIO(() => readFile(path)));
      const inspected = yield* skillSync(() => inspectArchive(bytes));
      const draftId = randomUUID();
      const preview = { draftId, ...inspected, size: bytes.byteLength };
      this.#drafts.set(draftId, { bytes, preview, createdAt: Date.now() });
      return preview;
    });
  }

  listInstalled(agentId: string): Effect.Effect<InstalledSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const installed: InstalledSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        // The marketplace is gone from this build, so the installed version is the only version.
        const availableVersion = entry.version;
        const state = yield* installedState(agent.workspacePath, entry);
        installed.push(
          toInstalledSkill(
            entry,
            availableVersion,
            state,
            yield* installedSkillDescription(agent.workspacePath, entry),
          ),
        );
      }
      installed.push(...(yield* listFolderSkills(agent, lockedSlugs(lock)).pipe(toSkillMarketplaceFailure)));
      return installed.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  listInstalledForChatTags(agentId: string): Effect.Effect<InstalledSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const installed: InstalledSkill[] = yield* listManagedSkillsForChat(agent).pipe(toSkillMarketplaceFailure);
      // The skills of a pack are folders of their own, so the folder scan lists them for `$<name>`.
      const parents = new Set(Object.values(lock.skills).map((entry) => entry.slug));
      for (const skill of yield* listFolderSkills(agent, parents).pipe(toSkillMarketplaceFailure))
        if (!skill.problem) installed.push(skill);
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        installed.push(
          toInstalledSkill(
            entry,
            entry.version,
            yield* installedState(agent.workspacePath, entry),
            yield* installedSkillDescription(agent.workspacePath, entry),
          ),
        );
      }
      installed.push(...(yield* listHomeFolderSkills(new Set(installed.map((skill) => skill.slug)))));
      return installed.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  install(input: InstallSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      // A pinned version is served by the versions endpoint, which a local skill has no entry in: a
      // local skill is held on this computer and has no published version to ask for.
      if (input.versionId)
        return yield* new SkillMarketplaceFailure({
          cause: new Error("The skill marketplace is not available in this build."),
        });
      if (!input.skillId.startsWith("local-skill-"))
        return yield* new SkillMarketplaceFailure({
          cause: new Error("The skill marketplace is not available in this build."),
        });
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const detail = yield* this.requireLocalLibrary().get(input.skillId).pipe(toSkillMarketplaceFailure);
      const bundle = yield* this.requireLocalLibrary()
        .bundle(input.skillId, detail.version)
        .pipe(toSkillMarketplaceFailure);
      return yield* this.installResolved(agent, detail, bundle, input.replaceModified);
    });
  }

  listPublishable(agentId: string): Effect.Effect<MarketplaceAgentSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceAgentSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const result: MarketplaceAgentSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        if (entry.skillId.startsWith("local-skill-"))
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.publishLocalFirst")) });
        result.push(yield* this.publishedReferenceEffect(agent, entry));
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /**
   * The skills an agent template carries. A marketplace skill is a reference to its exact version;
   * a local or workspace skill is its `SKILL.md` text only, never its other files.
   */

  listTemplateSkills(agentId: string): Effect.Effect<AgentTemplateSkill[], SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplateSkill[], SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(agentId));
      const lock = yield* readLock(agent.workspacePath);
      const result: AgentTemplateSkill[] = [];
      for (const entry of Object.values(lock.skills)) {
        if (entry.enabled === false) continue;
        if (entry.skillId.startsWith("local-skill-")) {
          const [directory] = targetDirectories(agent.workspacePath, entry.slug);
          result.push(yield* embeddedSkill(join(directory, "SKILL.md"), entry.name));
        } else result.push({ kind: "marketplace", ...(yield* this.publishedReferenceEffect(agent, entry)) });
      }
      for (const skill of yield* listFolderSkills(agent, lockedSlugs(lock)).pipe(toSkillMarketplaceFailure)) {
        // A managed skill without its ownership marker is still OpenBot's: every install writes its own.
        if (skill.problem || !skill.location || MANAGED_SKILL_SLUGS.has(skill.slug)) continue;
        result.push(yield* embeddedSkill(join(agent.workspacePath, skill.location, "SKILL.md"), skill.name));
      }
      // An install writes each skill to a folder named by its slug, so two skills with one slug would
      // make every install of the template fail.
      const slugs = new Set<string>();
      for (const skill of result) {
        if (slugs.has(skill.slug))
          return yield* new SkillMarketplaceFailure({
            cause: new Error(sourceText("error.skill.duplicateSlug", { slug: skill.slug })),
          });
        slugs.add(skill.slug);
      }
      return result.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  private publishedReferenceEffect(
    agent: AgentSummary,
    entry: LockEntry,
  ): Effect.Effect<MarketplaceAgentSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<MarketplaceAgentSkill, SkillMarketplaceFailure> {
      const state = yield* installedState(agent.workspacePath, entry);
      if (state !== "installed")
        return yield* new SkillMarketplaceFailure({
          cause: new Error(sourceText("error.skill.publishNeedsRepair", { name: entry.name })),
        });
      const versionId = entry.versionId;
      if (!versionId)
        return yield* new SkillMarketplaceFailure({
          cause: new Error(sourceText("error.skill.publishUntracked", { name: entry.name })),
        });
      return {
        skillId: entry.skillId,
        versionId,
        slug: entry.slug,
        name: entry.name,
        version: entry.version,
      };
    });
  }

  private serialize<A>(
    agentId: string,
    operation: Effect.Effect<A, SkillMarketplaceFailure>,
  ): Effect.Effect<A, SkillMarketplaceFailure> {
    return Effect.suspend(() => {
      const entry = this.#writes.get(agentId) ?? { gate: Semaphore.makeUnsafe(1), users: 0 };
      entry.users += 1;
      this.#writes.set(agentId, entry);
      return entry.gate.withPermit(Effect.uninterruptible(operation)).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            entry.users -= 1;
            if (entry.users === 0) this.#writes.delete(agentId);
          }),
        ),
      );
    });
  }

  private installResolved(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ) {
    return this.serialize(agent.id, this.writeResolvedEffect(agent, detail, bundle, replaceModified));
  }

  private writeResolvedEffect(
    agent: AgentSummary,
    detail: MarketplaceSkillDetail,
    bundle: Uint8Array,
    replaceModified = false,
  ): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      if (sha256(bundle) !== detail.bundleSha256)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.bundleMismatch")) });
      const archive = yield* skillSync(() => inspectArchive(bundle));
      if (archive.slug !== detail.slug)
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.metadataMismatch")) });
      const files = yield* skillSync(() => normalizedFiles(bundle));
      const children = packChildren(detail.slug, files);
      const folders = skillFolders(detail.slug, files, children);
      for (const folder of folders.keys()) yield* assertSkillPaths(agent.workspacePath, folder);
      const lock = yield* readLock(agent.workspacePath);
      const existing = lock.skills[detail.id];
      if (
        Object.values(lock.skills).some(
          (entry) => entry.skillId !== detail.id && entryFolders(entry).some((folder) => folders.has(folder)),
        )
      )
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.folderTaken")) });
      if (!existing && Object.keys(lock.skills).length >= INPUT_LIMITS.agentSkills) {
        return yield* new SkillMarketplaceFailure({
          cause: new Error(sourceText("error.skill.tooManySkills", { limit: INPUT_LIMITS.agentSkills })),
        });
      }
      if (existing) {
        const state = yield* installedState(agent.workspacePath, existing);
        if (state === "modified" && !replaceModified)
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.replaceModified")) });
      }
      const owned = new Set(Object.values(lock.skills).flatMap(entryFolders));
      for (const folder of folders.keys()) {
        if (owned.has(folder)) continue;
        for (const target of [
          ...targetDirectories(agent.workspacePath, folder),
          disabledDirectory(agent.workspacePath, folder),
        ]) {
          if (yield* pathExists(target))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.unmanagedExists", { path: target })),
            });
        }
      }
      const receiptId = existing?.receiptId ?? randomUUID();
      const stayDisabled = existing?.enabled === false;
      yield* replaceTargets(
        [...folders].flatMap(([folder, folderFiles]) =>
          (stayDisabled
            ? [disabledDirectory(agent.workspacePath, folder)]
            : targetDirectories(agent.workspacePath, folder)
          ).map((target) => ({ target, files: folderFiles })),
        ),
      );
      // A skill that a new version of the pack no longer has goes with it.
      for (const folder of existing ? entryFolders(existing) : [])
        if (!folders.has(folder)) yield* removeFolder(agent.workspacePath, folder, !stayDisabled);
      const entry: LockEntry = {
        skillId: detail.id,
        versionId: detail.versionId,
        slug: detail.slug,
        name: detail.name,
        version: detail.version,
        bundleSha256: detail.bundleSha256,
        receiptId,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])),
        description: detail.description,
        ...(stayDisabled ? { enabled: false } : {}),
        ...(children.length > 0 ? { folders: children } : {}),
      };
      lock.skills[detail.id] = entry;
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(agent.id).pipe(toSkillMarketplaceFailure);
      return toInstalledSkill(entry, detail.version, "installed", entry.description);
    });
  }

  uninstall(input: UninstallSkillInput): Effect.Effect<void, SkillMarketplaceFailure> {
    return this.serialize(input.agentId, this.removeInstalledEffect(input));
  }
  private removeInstalledEffect(input: UninstallSkillInput): Effect.Effect<void, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<void, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const lock = yield* readLock(agent.workspacePath);
      const entry = lock.skills[input.skillId];
      if (!entry) return;
      for (const folder of entryFolders(entry)) yield* assertSkillPaths(agent.workspacePath, folder);
      if ((yield* installedState(agent.workspacePath, entry)) === "modified" && !input.removeModified) {
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.removeModified")) });
      }
      for (const folder of entryFolders(entry))
        yield* removeFolder(agent.workspacePath, folder, entry.enabled !== false);
      delete lock.skills[input.skillId];
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(input.agentId).pipe(toSkillMarketplaceFailure);
    });
  }

  setEnabled(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return this.serialize(input.agentId, this.changeEnabledEffect(input));
  }
  private changeEnabledEffect(input: SetEnabledSkillInput): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const lock = yield* readLock(agent.workspacePath);
      const entry = lock.skills[input.skillId];
      if (!entry) return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.notFound")) });
      const folders = entryFolders(entry);
      for (const folder of folders) yield* assertSkillPaths(agent.workspacePath, folder);
      const currentlyEnabled = entry.enabled !== false;
      if (currentlyEnabled === input.enabled) {
        return toInstalledSkill(
          entry,
          entry.version,
          yield* installedState(agent.workspacePath, entry),
          yield* installedSkillDescription(agent.workspacePath, entry),
        );
      }
      if (!input.enabled) {
        const state = yield* installedState(agent.workspacePath, entry);
        if (state === "modified")
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableModified")) });
        if (state === "needs-repair")
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.disableNeedsRepair")) });
      }
      if (input.enabled) {
        for (const folder of folders) {
          if (!(yield* pathExists(disabledDirectory(agent.workspacePath, folder))))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.enableNeedsRepair")),
            });
          for (const target of targetDirectories(agent.workspacePath, folder)) {
            if (yield* pathExists(target))
              return yield* new SkillMarketplaceFailure({
                cause: new Error(sourceText("error.skill.providerFolderOccupied")),
              });
          }
        }
        const writes: Array<{ target: string; files: Record<string, Uint8Array> }> = [];
        for (const folder of folders) {
          const files = yield* readSkillFiles(disabledDirectory(agent.workspacePath, folder));
          for (const target of targetDirectories(agent.workspacePath, folder)) writes.push({ target, files });
        }
        yield* replaceTargets(writes);
        for (const folder of folders)
          yield* skillIO(() => rm(disabledDirectory(agent.workspacePath, folder), { recursive: true, force: true }));
        delete entry.enabled;
      } else {
        // Every folder is checked before one moves, and a failed move puts back the ones before it.
        const moves: Array<{ source: string; stash: string }> = [];
        for (const folder of folders) {
          const [primary, fallback] = targetDirectories(agent.workspacePath, folder);
          const source = (yield* pathExists(primary)) ? primary : (yield* pathExists(fallback)) ? fallback : null;
          const stash = disabledDirectory(agent.workspacePath, folder);
          if (source) moves.push({ source, stash });
          else if (!(yield* pathExists(stash)))
            return yield* new SkillMarketplaceFailure({
              cause: new Error(sourceText("error.skill.disableNeedsRepair")),
            });
        }
        const moved: typeof moves = [];
        const outcome = yield* Effect.result(
          Effect.forEach(
            moves,
            (move) =>
              Effect.gen(function* () {
                yield* skillIO(() => mkdir(dirname(move.stash), { recursive: true, mode: 0o700 }));
                if (yield* pathExists(move.stash))
                  yield* skillIO(() => rm(move.stash, { recursive: true, force: true }));
                yield* skillIO(() => rename(move.source, move.stash));
                moved.push(move);
              }),
            { discard: true },
          ),
        );
        if (Result.isFailure(outcome)) {
          for (const move of moved.reverse())
            yield* skillIO(() => rename(move.stash, move.source)).pipe(Effect.catch(() => Effect.void));
          return yield* outcome.failure;
        }
        for (const folder of folders)
          for (const target of targetDirectories(agent.workspacePath, folder))
            yield* skillIO(() => rm(target, { recursive: true, force: true }));
        entry.enabled = false;
      }
      lock.skills[input.skillId] = entry;
      yield* writeLock(agent.workspacePath, lock);
      yield* this.refreshAgentRuntime(input.agentId).pipe(toSkillMarketplaceFailure);
      return toInstalledSkill(
        entry,
        entry.version,
        yield* installedState(agent.workspacePath, entry),
        yield* installedSkillDescription(agent.workspacePath, entry),
      );
    });
  }

  private requireAgent(agentId: string): AgentSummary {
    const agent = this.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.skill.chooseLocalAgent"));
    return agent;
  }

  requireLocalLibrary(): LocalSkillLibrary {
    if (!this.localLibrary) throw new Error(sourceText("error.skill.localLibraryUnavailable"));
    return this.localLibrary;
  }

  installLocal(input: {
    agentId: string;
    skillId: string;
    revision: number;
  }): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const detail = yield* this.requireLocalLibrary()
        .get(input.skillId, input.revision)
        .pipe(toSkillMarketplaceFailure);
      const bundle = yield* this.requireLocalLibrary()
        .bundle(input.skillId, input.revision)
        .pipe(toSkillMarketplaceFailure);
      return yield* this.installResolved(yield* skillSync(() => this.requireAgent(input.agentId)), detail, bundle);
    });
  }

  /**
   * A skill pack shipped in `resources/preset-skills/<slug>`: the catalog build copies the plugin's
   * own directory there, so the installed bytes are the reviewed ones. The pack stages from that
   * directory and every integrity, pack and lock step of a marketplace install applies.
   */
  installPreset(
    input: { agentId: string; pluginSlug: string },
    presetRoot: string,
  ): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const root = join(presetRoot, input.pluginSlug);
      const markdown = yield* skillIO(() => readFile(join(root, "SKILL.md"), "utf8"));
      const info = yield* skillSync(() => inspectSkillMarkdown(markdown)).pipe(
        Effect.mapError(({ cause }) => new SkillMarketplaceFailure({ cause })),
      );
      if (info.slug !== input.pluginSlug)
        return yield* new SkillMarketplaceFailure({
          cause: new Error(`Preset ${input.pluginSlug} carries slug ${info.slug}.`),
        });
      const bundle = yield* archiveDirectory(root).pipe(
        Effect.mapError(({ cause }) => new SkillMarketplaceFailure({ cause })),
      );
      const detail: MarketplaceSkillDetail = {
        id: `preset-${input.pluginSlug}`,
        slug: info.slug,
        name: info.name,
        description: "",
        category: "other",
        creatorName: "OpenBot",
        version: 1,
        installs: 0,
        featured: false,
        iconUrl: null,
        updatedAt: "",
        versionId: "",
        bundleSha256: sha256(bundle),
        files: [],
        instructions: markdown,
      };
      return yield* this.installResolved(agent, detail, bundle);
    });
  }

  /**
   * A plugin from a remote repository: the zipball of `source.url` at `source.sha` (or `source.ref`,
   * else the default branch), filtered to `source.path`. The listing's trust summary is shown before
   * this runs; the repository address is allow-listed at the parse, and the archive url is derived
   * here, never taken from the caller. The plugin's skills land as a pack named after the plugin,
   * through the same integrity, pack and lock steps as a marketplace install.
   */
  installRemote(input: InstallRemotePluginInput, tempRoot: string): Effect.Effect<InstalledSkill, SkillMarketplaceFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<InstalledSkill, SkillMarketplaceFailure> {
      const agent = yield* skillSync(() => this.requireAgent(input.agentId));
      const archiveUrl = remoteZipballUrl(input.source);
      const response = yield* Effect.tryPromise({
        try: () => fetch(archiveUrl, { redirect: "follow" }),
        catch: (cause) => new SkillMarketplaceFailure({ cause }),
      });
      if (!response.ok)
        return yield* new SkillMarketplaceFailure({
          cause: new Error(`The repository archive answered ${response.status}.`),
        });
      const bytes = new Uint8Array(yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (cause) => new SkillMarketplaceFailure({ cause }),
      }));
      const repoFiles = yield* skillSync(() => normalizedFiles(bytes));
      const prefix = `${input.source.path}/`;
      const pluginFiles: Record<string, Uint8Array> = {};
      for (const [name, data] of Object.entries(repoFiles)) {
        if (name.startsWith(prefix)) pluginFiles[name.slice(prefix.length)] = data;
      }
      const manifestFile = pluginFiles[".claude-plugin/plugin.json"];
      if (!manifestFile)
        return yield* new SkillMarketplaceFailure({
          cause: new Error(`The plugin has no .claude-plugin/plugin.json at ${input.source.path}.`),
        });
      const manifest = yield* skillSync(() => {
        const value = JSON.parse(new TextDecoder().decode(manifestFile)) as { name?: unknown; description?: unknown };
        if (!isDynamicRecord(value) || !isString(value.name)) throw new Error("The remote plugin.json is invalid.");
        return value;
      });
      // The installer reads the pack from a root `SKILL.md`; a plugin without one gets a stub that
      // names the pack and carries the listing's description.
      const packFiles: Record<string, Uint8Array> = { ...pluginFiles };
      if (!packFiles["SKILL.md"]) {
        const description = isString(manifest.description) ? manifest.description : input.name;
        packFiles["SKILL.md"] = new TextEncoder().encode(
          `---\nname: ${input.name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${input.name}\n`,
        );
      }
      // A plugin's skills keep their own folder names; the pack renames each one under the plugin's
      // slug, which is what the installer's pack children require.
      const renamed: Record<string, Uint8Array> = {};
      for (const [name, data] of Object.entries(packFiles)) {
        const child = /^skills\/([^/]+)(\/|$)/u.exec(name)?.[1];
        const target = child && child !== `${input.name}-${child}` ? name.replace(`skills/${child}`, `skills/${input.name}-${child}`) : name;
        renamed[target] = data;
      }
      const temp = join(tempRoot, input.name);
      yield* skillIO(() => rm(temp, { recursive: true, force: true }));
      yield* writeFiles(temp, renamed);
      const bundle = yield* archiveDirectory(temp).pipe(
        Effect.mapError(({ cause }) => new SkillMarketplaceFailure({ cause })),
      );
      const outcome = yield* this.installResolved(agent, {
        id: `remote-${input.name}`,
        slug: input.name,
        name: isString(manifest.name) ? manifest.name : input.name,
        description: "",
        category: "other",
        creatorName: "OpenBot",
        version: 1,
        installs: 0,
        featured: false,
        iconUrl: null,
        updatedAt: "",
        versionId: "",
        bundleSha256: sha256(bundle),
        files: [],
        instructions: "",
      }, bundle);
      return outcome;
    }).pipe(Effect.ensuring(Effect.sync(() => void rm(tempRoot, { recursive: true, force: true }))));
  }

  private expireDrafts(): void {
    for (const [id, draft] of this.#drafts)
      if (Date.now() - draft.createdAt > DRAFT_LIFETIME_MS) this.#drafts.delete(id);
  }
}

function targetDirectories(workspace: string, slug: string): [string, string] {
  const [agents, claude] = MANAGED_SKILL_FOLDERS;
  return [join(workspace, agents, slug), join(workspace, claude, slug)];
}

/** The codeload zip of a repository at a pinned sha, a ref, or its default branch. */
function remoteZipballUrl(source: InstallRemotePluginInput["source"]): string {
  const [, owner, repo] = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)$/u.exec(source.url) ?? [];
  if (!owner || !repo) throw new Error(`Only github.com repositories can be fetched, not ${source.url}.`);
  const at = source.sha ?? (source.ref ? `refs/heads/${source.ref}` : "HEAD");
  return `https://codeload.github.com/${owner}/${repo}/zip/${at}`;
}

function disabledDirectory(workspace: string, slug: string): string {
  return join(workspace, ".openbot", "skills-disabled", slug);
}

/**
 * The skills of a pack: each `skills/<slug>-<name>/SKILL.md` in the bundle. The installer writes each
 * one as the folder `<slug>-<name>` beside `<slug>`, where a provider finds it as a skill.
 */
function packChildren(slug: string, files: Record<string, Uint8Array>): string[] {
  return Object.keys(files)
    .flatMap((path) => {
      const child = /^skills\/([^/]+)\/SKILL\.md$/u.exec(path)?.[1];
      return child?.startsWith(`${slug}-`) && SKILL_FOLDER_PATTERN.test(child) ? [child] : [];
    })
    .sort();
}

/** The files of each folder, by folder name. Files that no child owns stay in the `slug` folder. */
function skillFolders<T>(slug: string, files: Record<string, T>, children: readonly string[]) {
  const folders = new Map<string, Record<string, T>>([[slug, {}]]);
  for (const [path, value] of Object.entries(files)) {
    const [root, child = "", ...rest] = path.split("/");
    const nested = root === "skills" && children.includes(child);
    const folder = nested ? child : slug;
    const bucket = folders.get(folder) ?? {};
    bucket[nested ? rest.join("/") : path] = value;
    folders.set(folder, bucket);
  }
  return folders;
}

/** A lock entry written before packs has no `folders`, so its files keep their place in `slug`. */
function entryFolders(entry: LockEntry): string[] {
  return [entry.slug, ...(entry.folders ?? [])];
}

/** A disabled skill owns only its stash: files in a provider folder are then the user's. */
const removeFolder = Effect.fn("SkillMarketplace.removeFolder")(function* (
  workspace: string,
  folder: string,
  enabled: boolean,
) {
  for (const target of [...(enabled ? targetDirectories(workspace, folder) : []), disabledDirectory(workspace, folder)])
    yield* skillIO(() => rm(target, { recursive: true, force: true }));
});

function toInstalledSkill(
  entry: LockEntry,
  availableVersion: number,
  state: "installed" | "modified" | "needs-repair" | "update-available",
  description?: string,
): InstalledSkill {
  const resolved = state === "installed" && availableVersion > entry.version ? "update-available" : state;
  const resolvedDescription = trimmedSkillDescription(description ?? entry.description);
  return {
    skillId: entry.skillId,
    slug: entry.slug,
    name: entry.name,
    installedVersion: entry.version,
    availableVersion,
    state: resolved,
    enabled: entry.enabled !== false,
    origin: entry.skillId.startsWith("local-skill-") ? "local" : "marketplace",
    ...(resolvedDescription ? { description: resolvedDescription } : {}),
  };
}

const installedSkillDescription = Effect.fn("SkillMarketplace.description")(function* (
  workspace: string,
  entry: LockEntry,
) {
  const stored = trimmedSkillDescription(entry.description);
  if (stored) return stored;
  const roots =
    entry.enabled === false ? [disabledDirectory(workspace, entry.slug)] : targetDirectories(workspace, entry.slug);
  for (const root of roots) {
    const result = yield* Effect.result(
      skillIO(() => readFile(join(root, "SKILL.md"), "utf8")).pipe(
        Effect.flatMap((text) => skillSync(() => parseSkillMarkdownDescription(text))),
      ),
    );
    if (Result.isSuccess(result) && result.success) return result.success;
  }
});

function trimmedSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

function parseSkillMarkdownDescription(text: string): string | undefined {
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) return undefined;
  const metadata = parseYaml(match[1] ?? "");
  if (!isDynamicRecord(metadata)) return undefined;
  return trimmedSkillDescription(metadata.description);
}

const readSkillFiles = Effect.fn("SkillMarketplace.readFiles")(function* (root: string) {
  const files: Record<string, Uint8Array> = {};
  const visit = (directory: string): Effect.Effect<void, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        if (entry.isSymbolicLink())
          return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.symlinks")) });
        if (entry.isDirectory()) yield* visit(path);
        else if (entry.isFile())
          files[relative(root, path).replaceAll("\\", "/")] = new Uint8Array(yield* skillIO(() => readFile(path)));
      }
    });
  yield* visit(root);
  return files;
});

/** Writes every target, or on a failure puts back each one it already replaced. */
const replaceTargets = Effect.fn("SkillMarketplace.replaceTargets")(function* (
  writes: ReadonlyArray<{ target: string; files: Record<string, Uint8Array> }>,
) {
  const completed: Array<{ target: string; backup: string | null }> = [];
  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      for (const { target, files } of writes) {
        yield* skillIO(() => mkdir(dirname(target), { recursive: true, mode: 0o700 }));
        const stage = `${target}.openbot-stage-${randomUUID()}`;
        const backup = (yield* pathExists(target)) ? `${target}.openbot-backup-${randomUUID()}` : null;
        yield* writeFiles(stage, files);
        if (backup) yield* skillIO(() => rename(target, backup));
        const moved = yield* Effect.result(skillIO(() => rename(stage, target)));
        if (Result.isFailure(moved)) {
          if (backup) yield* skillIO(() => rename(backup, target));
          return yield* moved.failure;
        }
        completed.push({ target, backup });
      }
    }),
  );
  if (Result.isFailure(outcome)) {
    for (const item of completed.reverse()) {
      yield* skillIO(() => rm(item.target, { recursive: true, force: true }));
      const backup = item.backup;
      if (backup) yield* skillIO(() => rename(backup, item.target)).pipe(Effect.catch(() => Effect.void));
    }
    return yield* outcome.failure;
  }
  yield* Effect.forEach(
    completed,
    (item) => {
      const backup = item.backup;
      return backup ? skillIO(() => rm(backup, { recursive: true, force: true })) : Effect.void;
    },
    { concurrency: "unbounded", discard: true },
  );
}, Effect.uninterruptible);

const writeFiles = Effect.fn("SkillMarketplace.writeFiles")(function* (
  root: string,
  files: Record<string, Uint8Array>,
) {
  for (const [name, bytes] of Object.entries(files)) {
    const path = resolve(root, name);
    if (!path.startsWith(`${resolve(root)}/`) && !path.startsWith(`${resolve(root)}\\`))
      return yield* new SkillMarketplaceFailure({ cause: new Error("Unsafe skill path.") });
    yield* skillIO(() => mkdir(dirname(path), { recursive: true, mode: 0o700 }));
    yield* skillIO(() => writeFile(path, bytes, { mode: 0o600 }));
  }
});

const hasUnexpectedSkillFiles = Effect.fn("SkillMarketplace.checkFiles")(function* (
  root: string,
  expected: Record<string, string>,
) {
  const paths = Object.keys(expected);
  const visit = (directory: string): Effect.Effect<boolean, SkillMarketplaceFailure> =>
    Effect.gen(function* () {
      for (const entry of yield* skillIO(() => readdir(directory, { withFileTypes: true }))) {
        const path = join(directory, entry.name);
        const name = relative(root, path).replaceAll("\\", "/");
        if (entry.isSymbolicLink()) return true;
        if (entry.isDirectory()) {
          if (!paths.some((expectedPath) => expectedPath.startsWith(`${name}/`)) || (yield* visit(path))) return true;
        } else if (!entry.isFile() || !(name in expected)) return true;
      }
      return false;
    });
  return yield* visit(root);
});

const installedState = Effect.fn("SkillMarketplace.installedState")(function* (
  workspace: string,
  entry: LockEntry,
): Effect.fn.Return<"installed" | "modified" | "needs-repair", SkillMarketplaceFailure> {
  let state: "installed" | "needs-repair" = "installed";
  for (const [folder, files] of skillFolders(entry.slug, entry.files, entry.folders ?? [])) {
    const folderState = yield* installedFolderState(workspace, folder, files, entry.enabled !== false);
    if (folderState === "modified") return folderState;
    if (folderState === "needs-repair") state = folderState;
  }
  return state;
});

const installedFolderState = Effect.fn("SkillMarketplace.installedFolderState")(function* (
  workspace: string,
  folder: string,
  files: Record<string, string>,
  enabled: boolean,
): Effect.fn.Return<"installed" | "modified" | "needs-repair", SkillMarketplaceFailure> {
  const roots = enabled ? targetDirectories(workspace, folder) : [disabledDirectory(workspace, folder)];
  let complete = 0;
  let missing = false;
  for (const target of roots) {
    if (!(yield* pathExists(target))) continue;
    complete += 1;
    const unexpected = yield* Effect.result(hasUnexpectedSkillFiles(target, files));
    if (Result.isFailure(unexpected) || unexpected.success) return "modified";
    for (const [name, hash] of Object.entries(files)) {
      const content = yield* Effect.result(skillIO(() => readFile(join(target, name))));
      if (Result.isSuccess(content)) {
        if (sha256(new Uint8Array(content.success)) !== hash) return "modified";
      } else {
        const error = content.failure.cause;
        if (!isDynamicRecord(error) || error.code !== "ENOENT") return "modified";
        missing = true;
      }
    }
  }
  const expected = enabled ? 2 : 1;
  return complete === expected && !missing ? "installed" : "needs-repair";
});

/**
 * One skill's `SKILL.md` as a template carries it. The slug and name are what an install derives
 * from the same text, so a folder name that is not a valid slug does not travel.
 */
const embeddedSkill = Effect.fn("SkillMarketplace.embeddedSkill")(function* (
  path: string,
  label: string,
): Effect.fn.Return<AgentTemplateSkill, SkillMarketplaceFailure> {
  const tooLarge = sourceText("error.skill.templateMarkdownTooLarge", { name: label });
  if ((yield* skillIO(() => stat(path))).size > AGENT_TEMPLATE_LIMITS.skillMarkdown)
    return yield* new SkillMarketplaceFailure({ cause: new Error(tooLarge) });
  const markdown = yield* skillIO(() => readFile(path, "utf8"));
  if (markdown.length > AGENT_TEMPLATE_LIMITS.skillMarkdown)
    return yield* new SkillMarketplaceFailure({ cause: new Error(tooLarge) });
  const info = yield* skillSync(() => inspectSkillMarkdown(markdown)).pipe(
    Effect.mapError(
      ({ cause }) =>
        new SkillMarketplaceFailure({
          cause: new Error(`${label}: ${cause instanceof Error ? cause.message : "SKILL.md is invalid."}`),
        }),
    ),
  );
  return { kind: "embedded", slug: info.slug, name: info.name, markdown };
});

function lockedSlugs(lock: SkillsLock): Set<string> {
  return new Set(Object.values(lock.skills).flatMap(entryFolders));
}

function lockPath(workspace: string): string {
  return join(workspace, ".openbot", "skills-lock.json");
}
const readLock = Effect.fn("SkillMarketplace.readLock")(function* (
  workspace: string,
): Effect.fn.Return<SkillsLock, SkillMarketplaceFailure> {
  const content = yield* Effect.result(skillIO(() => readFile(lockPath(workspace), "utf8")));
  if (Result.isFailure(content)) {
    const error = content.failure.cause;
    if (isDynamicRecord(error) && error.code === "ENOENT") return { version: 1, skills: {} };
    return yield* content.failure;
  }
  return yield* skillSync(() => {
    const value = JSON.parse(content.success);
    if (!isSkillsLock(value)) throw new Error(sourceText("error.skill.lockInvalid"));
    return value;
  });
});
const writeLock = Effect.fn("SkillMarketplace.writeLock")((workspace: string, lock: SkillsLock) =>
  writeFileAtomically(lockPath(workspace), `${JSON.stringify(lock, null, 2)}\n`, { createDirectory: true }).pipe(
    toSkillMarketplaceFailure,
  ),
);
const pathExists = Effect.fn("SkillMarketplace.pathExists")((path: string) =>
  skillIO(() => lstat(path)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  ),
);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isLockEntry(value: unknown): value is LockEntry {
  return (
    isDynamicRecord(value) &&
    isString(value.skillId) &&
    (value.versionId === undefined || isString(value.versionId)) &&
    isString(value.slug) &&
    isString(value.name) &&
    isNumber(value.version) &&
    isString(value.bundleSha256) &&
    isString(value.receiptId) &&
    isDynamicRecord(value.files) &&
    Object.values(value.files).every(isString) &&
    (value.enabled === undefined || isBoolean(value.enabled)) &&
    (value.description === undefined || isString(value.description)) &&
    (value.folders === undefined ||
      (Array.isArray(value.folders) &&
        value.folders.every(
          (folder) => isString(folder) && folder.startsWith(`${value.slug}-`) && SKILL_FOLDER_PATTERN.test(folder),
        )))
  );
}

function isSkillsLock(value: unknown): value is SkillsLock {
  return (
    isDynamicRecord(value) &&
    value.version === 1 &&
    isDynamicRecord(value.skills) &&
    Object.values(value.skills).every(isLockEntry)
  );
}

const assertSkillPaths = Effect.fn("SkillMarketplace.checkPaths")(function* (workspace: string, slug: string) {
  for (const target of [
    ...targetDirectories(workspace, slug),
    disabledDirectory(workspace, slug),
    lockPath(workspace),
  ]) {
    let current = resolve(workspace);
    const parts = relative(current, target).split(/[\\/]/u);
    for (const part of ["", ...parts]) {
      current = join(current, part);
      const entry = yield* Effect.result(skillIO(() => lstat(current)));
      if (Result.isFailure(entry)) {
        const error = entry.failure.cause;
        if (isDynamicRecord(error) && error.code === "ENOENT") break;
        return yield* entry.failure;
      }
      if (entry.success.isSymbolicLink())
        return yield* new SkillMarketplaceFailure({ cause: new Error(sourceText("error.skill.installPathSymlink")) });
    }
  }
});

export class SkillMarketplaceFailure extends Schema.TaggedError<SkillMarketplaceFailure>()("SkillMarketplaceFailure", {
  cause: Schema.Defect(),
}) {}

const { io: skillIO, sync: skillSync, rewrap: toSkillMarketplaceFailure } = causeHelpers(SkillMarketplaceFailure);
