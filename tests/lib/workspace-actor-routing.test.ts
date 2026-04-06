import { describe, expect, it } from "vitest";

import { syncUnreadStateForMessage } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("workspace actor routing compatibility", () => {
  it("counts bot-authored messages in unread state like legacy member messages", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    snapshot.rooms[roomId] = {
      ...room,
      visibleMemberIds: [builder.id],
      unreadMemberMessageCount: 0,
    };
    snapshot.messages.message_bot_actor = {
      id: "message_bot_actor",
      roomId,
      author: {
        kind: "bot",
        actorKind: "bot",
        id: builder.id,
        memberId: builder.id,
        label: builder.name,
        handle: builder.handle,
      },
      content: "bot actor message",
      createdAt: "2026-03-10T10:30:00.000Z",
      transport: "group",
      status: "sent",
      visibility: "public",
      mentionedMemberIds: [],
      quotedMemberIds: [],
      recipientMemberIds: [],
      recipientHumanIds: [],
    };
    snapshot.messageOrderByRoom[roomId] = [...snapshot.messageOrderByRoom[roomId], "message_bot_actor"];

    const updated = syncUnreadStateForMessage(snapshot, "message_bot_actor");

    expect(updated.rooms[roomId].unreadMemberMessageCount).toBe(1);
  });
});
