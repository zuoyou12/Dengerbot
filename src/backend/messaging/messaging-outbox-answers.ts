// The answers the `messaging_post` tool gives for a post that the outbox holds. The agent reads them,
// so each one says what happened and whether sending the text again would post it twice.

import type { MessagingOutboxDropReason } from "./messaging-outbox-store";

/**
 * The post is recorded and waits for its turn, or for its connection to run. The agent must not send
 * the same text again: the row goes out on its own.
 */
export const MESSAGING_OUTBOX_QUEUED_ANSWER =
  "The post is recorded and will go out when its turn comes; a post to a chat that is not answering " +
  "goes out when the chat is back. Do not send the same text again.";

/** The answer for a post that ended without going out, by its reason. */
export function messagingOutboxDroppedAnswer(reason: MessagingOutboxDropReason): string {
  switch (reason) {
    case "refused":
      return "The connection refused the post: it does not take posts for that chat. Nothing was sent.";
    case "send-failed":
      return (
        "The platform rejected the post. A long text goes in more than one post, so a part of it " +
        "can be posted already. Do not post it again only because of this error."
      );
    case "gone":
      return "The connection was deleted or closed while the post waited, so nothing was sent.";
    case "expired":
      return (
        "The post waited for more than a day and expired. Nothing was sent. Send it again only if " +
        "it is still worth posting."
      );
    case "restart":
      return (
        "Dengerbot restarted while the post was on its way, so whether the platform received it is " +
        "not known. Do not send the same text again."
      );
  }
}
