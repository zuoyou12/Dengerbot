import type { ChildProcess } from "node:child_process";
import { type AgentProviderId, isAgentProvider } from "@openbot/contracts/agent-providers";

/**
 * The provider CLI processes that OpenBot started, by PID. The resource monitor reads it to attribute
 * a process tree to a provider. It holds a closed-set provider id, or `acp` for a process this build
 * cannot name, and never a command line or a path.
 */
const processes = new Map<number, AgentProviderId>();

/**
 * Records a provider CLI until it exits. A process that is not one of this build's providers counts
 * as `acp`, the protocol that used to run a custom agent, so the resource monitor can still group it.
 */
export function registerProviderProcess(child: ChildProcess, provider: string): void {
  const pid = child.pid;
  if (pid === undefined) return;
  processes.set(pid, isAgentProvider(provider) ? provider : ("acp" as AgentProviderId));
  child.once("exit", () => {
    processes.delete(pid);
  });
}

export function providerProcessIds(): ReadonlyMap<number, AgentProviderId> {
  return processes;
}
