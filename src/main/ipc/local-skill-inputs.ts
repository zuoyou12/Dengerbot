import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CreateLocalSkillInput,
  InstallLocalSkillInput,
  InstallPresetSkillInput,
  InstallRemotePluginInput,
  LocalSkillRevisionInput,
  ReviseLocalSkillInput,
} from "@openbot/contracts/ipc";
import { z } from "zod";
import {
  createSkillSchema,
  installLocalSkillSchema,
  readSkillSchema,
  reviseSkillSchema,
} from "../../backend/agent/skill-tools";

const agentId = z.string().min(1).max(INPUT_LIMITS.identifier);
export const parseCreateLocalSkill = (input: unknown): CreateLocalSkillInput =>
  createSkillSchema.extend({ agentId }).parse(input);
export const parseReviseLocalSkill = (input: unknown): ReviseLocalSkillInput =>
  reviseSkillSchema.extend({ agentId }).parse(input);
export const parseReadLocalSkill = (input: unknown): LocalSkillRevisionInput => {
  const { skillId, revision } = readSkillSchema.parse(input);
  return revision === undefined ? { skillId } : { skillId, revision };
};
export const parseInstallLocalSkill = (input: unknown): InstallLocalSkillInput =>
  installLocalSkillSchema.extend({ agentId }).parse(input);
const pluginSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/u);
export const parseInstallPresetSkill = (input: unknown): InstallPresetSkillInput =>
  z.object({ agentId, pluginSlug }).parse(input);
/** A repository address only: the archive url is derived here, never taken from the caller. */
const githubRepo = z
  .string()
  .max(200)
  .regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u);
/** A relative directory inside the repository: no leading slash, no parent steps. */
const repoPath = z.string().min(1).max(200).regex(/^[\w][\w./-]*$/u).refine((value) => !value.includes(".."));
const remoteSource = z.object({
  url: githubRepo,
  path: repoPath,
  ref: z.string().min(1).max(200).optional(),
  sha: z.string().regex(/^[0-9a-f]{7,40}$/u).optional(),
});
export const parseInstallRemotePlugin = (input: unknown): InstallRemotePluginInput =>
  z.object({ agentId, name: pluginSlug, source: remoteSource }).parse(input);
