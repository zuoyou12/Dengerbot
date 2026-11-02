// What main answers for the skill and agent marketplaces and for installed skills.
//
// Each decoder checks every field the contract type requires and keeps each optional field it
// carries, so a value the renderer reads always has the shape its type says.

import {
  createAgentTemplateShareUrl,
  isAgentTemplateId,
  isAgentTemplateShareOrigin,
} from "@openbot/contracts/agent-template-links";
import {
  type AgentTemplatePreview,
  type AgentTemplatePublication,
  type AvatarImageInput,
  INSTALLED_SKILL_ORIGINS,
  type InstalledSkill,
  isAgentTemplateRoutine,
  isAgentTemplateSkill,
  isAvatarHue,
  isAvatarSeed,
  isClientAgentSummary,
  isSkillCategory,
  isSkillNote,
  type InstallMarketplaceAgentResult,
  type MarketplaceSkillDetail,
  SKILL_DESCRIPTION_MAX_LENGTH,
  type SkillPackagePreview,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
import {
  decodeRecord,
  nullableString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

function decodeSkillSummary(value: unknown) {
  const item = decodeRecord(value, "marketplace skill");
  if (!isSkillCategory(item.category)) throw new Error("Invalid skill category.");
  return {
    id: requiredString(item, "id"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    category: item.category,
    creatorName: requiredString(item, "creatorName"),
    creatorAvatarUrl: item.creatorAvatarUrl === undefined ? null : nullableString(item, "creatorAvatarUrl"),
    version: requiredNumber(item, "version"),
    installs: requiredNumber(item, "installs"),
    featured: requiredBoolean(item, "featured"),
    iconUrl: nullableString(item, "iconUrl"),
    updatedAt: requiredString(item, "updatedAt"),
  };
}

export function decodeSkillDetails(value: unknown): MarketplaceSkillDetail[] {
  if (!Array.isArray(value)) throw new Error("Invalid local skill list.");
  return value.map(decodeSkillDetail);
}

export function decodeSkillDetail(value: unknown): MarketplaceSkillDetail {
  const item = decodeRecord(value, "skill detail");
  const summary = decodeSkillSummary(item);
  if (!Array.isArray(item.files) || !item.files.every(isString)) throw new Error("Invalid skill files.");
  return {
    ...summary,
    versionId: requiredString(item, "versionId"),
    bundleSha256: requiredString(item, "bundleSha256"),
    files: item.files,
    instructions: requiredString(item, "instructions"),
    ...(isString(item.examplePrompt) && item.examplePrompt.trim().length <= 1000
      ? { examplePrompt: item.examplePrompt.trim() }
      : {}),
  };
}

export function decodeSkillPreview(value: unknown): SkillPackagePreview | null {
  if (value === null) return null;
  const item = decodeRecord(value, "skill package preview");
  if (!Array.isArray(item.files) || !item.files.every(isString)) throw new Error("Invalid skill package files.");
  return {
    draftId: requiredString(item, "draftId"),
    name: requiredString(item, "name"),
    description: requiredString(item, "description"),
    slug: requiredString(item, "slug"),
    files: item.files,
    size: requiredNumber(item, "size"),
  };
}

export function decodeInstalledSkill(value: unknown): InstalledSkill {
  const item = decodeRecord(value, "installed skill");
  const state = item.state;
  if (!isOneOf(["installed", "update-available", "modified", "needs-repair"], state)) {
    throw new Error("Invalid installed skill state.");
  }
  const description = optionalSkillDescription(item.description);
  return {
    skillId: requiredString(item, "skillId"),
    slug: requiredString(item, "slug"),
    name: requiredString(item, "name"),
    installedVersion: requiredNumber(item, "installedVersion"),
    availableVersion: requiredNumber(item, "availableVersion"),
    state,
    ...(item.enabled === false ? { enabled: false } : item.enabled === true ? { enabled: true } : {}),
    ...(isOneOf(INSTALLED_SKILL_ORIGINS, item.origin) ? { origin: item.origin } : {}),
    ...(description ? { description } : {}),
    ...(isSkillNote(item.location) ? { location: item.location } : {}),
    ...(isSkillNote(item.problem) ? { problem: item.problem } : {}),
  };
}

function optionalSkillDescription(value: unknown): string | undefined {
  if (!isString(value)) return undefined;
  const description = value.trim();
  return description && description.length <= SKILL_DESCRIPTION_MAX_LENGTH ? description : undefined;
}

export function decodeInstalledSkillsFromMain(value: unknown): InstalledSkill[] {
  if (!Array.isArray(value)) throw new Error("Invalid installed skills.");
  return value.map(decodeInstalledSkill);
}

export function decodeAgentInstallation(value: unknown): InstallMarketplaceAgentResult {
  const item = decodeRecord(value, "agent installation");
  if (!isClientAgentSummary(item.agent)) throw new Error("Invalid agent installation.");
  return { agent: item.agent };
}

export function decodeAgentTemplatePublication(value: unknown): AgentTemplatePublication {
  const item = decodeRecord(value, "agent template publication");
  const templateId = requiredString(item, "templateId");
  if (!isAgentTemplateId(templateId)) throw new Error("Invalid templateId.");
  // Rebuilt from the id on the origin main names, which must be `openbot.run` or the local Worker, so
  // main cannot put a foreign address behind the link the dialog copies.
  let origin: string;
  try {
    origin = new URL(requiredString(item, "shareUrl")).origin;
  } catch {
    throw new Error("Invalid shareUrl.");
  }
  if (!isAgentTemplateShareOrigin(origin)) throw new Error("Invalid shareUrl.");
  return {
    templateId,
    shareUrl: createAgentTemplateShareUrl(templateId, origin),
    publishedAt: requiredString(item, "publishedAt"),
  };
}

/** A preview may have empty instructions: publishing refuses that, not the dialog that shows it. */
export function decodeAgentTemplatePreview(value: unknown): AgentTemplatePreview {
  const item = decodeRecord(value, "agent template preview");
  if (
    !isAvatarSeed(item.avatarSeed) ||
    (item.avatarHue !== null && !isAvatarHue(item.avatarHue)) ||
    !Array.isArray(item.skills) ||
    !item.skills.every(isAgentTemplateSkill) ||
    !Array.isArray(item.routines) ||
    !item.routines.every(isAgentTemplateRoutine)
  )
    throw new Error("Invalid agent template preview.");
  const snapshot = toAgentTemplateSnapshot({
    name: requiredString(item, "name"),
    title: requiredString(item, "title"),
    description: requiredString(item, "description"),
    avatarSeed: item.avatarSeed,
    avatarHue: item.avatarHue,
    skills: item.skills,
    routines: item.routines,
  });
  return {
    ...snapshot,
    agentId: requiredString(item, "agentId"),
    avatarUrl: nullableString(item, "avatarUrl"),
    avatarImage: decodePreviewAvatarImage(item.avatarImage),
    updatedAt: nullableString(item, "updatedAt"),
    publication: item.publication === null ? null : decodeAgentTemplatePublication(item.publication),
    skillsError: nullableString(item, "skillsError"),
  };
}

function decodePreviewAvatarImage(value: unknown): AvatarImageInput | null {
  if (value === null) return null;
  if (
    !isDynamicRecord(value) ||
    !isOneOf(["image/png", "image/jpeg", "image/webp"] as const, value.mimeType) ||
    !(value.bytes instanceof Uint8Array)
  )
    throw new Error("Invalid agent template avatar.");
  return { mimeType: value.mimeType, bytes: value.bytes };
}
