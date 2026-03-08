import { describe, expect, it } from "vitest";

import { getMemberHistory, getMessageHandlers, getMessageRecipientHandles } from "@/lib/message-feed";
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
        "先整理需求边界，然后 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。",
      ]),
    );
    expect(history.find((entry) => entry.message.author.kind === "member")?.contextBadges.map((badge) => badge.label)).toContain("Reply");
    expect(history.find((entry) => entry.message.author.kind !== "member")?.contextBadges.map((badge) => badge.label)).toContain("Accepted");
  });
});
