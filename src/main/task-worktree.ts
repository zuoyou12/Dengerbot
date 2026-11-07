// One git worktree of the agent's workspace for each task that asked for isolation. A task that runs
// in its own worktree cannot touch the files the other tasks of the workspace share, and its file
// work never appears in the workspace itself.
//
// The safety rules follow deepseek-harness `packages/experimental/worktree` (MIT): the branch name is
// checked before git sees it, the checkout pins the commit `HEAD^{commit}` names at the start, a
// same-name branch is refused instead of reused, and a worktree of the same task is returned as it
// is. Nothing here ever deletes a checkout or a branch: the checkout and its branch belong to the
// user, and the store row that names the path outlives the thread.
//
// The worktree directory is a sibling of the workspace, so it stays out of every file listing of the
// workspace and the user can find it. Git's own environment selectors are cleared for every child
// call: an inherited GIT_DIR or GIT_WORK_TREE would silently point a call at another repository.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The git environment variables that select a repository or change what a command reads. */
const GIT_SELECTOR_ENV_VARS: readonly string[] = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_LITERAL_PATHSPECS",
  "GIT_GLOB_PATHSPECS",
  "GIT_NOGLOB_PATHSPECS",
  "GIT_ICASE_PATHSPECS",
  "GIT_OPTIONAL_LOCKS",
  "GIT_ATTR_NOSYSTEM",
];

const GIT_TIMEOUT_MS = 30_000;
/** One git answer is a line of text; a runaway repository must not fill the memory. */
const GIT_MAX_OUTPUT = 1_000_000;
const TASK_BRANCH_PREFIX = "dengerbot-task/";
const THREAD_ID_IN_BRANCH = 40;

export type TaskWorktreeFailureReason = "not-a-repository" | "bad-thread-id" | "branch-taken" | "git-failed";

export class TaskWorktreeFailed extends Error {
  readonly reason: TaskWorktreeFailureReason;

  constructor(reason: TaskWorktreeFailureReason, cause?: unknown) {
    super(reason === "git-failed" ? "The git worktree could not be created." : `The task worktree failed: ${reason}.`);
    this.name = "TaskWorktreeFailed";
    this.reason = reason;
    if (cause) this.cause = cause;
  }
}

type GitRun = (args: readonly string[], options: { cwd: string }) => Promise<string>;

/** Runs git with the selector environment cleared, a timeout and an output cap. */
const gitRun: GitRun = (args, options) =>
  new Promise((resolve, reject) => {
    const environment: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (GIT_SELECTOR_ENV_VARS.includes(key)) continue;
      environment[key] = value;
    }
    environment.GIT_TERMINAL_PROMPT = "0";
    execFile(
      "git",
      args,
      {
        cwd: options.cwd,
        env: environment,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          error.message = `git ${args[0]} failed: ${String(stderr).trim() || error.message}`;
          reject(error);
          return;
        }
        resolve(String(stdout));
      },
    );
  });

/** The branch a task's worktree is checked out on. The thread id is the branch's only variable part. */
export function taskWorktreeBranch(threadId: string): string {
  const safe = threadId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, THREAD_ID_IN_BRANCH);
  if (!safe) throw new TaskWorktreeFailed("bad-thread-id");
  return `${TASK_BRANCH_PREFIX}${safe}`;
}

/** The folder a task's worktree lives in: beside the workspace, named after it and the thread. */
export function taskWorktreePath(workspacePath: string, threadId: string): string {
  const parent = dirname(workspacePath);
  const stem = threadId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  const name = `${basename(workspacePath)}-task-${stem || "task"}`;
  let candidate = join(parent, name);
  for (let suffix = 2; existsSync(candidate); suffix += 1) candidate = join(parent, `${name}-${suffix}`);
  return candidate;
}

/**
 * Creates (or returns) the worktree of one task. `existingPath` is the path the store row names, if
 * there is one: a checkout that still answers git is returned as it is, and the same task never gets
 * a second one. The workspace must be a git repository, and its branch for this task must be free.
 */
export async function createTaskWorktree(
  workspacePath: string,
  threadId: string,
  existingPath: string | null,
  run: GitRun = gitRun,
): Promise<string> {
  // A checkout of the same task is reused as it is, branch and all; git answers for it.
  if (existingPath && existsSync(join(existingPath, ".git"))) {
    await run(["rev-parse", "--show-toplevel"], { cwd: existingPath });
    return existingPath;
  }
  const branch = taskWorktreeBranch(threadId);
  await run(["check-ref-format", "--branch", branch], { cwd: workspacePath }).catch(() => {
    throw new TaskWorktreeFailed("bad-thread-id");
  });
  let root: string;
  try {
    root = (await run(["rev-parse", "--show-toplevel"], { cwd: workspacePath })).trim();
  } catch {
    throw new TaskWorktreeFailed("not-a-repository");
  }
  // The commit is read once and pinned: a commit made while the checkout runs changes nothing here.
  let commit: string;
  try {
    commit = (await run(["rev-parse", "HEAD^{commit}"], { cwd: root })).trim();
  } catch {
    throw new TaskWorktreeFailed("not-a-repository");
  }
  try {
    await run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root });
    // The branch exists: it belongs to a checkout this store does not know, so the task gets none.
    throw new TaskWorktreeFailed("branch-taken");
  } catch (error) {
    if (error instanceof TaskWorktreeFailed) throw error;
  }
  const path = taskWorktreePath(root, threadId);
  // --no-checkout first: the checkout happens with the reset, inside the new worktree only, so the
  // workspace's own index and its uncommitted files are never touched.
  await run(["worktree", "add", "--no-checkout", "-b", branch, path, commit], { cwd: root }).catch((cause) => {
    throw new TaskWorktreeFailed("git-failed", cause);
  });
  await run(["reset", "--hard", commit], { cwd: path }).catch((cause) => {
    throw new TaskWorktreeFailed("git-failed", cause);
  });
  return path;
}
