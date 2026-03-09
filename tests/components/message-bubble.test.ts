import { describe, expect, it } from "vitest";

import type { MessageBubbleProps } from "@/components/chat/message-bubble";
import { MESSAGE_BUBBLE_PREVIEW_CHAR_LIMIT, getCollapsedMessageContent } from "@/components/chat/message-content";
import { areMessageBubblePropsEqual } from "@/components/chat/message-bubble-equality";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { getMessageHandlers, getMessageMentionHandles, getMessageRecipientHandles } from "@/lib/message-feed";

function createProps(): MessageBubbleProps {
  const snapshot = createSeedWorkspace();
  const roomId = snapshot.selection.roomId;
  if (!roomId) {
    throw new Error("Expected seeded workspace to include a selected room");
  }
  const room = snapshot.rooms[roomId];
  const firstMessageId = snapshot.messageOrderByRoom[room.id]?.[0];
  if (!firstMessageId) {
    throw new Error("Expected seeded workspace to include at least one message");
  }
  const message = snapshot.messages[firstMessageId];
  const authorMember = message.author.kind === "member" ? snapshot.members[message.author.id] : undefined;

  return {
    message,
    authorMember,
    mentionedHandles: getMessageMentionHandles(snapshot, message),
    recipientHandles: getMessageRecipientHandles(snapshot, room, message),
    handlerSummaries: getMessageHandlers(snapshot, message),
    contextBadges: [],
    onAuthorClick: () => undefined,
  };
}

describe("MessageBubble memo comparison", () => {
  it("treats cloned props with the same visible values as equal", () => {
    const previous = createProps();
    const next: MessageBubbleProps = {
      ...previous,
      message: {
        ...previous.message,
        mentionedMemberIds: [...previous.message.mentionedMemberIds],
        recipientMemberIds: [...previous.message.recipientMemberIds],
      },
      authorMember: previous.authorMember ? { ...previous.authorMember } : undefined,
      mentionedHandles: [...(previous.mentionedHandles ?? [])],
      recipientHandles: [...(previous.recipientHandles ?? [])],
      handlerSummaries: [...(previous.handlerSummaries ?? [])],
      contextBadges: [...(previous.contextBadges ?? [])],
      onAuthorClick: () => undefined,
    };

    expect(areMessageBubblePropsEqual(previous, next)).toBe(true);
  });

  it("detects streaming body changes", () => {
    const previous = createProps();
    const next: MessageBubbleProps = {
      ...previous,
      message: {
        ...previous.message,
        content: `${previous.message.content}\nnew chunk`,
      },
    };

    expect(areMessageBubblePropsEqual(previous, next)).toBe(false);
  });

  it("collapses oversized message bodies for transcript previews", () => {
    const collapsed = getCollapsedMessageContent("x".repeat(MESSAGE_BUBBLE_PREVIEW_CHAR_LIMIT + 25));

    expect(collapsed.collapsed).toBe(true);
    expect(collapsed.preview).toContain("[message collapsed]");
    expect(collapsed.preview.length).toBeLessThan(MESSAGE_BUBBLE_PREVIEW_CHAR_LIMIT + 40);
  });
});
