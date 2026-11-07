import type { AgentMessage } from "@openbot/ui/data";
import { AgentThreadView } from "@openbot/ui/features/conversation/threads/AgentThreadView";
import type { AgentThreadBranchSource } from "@openbot/ui/features/conversation/threads/BranchDivider";
import { createEffect, createProjection, createSignal, Show } from "solid-js";
import { toAgentMessages } from "../../app-message-projection";
import { useConversationViewScope } from "./conversation-scope";

/** The open side thread of the agent, in the place of the agent's own chat and its message box. */
export function ConversationThread() {
  const { props, openExternalMessageUrl, previewAttachment, attachmentAction, copiedMessageId, copyMessage } =
    useConversationViewScope();
  /** Reconciled by id, so a stream chunk redraws only the message that changed. */
  const messages = createProjection<AgentMessage[]>(
    () => {
      const conversation = props.threads?.conversation;
      return conversation ? toAgentMessages(conversation.messages, props.agent?.id) : [];
    },
    [],
    { key: "id" },
  );
  /** Whether the first message of the new thread runs in its own git worktree of the workspace. */
  const [isolatedWorktree, setIsolatedWorktree] = createSignal(false);
  // The wish belongs to one new thread: it does not carry to the next one, as the draft does not.
  createEffect(
    () => props.threads?.open?.id ?? null,
    () => {
      setIsolatedWorktree(false);
    },
  );
  const view = () => {
    const agent = props.agent;
    const threads = props.threads;
    return agent && threads ? { agent, threads } : undefined;
  };
  /** Branches the open thread through an answer. A new thread has no answer to branch from. */
  const branch = (threads: NonNullable<ReturnType<typeof view>>["threads"]) => {
    const taskId = threads.open?.id;
    if (!threads.onBranch || !taskId) return undefined;
    return (messageId: string) => void threads.onBranch?.(taskId, messageId);
  };
  /** Where the open thread came from, when it is a branch. The agent's own chat shows the agent's name. */
  const branchSource = (
    threads: NonNullable<ReturnType<typeof view>>["threads"],
  ): AgentThreadBranchSource | undefined => {
    const source = threads.open ? threads.branchSource(threads.open) : undefined;
    if (!source) return undefined;
    return {
      throughMessageId: source.throughMessageId,
      label: source.deleted ? null : (source.title ?? props.agent?.name ?? null),
      onOpen: source.onOpen,
    };
  };
  /** The message that the open thread scrolls to once, after a click on "Branched from". */
  const focusMessage = (threads: NonNullable<ReturnType<typeof view>>["threads"]) => {
    const focus = threads.focusMessage;
    return focus && focus.taskId === threads.open?.id ? focus : undefined;
  };
  return (
    <Show when={view()}>
      {(current) => (
        <AgentThreadView
          task={current().threads.open ?? null}
          limit={current().threads.limit}
          agent={current().agent}
          agents={props.agents}
          messages={messages}
          onSend={async (text) => {
            const sent = await current().threads.onSend(text, { isolatedWorktree: isolatedWorktree() });
            // The wish belongs to one new thread: it does not carry to the next draft.
            if (sent) setIsolatedWorktree(false);
            return sent;
          }}
          onStop={() => current().threads.onStop()}
          onOpenLink={(url) => void openExternalMessageUrl(url)}
          onPreview={(attachment) => void previewAttachment(attachment)}
          onAttachmentAction={attachmentAction}
          approval={current().threads.approval}
          onRespondApproval={(decision) => current().threads.onRespondApproval(decision)}
          onCopyMessage={(message) => copyMessage(message)}
          copiedMessageId={copiedMessageId() ?? undefined}
          onBranch={branch(current().threads)}
          branchSource={branchSource(current().threads)}
          focusMessage={focusMessage(current().threads)}
          isolatedWorktree={isolatedWorktree()}
          onIsolatedWorktreeChange={current().threads.open === null ? setIsolatedWorktree : undefined}
        />
      )}
    </Show>
  );
}
