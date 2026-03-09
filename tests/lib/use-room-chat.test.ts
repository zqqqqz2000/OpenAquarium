import { describe, expect, it } from "vitest";

import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { describeActiveMemberStreams, resolvePrimaryMemberId } from "@/lib/chat/use-room-chat";

describe("useRoomChat helpers", () => {
  it("prefers an explicit direct member target", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const membersById = Object.fromEntries(room.memberIds.map((memberId) => [memberId, snapshot.members[memberId]]));
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder");

    expect(
      resolvePrimaryMemberId({
        room,
        membersById,
        content: "先交给入口成员处理。",
        directMemberId: builder?.id,
      }),
    ).toBe(builder?.id);
  });

  it("routes mentions using room member order, matching domain routing", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const membersById = Object.fromEntries(room.memberIds.map((memberId) => [memberId, snapshot.members[memberId]]));
    const firstMentionedByRoomOrder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "research");

    expect(
      resolvePrimaryMemberId({
        room,
        membersById,
        content: "@scribe 先记录一下，然后 @research 再补充事实。",
      }),
    ).toBe(firstMentionedByRoomOrder?.id);
  });

  it("falls back to the entry member for plain group messages", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const membersById = Object.fromEntries(room.memberIds.map((memberId) => [memberId, snapshot.members[memberId]]));

    expect(
      resolvePrimaryMemberId({
        room,
        membersById,
        content: "先接住这条消息。",
      }),
    ).toBe(room.entryMemberId);
  });

  it("summarizes one or many active member streams", () => {
    expect(
      describeActiveMemberStreams([
        {
          roomId: "room_1",
          taskId: "task_1",
          memberId: "member_1",
          memberName: "Lead Koi",
          memberHandle: "lead",
          summary: "正在整理问题",
        },
      ]),
    ).toBe("@lead 正在处理: 正在整理问题");

    expect(
      describeActiveMemberStreams([
        {
          roomId: "room_1",
          taskId: "task_1",
          memberId: "member_1",
          memberName: "Lead Koi",
          memberHandle: "lead",
        },
        {
          roomId: "room_1",
          taskId: "task_2",
          memberId: "member_2",
          memberName: "Reed Otter",
          memberHandle: "research",
        },
      ]),
    ).toBe("@lead 和 @research 正在并行处理消息。");
  });
});
