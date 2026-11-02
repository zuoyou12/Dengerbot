import type { SkillMarketplaceFailure } from "./skill-marketplace-service";

// Agent templates, local only: a preview and snapshot of one agent's instructions, routines
// and skills, for the dialogs that show them. Publishing a template and installing a shared
// one went through the central marketplace and are gone with it.

import { readFile } from "node:fs/promises";
import {
  type AgentSummary,
  type AgentTemplatePreview,
  type AgentTemplateSkill,
  type AgentTemplateSnapshot,
  type AvatarImageInput,
  isReleasedRoutineSchedule,
  type RoutineSchedule,
  toAgentTemplateSnapshot,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** A template read that failed. The dialog shows the message instead of hiding the agent. */
export class AgentTemplateFailure extends Schema.TaggedError<AgentTemplateFailure>()("AgentTemplateFailure", {
  cause: Schema.Defect(),
}) {}

/** The message of a cause, for a dialog that shows why a skill read failed. */
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

interface AgentTemplateAgents {
  listAgents(): AgentSummary[];
  listRoutines(agentId: string): Array<{
    name: string;
    instruction: string;
    active: boolean;
    trigger: { schedule: RoutineSchedule };
  }>;
  resolveAvatar(agentId: string): { path: string; mimeType: AvatarImageInput["mimeType"] } | null;
}

interface AgentTemplateSkills {
  listTemplateSkills(agentId: string): Effect.Effect<AgentTemplateSkill[], SkillMarketplaceFailure>;
}

export class AgentTemplateService {
  constructor(
    private readonly agents: AgentTemplateAgents,
    private readonly skills: AgentTemplateSkills,
  ) {}

  preview(agentId: string): Effect.Effect<AgentTemplatePreview, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplatePreview, AgentTemplateFailure> {
      const agent = yield* templateSync(() => this.requireAgent(agentId));
      // The agent still previews; it reads as not published. A skill problem must not hide the
      // dialog: the preview shows the error. The two reads do not depend on each other, so they
      // run together.
      const [skills, avatarImage] = yield* Effect.all(
        [
          this.skills
            .listTemplateSkills(agentId)
            .pipe(toAgentTemplateFailure)
            .pipe(
              Effect.map((value) => ({ value, error: null })),
              Effect.catch((error) => Effect.succeed({ value: [], error: message(error.cause) })),
            ),
          // An avatar file that cannot be read is shown as no avatar: it must not hide the dialog.
          this.readAvatar(agentId).pipe(Effect.catch(() => Effect.succeed(null))),
        ],
        { concurrency: "unbounded" },
      );
      const skillsError = skills.error;
      return {
        ...this.profile(agent, skills.value),
        agentId,
        avatarUrl: agent.avatarUrl,
        avatarImage,
        updatedAt: agent.updatedAt,
        publication: null,
        skillsError,
      };
    });
  }

  snapshot(agent: AgentSummary): Effect.Effect<AgentTemplateSnapshot, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AgentTemplateSnapshot, AgentTemplateFailure> {
      return this.profile(agent, yield* this.skills.listTemplateSkills(agent.id).pipe(toAgentTemplateFailure));
    });
  }

  private profile(agent: AgentSummary, skills: AgentTemplateSkill[]): AgentTemplateSnapshot {
    return toAgentTemplateSnapshot({
      name: agent.name,
      title: agent.title,
      description: agent.description,
      avatarSeed: agent.avatarSeed,
      avatarHue: agent.avatarHue,
      skills,
      routines: this.agents.listRoutines(agent.id).flatMap(({ name, instruction, active, trigger }) =>
        // A `once` routine names one date, so it is not part of a template.
        isReleasedRoutineSchedule(trigger.schedule) ? [{ name, instruction, active, schedule: trigger.schedule }] : [],
      ),
    });
  }

  readAvatar(agentId: string): Effect.Effect<AvatarImageInput | null, AgentTemplateFailure> {
    return Effect.gen({ self: this }, function* (): Effect.fn.Return<AvatarImageInput | null, AgentTemplateFailure> {
      const avatar = this.agents.resolveAvatar(agentId);
      if (!avatar) return null;
      return { mimeType: avatar.mimeType, bytes: new Uint8Array(yield* templateIO(() => readFile(avatar.path))) };
    });
  }

  private requireAgent(agentId: string): AgentSummary {
    const agent = this.agents.listAgents().find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error(sourceText("error.skill.chooseLocalAgent"));
    return agent;
  }
}

const { io: templateIO, sync: templateSync, rewrap: toAgentTemplateFailure } = causeHelpers(AgentTemplateFailure);
