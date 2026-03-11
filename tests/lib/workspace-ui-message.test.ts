import { describe, expect, it } from "vitest";

import { postMemberMessage } from "@/domain/workspace";
import { createRuntimeContext } from "@/domain/identity";
import { mapRoomMessagesToUIMessages } from "@/lib/chat/workspace-ui-message";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("workspace-ui-message mapping", () => {
  it("keeps handler summaries on user messages but hides internal handler state on member-authored messages", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const messages = mapRoomMessagesToUIMessages(snapshot, room);

    const userMessage = messages.find((message) => message.metadata?.authorKind === "user");
    const memberMessages = messages.filter((message) => message.metadata?.authorKind === "member");

    expect(userMessage?.metadata?.handlerSummaries?.length ?? 0).toBeGreaterThan(0);
    expect(memberMessages.every((message) => (message.metadata?.handlerSummaries?.length ?? 0) === 0)).toBe(true);
  });

  it("hides direct messages from the main room transcript", () => {
    const context = createRuntimeContext();
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "lead")!;

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId: room.id,
        memberId: lead.id,
        content: "只在私聊里回复",
        directToUser: true,
      },
      context,
    );

    const messages = mapRoomMessagesToUIMessages(snapshot, room);

    expect(messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("只在私聊里回复")))).toBe(false);
  });

  it("hides persisted public watcher digests from the main room transcript", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];

    snapshot.messages.message_watch_legacy = {
      id: "message_watch_legacy",
      roomId: room.id,
      author: { kind: "system", id: "system", label: "Watcher" },
      content: "Legacy watcher digest",
      createdAt: "2026-03-10T10:10:00.000Z",
      transport: "watch-digest",
      status: "sent",
      visibility: "public",
      mentionedMemberIds: [],
      recipientMemberIds: [room.memberIds[0]],
    };
    snapshot.messageOrderByRoom[room.id] = [...snapshot.messageOrderByRoom[room.id], "message_watch_legacy"];

    const messages = mapRoomMessagesToUIMessages(snapshot, room);

    expect(messages.some((message) => message.parts.some((part) => part.type === "text" && part.text.includes("Legacy watcher digest")))).toBe(false);
  });
});
