import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import type { ChatMessage } from "@/domain/model";
import { postMemberMessage } from "@/domain/workspace";
import { getMemberHistory, getMessageHandlers, getMessageMentionHandles, getMessageRecipientHandles } from "@/lib/message-feed";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("message feed helpers", () => {
  it("resolves recipients and handlers for routed user messages", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId;
    if (!roomId) {
      throw new Error("Expected a selected room");
    }

    const room = snapshot.rooms[roomId];
    const firstMessageId = snapshot.messageOrderByRoom[room.id]?.[0];
    if (!firstMessageId) {
      throw new Error("Expected at least one room message");
    }

    const firstMessage = snapshot.messages[firstMessageId];

    expect(firstMessage.author.kind).toBe("user");
    expect(getMessageRecipientHandles(snapshot, room, firstMessage)).toEqual(["lead"]);
    expect(getMessageHandlers(snapshot, firstMessage)).toMatchObject([
      {
        handle: "lead",
        status: "completed",
        title: "Respond to user",
      },
    ]);
  });

  it("builds a per-member history from received and authored messages", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId;
    if (!roomId) {
      throw new Error("Expected a selected room");
    }

    const room = snapshot.rooms[roomId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "lead");
    if (!lead) {
      throw new Error("Expected a lead member");
    }

    const history = getMemberHistory(snapshot, room, lead);

    expect(history.map((entry) => entry.message.content)).toEqual(
      expect.arrayContaining([
        "做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品",
        "@builder @research 先整理需求边界，然后由 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。",
      ]),
    );
    expect(history.find((entry) => entry.message.author.kind === "member")?.contextBadges.map((badge) => badge.label)).toContain("Reply");
    expect(history.find((entry) => entry.message.author.kind !== "member")?.contextBadges.map((badge) => badge.label)).toContain("Accepted");
  });

  it("labels direct replies to the user as going to You", () => {
    const context = createRuntimeContext();
    let snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "lead")!;

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: lead.id,
        content: "DM-OK",
        directToUser: true,
      },
      context,
    );

    const message = snapshot.messages[snapshot.messageOrderByRoom[roomId].at(-1)!];

    expect(getMessageRecipientHandles(snapshot, room, message)).toEqual(["You"]);
  });

  it("includes human handles in mentions and direct recipients", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];

    snapshot.humans = {
      human_alice: {
        id: "human_alice",
        roomId,
        displayName: "Alice",
        handle: "alice",
        kind: "human",
      },
    };
    snapshot.humanOrderByRoom = {
      [roomId]: ["human_alice"],
    };

    const message: ChatMessage = {
      id: "message_human_recipient",
      roomId,
      author: { kind: "member", id: room.entryMemberId, label: "Lead", handle: "lead" },
      content: "@alice 请确认目录",
      createdAt: "2026-03-09T07:35:00.000Z",
      transport: "direct",
      status: "sent",
      mentionedMemberIds: [],
      mentionedHumanIds: ["human_alice"],
      quotedMemberIds: [],
      recipientMemberIds: [],
      recipientHumanIds: ["human_alice"],
    };

    expect(getMessageMentionHandles(snapshot, message)).toEqual(["alice"]);
    expect(getMessageRecipientHandles(snapshot, room, message)).toEqual(["alice"]);
  });

  it("routes actor-based human room messages to the entry member", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const firstMessageId = snapshot.messageOrderByRoom[roomId]?.[0];

    if (!firstMessageId) {
      throw new Error("Expected at least one room message");
    }

    snapshot.humans = {
      human_alice: {
        id: "human_alice",
        roomId,
        displayName: "Alice",
        handle: "alice",
        kind: "human",
      },
    };
    snapshot.humanOrderByRoom = {
      [roomId]: ["human_alice"],
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

    expect(getMessageRecipientHandles(snapshot, room, snapshot.messages[firstMessageId])).toEqual(["lead"]);
  });

  it("treats bot-shaped authors as authored replies in member history", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "lead");

    if (!lead) {
      throw new Error("Expected a lead member");
    }

    const replyMessageId = snapshot.messageOrderByRoom[roomId].find((messageId) => snapshot.messages[messageId]?.author.kind === "member");

    if (!replyMessageId) {
      throw new Error("Expected a member-authored reply");
    }

    snapshot.messages[replyMessageId] = {
      ...snapshot.messages[replyMessageId],
      author: {
        kind: "bot",
        actorKind: "bot",
        id: lead.id,
        memberId: lead.id,
        label: lead.name,
        handle: lead.handle,
      },
    };

    const history = getMemberHistory(snapshot, room, lead);
    const replyEntry = history.find((entry) => entry.message.id === replyMessageId);

    expect(replyEntry?.contextBadges.map((badge) => badge.label)).toContain("Reply");
  });
});
