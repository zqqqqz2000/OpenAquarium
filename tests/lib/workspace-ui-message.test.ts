import { describe, expect, it } from "vitest";

import { postMemberMessage, postSystemMessage } from "@/domain/workspace";
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

  it("shows room status messages in the main room transcript", () => {
    const context = createRuntimeContext();
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];

    snapshot = postSystemMessage(
      snapshot,
      {
        roomId: room.id,
        label: "Task status",
        transport: "status",
        content: "@lead 任务执行失败：当前任务在 300 秒内没有新的进度或完成信号。",
      },
      context,
    );

    const messages = mapRoomMessagesToUIMessages(snapshot, room);

    expect(messages.some((message) => message.metadata?.transport === "status" && message.parts.some((part) => part.type === "text" && part.text.includes("任务执行失败")))).toBe(true);
  });

  it("maps actor-based human authors to user messages and keeps handler summaries", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const firstMessageId = snapshot.messageOrderByRoom[room.id]?.[0];

    if (!firstMessageId) {
      throw new Error("Expected at least one room message");
    }

    snapshot.humans = {
      human_alice: {
        id: "human_alice",
        roomId: room.id,
        displayName: "Alice",
        handle: "alice",
        kind: "human",
      },
    };
    snapshot.humanOrderByRoom = {
      [room.id]: ["human_alice"],
    };
    snapshot.messages[firstMessageId] = {
      ...snapshot.messages[firstMessageId],
      author: {
        kind: "human",
        actorKind: "human",
        id: "human_alice",
        humanId: "human_alice",
        label: "Alice",
        handle: "alice",
      },
    };

    const messages = mapRoomMessagesToUIMessages(snapshot, room);
    const userMessage = messages.find((message) => message.id === firstMessageId);

    expect(userMessage?.role).toBe("user");
    expect(userMessage?.metadata?.authorKind).toBe("human");
    expect(userMessage?.metadata?.handlerSummaries?.length ?? 0).toBeGreaterThan(0);
  });

  it("preserves memberId for bot-shaped assistant authors", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const replyMessageId = snapshot.messageOrderByRoom[room.id]?.find(
      (messageId) => snapshot.messages[messageId]?.author.kind === "member",
    );

    if (!replyMessageId) {
      throw new Error("Expected a member-authored reply");
    }

    const replyMessage = snapshot.messages[replyMessageId];
    const author = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.id === replyMessage.author.id);

    if (!author) {
      throw new Error("Expected reply author to resolve to a room member");
    }

    snapshot.messages[replyMessageId] = {
      ...replyMessage,
      author: {
        kind: "bot",
        actorKind: "bot",
        id: author.id,
        memberId: author.id,
        label: author.name,
        handle: author.handle,
      },
    };

    const messages = mapRoomMessagesToUIMessages(snapshot, room);
    const assistantMessage = messages.find((message) => message.id === replyMessageId);

    expect(assistantMessage?.role).toBe("assistant");
    expect(assistantMessage?.metadata?.memberId).toBe(author.id);
  });
});
