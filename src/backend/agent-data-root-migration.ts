import { cp, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect } from "effect";
import { writeFileAtomically, writeJsonFileAtomically } from "./atomic-json-file";
import { isRecord } from "./protocol";
import { StoredStateFailure, storedIO } from "./stored-state-effects";

/** Where a move that has not finished rewrites the database yet keeps its two roots. */
export const AGENT_DATA_ROOT_MOVE_FILE = "agent-data-root-move-v1.json";

/**
 * The root the database of this profile names. A profile of its own has an `openbot.db` of its own,
 * so two profiles that shared one root before this file existed cannot learn from each other that
 * the move happened. The file makes the rewrite a single check on later starts instead of a scan of
 * every text column on each launch.
 */
export const AGENT_DATA_ROOT_STATE_FILE = "agent-data-root-v1.json";

export interface AgentDataRootMove {
  readonly from: string;
  readonly to: string;
}

// Windows answers `EBUSY` or `EPERM` while a file in the tree is still open: a provider process that
// is exiting after its session closed, an antivirus scan or the search indexer. Node retries these
// codes with a growing delay, about 8 seconds in total, before the deletion reports a failure. The
// Claude SDK's close does not wait for the `claude` process. On Windows it kills a process that has
// not exited after 7 seconds, so a shorter wait fails a delete that a retry then completes. The
// store uses the same wait to remove one agent's files.
export const AGENT_FILES_REMOVAL = { recursive: true, force: true, maxRetries: 10, retryDelay: 150 } as const;

const logger = createOpenBotLogger("agent-data-root");

/**
 * Moves the folders of a root that a previous release used into the configured root.
 *
 * Three steps make the move safe to interrupt. The marker file is written before any file moves, a
 * copy is verified against the source before the source is deleted, and the marker stays until the
 * caller has rewritten the database. A crash at any point therefore resumes the move or the rewrite
 * instead of leaving the database naming a folder that holds nothing. Returns the move whose stored
 * paths are still to be rewritten, or `null` when there is nothing to do.
 */
export const moveAgentDataRoot = Effect.fn("AgentDataRoot.move")(function* (input: {
  from: string;
  to: string;
  markerPath: string;
}): Effect.fn.Return<AgentDataRootMove | null, StoredStateFailure> {
  try {
    const recorded = yield* storedIO(() => readRootMove(input.markerPath));
    const pending =
      recorded === null
        ? input.from === input.to
          ? null
          : { from: input.from, to: input.to }
        : // A different root than the marker names means the setting changed between two starts.
          // The files are already at the marker's destination, so that is the move that resumes.
          { from: recorded.to === input.to ? recorded.from : recorded.to, to: input.to };
    if (pending === null) return null;
    if (!(yield* storedIO(() => pathExists(pending.from)))) {
      // Without a marker, a missing source is a fresh install, not a resumed move.
      return recorded === null ? null : pending;
    }
    yield* writeFileAtomically(input.markerPath, `${JSON.stringify({ version: 1, ...pending })}\n`, {
      createDirectory: true,
    }).pipe(Effect.mapError((cause) => new StoredStateFailure({ cause })));
    // A marker means an earlier run wrote the destination, so a file it left half-copied is replaced.
    // Without one, the destination may hold files that are not this move's to overwrite.
    yield* storedIO(() => moveTree(pending.from, pending.to, recorded !== null));
    logger.info("Moved the agent data folders to their configured root.", toLogValue(pending));
    return pending;
  } catch (cause) {
    return yield* new StoredStateFailure({ cause });
  }
});

/** Removes the marker once the database names the new root. */
export const completeAgentDataRootMove = Effect.fn("AgentDataRoot.complete")(function* (
  markerPath: string,
): Effect.fn.Return<void, StoredStateFailure> {
  try {
    yield* storedIO(() => rm(markerPath, { force: true }));
  } catch (cause) {
    return yield* new StoredStateFailure({ cause });
  }
});

/** The root that this profile's database already names, or `null` before the first rewrite. */
export const readAgentDataRootState = Effect.fn("AgentDataRoot.readState")(function* (
  statePath: string,
): Effect.fn.Return<string | null, StoredStateFailure> {
  try {
    return yield* storedIO(() => readStateRoot(statePath));
  } catch (cause) {
    return yield* new StoredStateFailure({ cause });
  }
});

export const writeAgentDataRootState = Effect.fn("AgentDataRoot.writeState")(function* (
  statePath: string,
  root: string,
): Effect.fn.Return<void, StoredStateFailure> {
  try {
    yield* writeJsonFileAtomically(statePath, { version: 1, root }, { createDirectory: true }).pipe(
      Effect.mapError((cause) => new StoredStateFailure({ cause })),
    );
  } catch (cause) {
    return yield* new StoredStateFailure({ cause });
  }
});

/**
 * A rename is a single syscall on one volume, so the folder either moves or stays. A second volume
 * cannot be renamed onto, and a destination that an interrupted run has already made is merged into
 * instead. On the first attempt the copy keeps what is already at the destination, because those
 * files are not this move's to overwrite. A resumed attempt replaces them, because a crash in the
 * middle of a copy can leave one of them incomplete.
 */
async function moveTree(from: string, to: string, resume: boolean): Promise<void> {
  if (!(await pathExists(to))) {
    // `mkdir` on a drive root answers EPERM on Windows even though the root exists, and the parent
    // of `D:\DengerBot` is exactly `D:\`. Create the parent only when it is missing.
    const parent = dirname(to);
    if (!(await pathExists(parent))) await mkdir(parent, { recursive: true, mode: 0o700 });
    try {
      await rename(from, to);
      return;
    } catch (error) {
      // The source disappeared between the check above and the rename: there is nothing left to move.
      if (errorCode(error) === "ENOENT") return;
    }
  }
  await mkdir(to, { recursive: true, mode: 0o700 });
  await cp(from, to, {
    recursive: true,
    force: resume,
    errorOnExist: false,
    preserveTimestamps: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  await verifyTree(from, to);
  await rm(from, AGENT_FILES_REMOVAL);
}

/**
 * Every file and link the source holds must be at the destination with the same size, or with the
 * same link target. A copy that fails this check is not a move that may delete the source.
 */
async function verifyTree(from: string, to: string): Promise<void> {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      await verifyTree(source, target);
      continue;
    }
    if (entry.isSymbolicLink()) {
      const [original, copied] = await Promise.all([readlink(source), readlink(target).catch(() => null)]);
      if (original !== copied) throw new Error(`The moved folder does not hold the link "${entry.name}".`);
      continue;
    }
    const [original, copied] = await Promise.all([stat(source), stat(target).catch(() => null)]);
    if (copied === null || copied.size !== original.size) {
      throw new Error(`The moved folder does not hold a complete copy of "${entry.name}".`);
    }
  }
}

async function readRootMove(markerPath: string): Promise<AgentDataRootMove | null> {
  let contents: string;
  try {
    contents = await readFile(markerPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    // The marker is written atomically, so a marker this build cannot read is not a move that this
    // build started. Stopping is safer than guessing which root still needs its paths rewritten.
    throw new Error(`The agent data root move file "${markerPath}" is not readable JSON.`);
  }
  if (!isRecord(value) || !isString(value.from) || !isString(value.to)) {
    throw new Error(`The agent data root move file "${markerPath}" does not name two roots.`);
  }
  return { from: value.from, to: value.to };
}

/**
 * A state file this build cannot read is treated as absent: the rewrite that follows starts from the
 * pre-fork root, which is a no-op when the stored paths already name a newer root.
 */
async function readStateRoot(statePath: string): Promise<string | null> {
  let contents: string;
  try {
    contents = await readFile(statePath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
  try {
    const value = JSON.parse(contents);
    return isRecord(value) && isString(value.root) ? value.root : null;
  } catch {
    return null;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && isString(error.code) ? error.code : undefined;
}
