import { randomUUID } from "node:crypto";
import type { AgentContextCategoryUsage, AgentContextState } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import type { AgentClient } from "../agent-client";
import type { AgentStore } from "../agent-store";
import { causeHelpers } from "../effect-boundary";
import { decodeRecordResponse, getRecord } from "../protocol";
import { finiteNumberOrNull } from "./account-usage";
import type { ProviderPort } from "./provider-runtime";
import type { StewardDecision } from "./steward";
import type { ThreadOperationFailed } from "./thread-lifecycle";

interface ThreadContextBudget {
  usedTokens: number;
  contextWindow: number;
  pending: boolean;
  /** `stopping`: the deadline asked Codex to stop the compaction turn, and the queue waits for its end. */
  phase: "idle" | "requested" | "running" | "stopping";
  compactionTurnId: string | null;
  lastCompactedTokens: number | null;
}

const CONTEXT_COMPACTION_THRESHOLD = 0.8;
/**
 * The share of the window at which the steward no longer decides: the session rotates. Below it a
 * "continue" re-arms only after the thread grew, which near the top of the window can never happen
 * again — the hard share is what keeps a kept session from settling there forever. It matches the
 * auto-compaction a DSH profile runs as its own overflow fallback.
 */
const CONTEXT_COMPACTION_ROTATE_SHARE = 0.95;
const CONTEXT_COMPACTION_TIMEOUT_MS = 120_000;
/** Usage arrives after each model step; one runtime snapshot carries the latest value of a burst. */
const USAGE_CHANGE_DELAY_MS = 250;

export interface ContextCompactionOptions {
  /** How long a compaction runs before OpenBot stops it. Tests make it short. */
  timeoutMs?: number | undefined;
  store: AgentStore;
  providers: ProviderPort;
  emitError(code: string, error: unknown, agentId?: string): void;
  scheduleDrain(agentId: string): void;
  /**
   * A model-written note to put at the head of the replacement session's handoff, or `null` to use
   * the mechanical packet alone. It must never fail: a note that cannot be written is not a reason
   * to keep a full context.
   */
  writeHandoffNote?(agentId: string, externalThreadId: string): Effect.Effect<string | null, never>;
  /**
   * The steward that decides whether a pressured `handoff` session rotates now or keeps going, or
   * `null` for the mechanical threshold alone. It must never fail: `null` answers "rotate", the
   * decision the threshold made before the steward existed.
   */
  stewardDecide?(input: {
    agentId: string;
    threadId: string;
    usedTokens: number;
    contextWindow: number;
    stewardAsks: number;
  }): Effect.Effect<StewardDecision | null, never>;
  /**
   * Replaces the session for a `handoff` compaction. The new session, or `null` when none replaced
   * it. `note` is the result of `writeHandoffNote`, or `null` when there is none.
   */
  rotateSession(
    agentId: string,
    client: AgentClient,
    threadId: string,
    note: string | null,
  ): Effect.Effect<string | null, ThreadOperationFailed>;
  /** Whether `rotateSession` can replace this session. See `ThreadLifecycle.rotatesSession`. */
  rotatesSession(agentId: string, threadId: string): boolean;
  changed?(): void;
  /** A provider session finished a compaction: its summary replaces what it read before. */
  compacted?(threadId: string): void;
}

/** Whether OpenBot can ask for a compaction of this client, automatically or for the user. */
export function compactsOnRequest(mode: AgentClient["contextCompaction"]): boolean {
  return mode === "events" || mode === "request" || mode === "handoff";
}

/** A queue that Codex refused because a compaction turn runs on the provider thread of its key. */
interface RefusalHold {
  agentId: string;
  client: AgentClient;
  timer: NodeJS.Timeout;
}

/**
 * Decides when a provider thread is close enough to its context window to compact, and drives the
 * compaction turn.
 *
 * A compaction is a real provider turn, so it arrives on the same notification stream as the
 * agent's own work and has to be told apart from it: `claimTurn` swallows the `turn/started` that
 * belongs to the compaction, and `isCompactionTurn` recognizes its completion. The budget is keyed
 * by *external* provider thread id, and so are the compactions and refusals: the threads of one agent run
 * in parallel, so a compaction holds the lane of its own thread only (`heldThreads`).
 *
 * Codex refuses input while a compaction turn runs, so the hold lasts until that turn ends: the
 * deadline stops the turn instead of releasing the queue, and a refused `turn/start` puts its
 * messages back to wait for the end of the turn. A hold of a client that ended ends with it.
 */
export class ContextCompaction {
  readonly #store: AgentStore;
  readonly #providers: ProviderPort;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #scheduleDrain: (agentId: string) => void;
  readonly #rotateSession: ContextCompactionOptions["rotateSession"];
  readonly #rotatesSession: ContextCompactionOptions["rotatesSession"];
  readonly #writeHandoffNote: ContextCompactionOptions["writeHandoffNote"];
  readonly #stewardDecide: ContextCompactionOptions["stewardDecide"];
  readonly #budgets = new Map<string, ThreadContextBudget>();
  /** How many times each pressured session kept going on a steward decision. */
  readonly #stewardAsks = new Map<string, number>();
  /** The agent of each provider thread that compacts, and the client that runs it once `request` sends it. */
  readonly #compacting = new Map<string, { agentId: string; client: AgentClient | null; manual?: boolean }>();
  readonly #refusals = new Map<string, RefusalHold>();
  readonly #timeoutMs: number;
  /** How long a stopped compaction, or a refused queue, waits for the turn to end. */
  readonly #graceMs: number;
  readonly #display = new Map<string, Omit<AgentContextState, "agentId" | "threadId">>();
  readonly #awaitingPostCompaction = new Set<string>();
  readonly #durations = new Map<string, number>();
  readonly #changed: () => void;
  readonly #compacted: (threadId: string) => void;
  readonly #timers = new Map<string, NodeJS.Timeout>();
  #usageTimer: NodeJS.Timeout | null = null;

  constructor(options: ContextCompactionOptions) {
    this.#changed = options.changed ?? (() => {});
    this.#compacted = options.compacted ?? (() => {});
    this.#timeoutMs = options.timeoutMs ?? CONTEXT_COMPACTION_TIMEOUT_MS;
    this.#graceMs = Math.ceil(this.#timeoutMs / 4);
    this.#store = options.store;
    this.#providers = options.providers;
    this.#emitError = options.emitError;
    this.#scheduleDrain = options.scheduleDrain;
    this.#rotateSession = options.rotateSession;
    this.#rotatesSession = options.rotatesSession;
    this.#writeHandoffNote = options.writeHandoffNote;
    this.#stewardDecide = options.stewardDecide;
  }

  /** Only personal sessions appear in the desktop snapshot; execution threads remain separate. */
  snapshot(): AgentContextState[] {
    return this.#store.list().flatMap((agent) => {
      const session = agent.threadId
        ? this.#store.database.activeProviderSession(agent.threadId, agent.provider)
        : null;
      const display = session ? this.#display.get(session.externalSessionId) : null;
      return display && agent.threadId ? [{ agentId: agent.id, threadId: agent.threadId, ...display }] : [];
    });
  }

  observeUsage(
    threadId: string,
    usedTokens: number,
    windowTokens: number,
    nativeManaged: boolean,
    autoCompactAt: number | null,
    estimated = false,
    categories?: AgentContextCategoryUsage[],
  ): void {
    if (!Number.isFinite(usedTokens) || usedTokens < 0 || !Number.isFinite(windowTokens) || windowTokens <= 0) return;
    const display = this.#display.get(threadId) ?? { usage: null, compaction: null };
    const previous = display.usage;
    display.usage = {
      usedTokens,
      windowTokens,
      nativeManaged,
      autoCompactAt,
      estimated,
      ...(categories ? { categories } : {}),
    };
    const after = display.compaction?.status === "completed" && this.#awaitingPostCompaction.delete(threadId);
    if (after && display.compaction) display.compaction.afterTokens = usedTokens;
    this.#display.set(threadId, display);
    if (after || JSON.stringify(previous) !== JSON.stringify(display.usage)) this.#scheduleUsageChange();
  }

  #scheduleUsageChange(): void {
    this.#usageTimer ??= setTimeout(() => {
      this.#usageTimer = null;
      this.#changed();
    }, USAGE_CHANGE_DELAY_MS);
  }

  /** A snapshot sent now also carries any pending usage. */
  #emitChanged(): void {
    if (this.#usageTimer) clearTimeout(this.#usageTimer);
    this.#usageTimer = null;
    this.#changed();
  }

  observeCompaction(
    threadId: string,
    status: "running" | "completed" | "failed",
    tokenComparison: "context" | "none" = "context",
  ): void {
    const display = this.#display.get(threadId) ?? { usage: null, compaction: null };
    if (status === "running" && display.compaction?.status === "running") return;
    const previous =
      status === "running"
        ? display.compaction?.status === "running"
          ? display.compaction
          : null
        : display.compaction;
    const startedAt = previous ? previous.startedAt : Date.now();
    const expectedMs = this.#durations.get(threadId);
    const compaction: NonNullable<typeof display.compaction> = {
      id: previous ? previous.id : randomUUID(),
      startedAt,
      status,
      ...(expectedMs === undefined ? {} : { expectedMs }),
      ...(previous ?? {}),
    };
    compaction.status = status;
    display.compaction = compaction;
    const before = previous ? previous.beforeTokens : display.usage?.usedTokens;
    if (tokenComparison === "none") {
      delete compaction.beforeTokens;
      delete compaction.afterTokens;
    } else if (before !== undefined) compaction.beforeTokens = before;
    this.#awaitingPostCompaction.delete(threadId);
    if (tokenComparison === "context" && status === "completed" && compaction.afterTokens === undefined)
      this.#awaitingPostCompaction.add(threadId);
    if (status === "completed" && previous?.status === "running")
      this.#durations.set(threadId, Math.max(1, Date.now() - startedAt));
    this.#display.set(threadId, display);
    this.#emitChanged();
    if (status === "completed") this.#compacted(threadId);
  }

  /** Ends a running compaction whose provider stopped before it reported the result. */
  abandonCompaction(threadId: string): void {
    if (this.#display.get(threadId)?.compaction?.status === "running") this.observeCompaction(threadId, "failed");
  }

  beginTurn(threadId: string): void {
    this.#awaitingPostCompaction.delete(threadId);
  }

  /** False while any provider thread of the agent compacts, or waits after a refused start. */
  mayDrain(agentId: string): boolean {
    return this.heldThreads(agentId).length === 0;
  }

  /** The provider threads of this agent that compact or wait after a refused start. Their lanes wait. */
  heldThreads(agentId: string): string[] {
    const held = new Set<string>();
    for (const [threadId, compaction] of this.#compacting) if (compaction.agentId === agentId) held.add(threadId);
    for (const [threadId, hold] of this.#refusals) if (hold.agentId === agentId) held.add(threadId);
    return [...held];
  }

  updateBudget(threadId: string, params: unknown): void {
    const usage = getRecord(params, "tokenUsage");
    const last = getRecord(usage, "last");
    const usedTokens = finiteNumberOrNull(last?.totalTokens);
    const contextWindow = finiteNumberOrNull(usage?.modelContextWindow);
    if (usedTokens === null || usedTokens < 0 || contextWindow === null || contextWindow <= 0) return;

    const budget = this.#budgets.get(threadId) ?? {
      usedTokens,
      contextWindow,
      pending: false,
      phase: "idle" as const,
      compactionTurnId: null,
      lastCompactedTokens: null,
    };
    budget.usedTokens = usedTokens;
    budget.contextWindow = contextWindow;
    this.#budgets.set(threadId, budget);

    const pressured = usedTokens / contextWindow >= CONTEXT_COMPACTION_THRESHOLD;
    if (!pressured) {
      budget.pending = false;
      budget.lastCompactedTokens = null;
      return;
    }
    if (budget.phase !== "idle") return;

    // Past the hard share the growth rule steps aside: a kept session that plateaus here would
    // otherwise never re-arm, because the growth it must show no longer fits in the window.
    if (usedTokens / contextWindow < CONTEXT_COMPACTION_ROTATE_SHARE) {
      const minimumGrowth = Math.max(1_024, Math.floor(contextWindow * 0.05));
      if (budget.lastCompactedTokens !== null && usedTokens < budget.lastCompactedTokens + minimumGrowth) {
        return;
      }
    }
    budget.pending = true;
  }

  contextInputCharacters(threadId: string): number {
    const budget = this.#budgets.get(threadId);
    // A session that `#rotate` started holds a window of 1 until its first usage report: no window is
    // known yet, and a budget of 2 characters would summarize the channel one character at a time.
    return budget && budget.contextWindow > 1 ? Math.min(120_000, Math.floor(budget.contextWindow * 2)) : 120_000;
  }

  /** `manual`: the user asked, so the thread compacts below the threshold too. */
  reserve(agentId: string, threadId: string, manual = false): boolean {
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const mode = agent ? this.#providers.clientForAgent(agent)?.contextCompaction : undefined;
    if (!agent || !compactsOnRequest(mode)) return false;
    if (mode === "handoff" && !this.#rotatesSession(agentId, threadId)) return false;
    const budget = this.#budgets.get(threadId);
    if (!(budget?.pending || (manual && budget)) || budget.phase !== "idle" || this.#compacting.has(threadId)) {
      return false;
    }
    budget.phase = "requested";
    this.#compacting.set(threadId, { agentId, client: null, ...(manual ? { manual } : {}) });
    this.observeCompaction(threadId, "running");
    return true;
  }

  readonly request = Effect.fn("ContextCompaction.request")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
  ) {
    const budget = this.#budgets.get(threadId);
    const agent = this.#store.list().find((candidate) => candidate.id === agentId);
    const client = agent ? this.#providers.clientForAgent(agent) : null;
    if (
      budget?.phase !== "requested" ||
      !client ||
      !compactsOnRequest(client.contextCompaction) ||
      !this.#providers.isReady()
    ) {
      if (budget?.phase === "requested") this.observeCompaction(threadId, "failed");
      this.#release(agentId, threadId);
      return;
    }
    if (client.contextCompaction === "handoff") {
      // The steward asks once whether the work has reached a stopping point. A "continue" keeps the
      // session; the growth rule re-asks only after the thread grew, so a kept session is not asked
      // again at every turn. A missing steward, a failed call, an unreadable answer, and a plain
      // "rotate" all fall back to the rotation the threshold would have made. Three cases skip the
      // question and rotate: the user asked for this compaction, the session is already in the top
      // share of its window, or it can no longer be replaced.
      const budget = this.#budgets.get(threadId);
      const hard =
        budget !== undefined &&
        budget.contextWindow > 1 &&
        budget.usedTokens / budget.contextWindow >= CONTEXT_COMPACTION_ROTATE_SHARE;
      const manual = this.#compacting.get(threadId)?.manual === true;
      const decision =
        !hard && !manual && this.#stewardDecide && this.#rotatesSession(agentId, threadId)
          ? yield* this.#stewardDecide({
              agentId,
              threadId,
              usedTokens: budget?.usedTokens ?? 0,
              contextWindow: budget?.contextWindow ?? 1,
              stewardAsks: this.#stewardAsks.get(threadId) ?? 0,
            }).pipe(Effect.catchCause(() => Effect.succeed<StewardDecision | null>(null)))
          : null;
      if (decision?.action === "continue") {
        this.#stewardAsks.set(threadId, (this.#stewardAsks.get(threadId) ?? 0) + 1);
        if (budget) budget.lastCompactedTokens = budget.usedTokens;
        // No compaction ran, so the ring shows no compaction rather than a failed one.
        this.#display.delete(threadId);
        this.#release(agentId, threadId);
        this.#emitChanged();
        this.#scheduleDrain(agentId);
        return;
      }
      yield* this.#rotate(agentId, threadId, client);
      return;
    }

    this.#compacting.set(threadId, { agentId, client });
    this.#clearTimer(threadId);
    const timer = setTimeout(() => {
      this.#emitError(
        "context_compaction_timeout",
        "Codex context compaction timed out; queued work will continue.",
        agentId,
      );
      const turnId = budget.compactionTurnId;
      if (budget.phase === "running" && turnId) this.#stop(agentId, threadId, client, turnId);
      else this.#abandon(agentId, threadId);
    }, this.#timeoutMs);
    timer.unref?.();
    this.#timers.set(threadId, timer);

    yield* client
      .request("thread/compact/start", { threadId }, decodeRecordResponse)
      .pipe(toContextCompactionFailed)
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (client.contextCompaction === "request" && budget.phase === "requested") {
              this.markCompacted(threadId);
              this.finish(agentId, threadId, "completed");
            }
          }),
        ),
        Effect.catch((failure) =>
          Effect.sync(() => {
            // Codex reported the compaction turn, so it runs whatever the answer was. Its end, or
            // the deadline, releases the queue.
            if (budget.phase === "running" || budget.phase === "stopping") return;
            budget.lastCompactedTokens = budget.usedTokens;
            this.#emitError("context_compaction_failed", failure.cause, agentId);
            this.observeCompaction(threadId, "failed");
            this.#release(agentId, threadId);
            this.#scheduleDrain(agentId);
          }),
        ),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            this.observeCompaction(threadId, "failed");
            this.#release(agentId, threadId);
            this.#scheduleDrain(agentId);
          }),
        ),
      );
  });

  /**
   * Takes ownership of a `turn/started` that belongs to a compaction we asked for. True means the
   * router must stop: this turn is not the agent's, so it gets no active turn and no event.
   */
  claimTurn(agentId: string, threadId: string, turnId: string): boolean {
    const budget = this.#budgets.get(threadId);
    if (budget?.phase !== "requested" || this.#compacting.get(threadId)?.agentId !== agentId) return false;
    budget.phase = "running";
    budget.compactionTurnId = turnId;
    return true;
  }

  isCompactionTurn(threadId: string, turnId: string): boolean {
    return this.#budgets.get(threadId)?.compactionTurnId === turnId;
  }

  markCompacted(threadId: string): void {
    const budget = this.#budgets.get(threadId);
    if (!budget) return;
    budget.pending = false;
    budget.lastCompactedTokens = budget.usedTokens;
  }

  finish(agentId: string, threadId: string, status: string): void {
    const budget = this.#budgets.get(threadId);
    if (budget && status !== "completed") {
      budget.lastCompactedTokens = budget.usedTokens;
      // A compaction that the deadline stopped was already reported as timed out.
      if (budget.phase !== "stopping")
        this.#emitError("context_compaction_failed", `Codex context compaction ended with status ${status}.`, agentId);
    }
    this.observeCompaction(threadId, status === "completed" ? "completed" : "failed");
    this.#release(agentId, threadId);
    this.#scheduleDrain(agentId);
  }

  /** Drops a retired provider thread's budget. The agent keeps compacting until `forgetAgent`. */
  forgetThread(threadId: string): void {
    this.#budgets.delete(threadId);
    this.#stewardAsks.delete(threadId);
    const displayed = this.#display.delete(threadId);
    this.#durations.delete(threadId);
    this.#awaitingPostCompaction.delete(threadId);
    if (displayed) this.#emitChanged();
    this.#clearTimer(threadId);
  }

  forgetAgent(agentId: string): void {
    for (const [threadId, compaction] of this.#compacting)
      if (compaction.agentId === agentId) this.#compacting.delete(threadId);
    for (const [threadId, hold] of this.#refusals) if (hold.agentId === agentId) this.#endRefusal(threadId, false);
  }

  /**
   * Codex refused input because a compaction turn runs on `threadId`, such as one that outlived its
   * deadline. The lane of that thread waits for a turn of it to end, for `graceMs` at most: a
   * refusal proves that nothing ran, so the next start can only be refused again.
   */
  holdForRefusal(agentId: string, threadId: string, client: AgentClient): void {
    this.#endRefusal(threadId, false);
    const timer = setTimeout(() => this.#endRefusal(threadId), this.#graceMs);
    timer.unref?.();
    this.#refusals.set(threadId, { agentId, client, timer });
  }

  /** A turn of this provider thread ended, so a queue that Codex refused for it can start again. */
  threadTurnEnded(threadId: string): void {
    this.#endRefusal(threadId);
  }

  /** The client stopped or exited, so the compactions and refusals it held end with it. */
  clientEnded(client: AgentClient): void {
    for (const [threadId, compaction] of this.#compacting) {
      if (compaction.client !== client) continue;
      this.observeCompaction(threadId, "failed");
      this.#release(compaction.agentId, threadId);
      this.#scheduleDrain(compaction.agentId);
    }
    for (const [threadId, hold] of this.#refusals) if (hold.client === client) this.#endRefusal(threadId);
  }

  dispose(): void {
    if (this.#usageTimer) clearTimeout(this.#usageTimer);
    this.#usageTimer = null;
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
    this.#compacting.clear();
    for (const hold of this.#refusals.values()) clearTimeout(hold.timer);
    this.#refusals.clear();
    this.#budgets.clear();
    this.#display.clear();
    this.#durations.clear();
    this.#stewardAsks.clear();
    this.#awaitingPostCompaction.clear();
  }

  /**
   * The deadline came while Codex runs the compaction turn. Codex refuses input until that turn
   * ends, so the queue waits for its `turn/completed`, and for `graceMs` at most.
   */
  #stop(agentId: string, threadId: string, client: AgentClient, turnId: string): void {
    const budget = this.#budgets.get(threadId);
    if (!budget) return;
    budget.phase = "stopping";
    const timer = setTimeout(() => this.#abandon(agentId, threadId), this.#graceMs);
    timer.unref?.();
    this.#timers.set(threadId, timer);
    Effect.runFork(
      client.request("turn/interrupt", { threadId, turnId }, decodeRecordResponse).pipe(
        Effect.catch(() =>
          Effect.sync(() => {
            // After `dispose`, a new compaction of this thread has its own budget.
            const current = this.#budgets.get(threadId) === budget;
            if (current && budget.phase === "stopping" && budget.compactionTurnId === turnId) {
              this.#abandon(agentId, threadId);
            }
          }),
        ),
      ),
    );
  }

  /**
   * A `handoff` compaction. The display moves to the new session: its first model call reports the
   * new usage, and until then the ring has no value to show.
   */
  readonly #rotate = Effect.fn("ContextCompaction.rotate")(function* (
    this: ContextCompaction,
    agentId: string,
    threadId: string,
    client: AgentClient,
  ) {
    // The hold keeps no client: `clientEnded` must not release the queue while the rotation runs.
    // The rotation ends the hold itself, also when the client exits.
    const compaction = this.#display.get(threadId)?.compaction;
    const compactedTokens = this.#budgets.get(threadId)?.usedTokens ?? null;
    // The session may have been replaced since the reservation. A note costs a paid model call, so
    // it is not written for a session that can no longer be rotated.
    if (!this.#rotatesSession(agentId, threadId)) {
      // End the running display, unless the retirement already dropped it with the thread.
      if (this.#display.has(threadId)) this.observeCompaction(threadId, "failed");
      this.#release(agentId, threadId);
      this.#emitChanged();
      this.#scheduleDrain(agentId);
      return;
    }
    // A note that cannot be written is not a reason to keep a full context: the mechanical packet
    // still carries the recent messages and the work steps, and the rotation goes on. The release
    // runs on every exit, including a defect inside the note or the rotation: a leaked hold would
    // stop every later turn of this agent.
    const next = yield* Effect.gen({ self: this }, function* () {
      // The note is optional, so its own defect must not stop the rotation.
      const note = this.#writeHandoffNote
        ? yield* this.#writeHandoffNote(agentId, threadId).pipe(Effect.catchCause(() => Effect.succeed(null)))
        : null;
      return yield* this.#rotateSession(agentId, client, threadId, note);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          this.#emitError("context_compaction_failed", cause, agentId);
          return undefined;
        }),
      ),
      Effect.ensuring(Effect.sync(() => this.#release(agentId, threadId))),
    );
    // No token comparison: the new session reports its usage during its first turn.
    if (next && compaction) {
      const { id, startedAt, expectedMs } = compaction;
      this.#display.set(next, {
        usage: null,
        compaction: { id, startedAt, status: "completed", ...(expectedMs === undefined ? {} : { expectedMs }) },
      });
    }
    // The growth rule moves to the new session, as it stays on a Codex thread: a session that starts
    // above the threshold does not rotate again at each turn.
    if (next)
      this.#budgets.set(next, {
        usedTokens: 0,
        contextWindow: 1,
        pending: false,
        phase: "idle",
        compactionTurnId: null,
        lastCompactedTokens: compactedTokens,
      });
    // A session that was not replaced keeps its budget; the growth rule stops an immediate retry.
    const budget = this.#budgets.get(threadId);
    if (budget) {
      budget.lastCompactedTokens = budget.usedTokens;
      this.observeCompaction(threadId, "failed");
    }
    this.#release(agentId, threadId);
    this.#emitChanged();
    this.#scheduleDrain(agentId);
  });

  /** Ends a compaction that did not end by itself, and lets the queue continue. */
  #abandon(agentId: string, threadId: string): void {
    this.observeCompaction(threadId, "failed");
    this.#release(agentId, threadId);
    this.#scheduleDrain(agentId);
  }

  #endRefusal(threadId: string, drain = true): void {
    const hold = this.#refusals.get(threadId);
    if (!hold) return;
    clearTimeout(hold.timer);
    this.#refusals.delete(threadId);
    if (drain) this.#scheduleDrain(hold.agentId);
  }

  #release(agentId: string, threadId: string): void {
    this.#clearTimer(threadId);
    const budget = this.#budgets.get(threadId);
    if (budget) {
      budget.pending = false;
      budget.phase = "idle";
      budget.compactionTurnId = null;
    }
    if (this.#compacting.get(threadId)?.agentId === agentId) this.#compacting.delete(threadId);
  }

  #clearTimer(threadId: string): void {
    const timer = this.#timers.get(threadId);
    if (timer) clearTimeout(timer);
    this.#timers.delete(threadId);
  }
}

class ContextCompactionFailed extends Schema.TaggedError<ContextCompactionFailed>()("ContextCompactionFailed", {
  cause: Schema.Defect(),
}) {}

const { rewrap: toContextCompactionFailed } = causeHelpers(ContextCompactionFailed);
