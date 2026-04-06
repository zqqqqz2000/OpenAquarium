import { describe, expect, it } from "vitest";

import type { ChatAuthor, RoomActor } from "@/domain/model";

describe("domain model actor compatibility", () => {
  it("accepts legacy and actor-based author shapes", () => {
    const legacyUser = { kind: "user", id: "user", label: "You" } satisfies ChatAuthor;
    const legacyMember = { kind: "member", id: "member_1", label: "Builder" } satisfies ChatAuthor;
    const humanAuthor = {
      kind: "human",
      id: "human_1",
      humanId: "human_1",
      label: "Alice",
      handle: "alice",
    } satisfies ChatAuthor;
    const botAuthor = {
      kind: "bot",
      id: "member_1",
      memberId: "member_1",
      label: "Builder",
      handle: "builder",
    } satisfies ChatAuthor;
    const systemAuthor = { kind: "system", id: "system", label: "System" } satisfies ChatAuthor;
    const roomHumanActor = {
      id: "human_1",
      roomId: "room_1",
      displayName: "Alice",
      handle: "alice",
      kind: "human",
    } satisfies RoomActor;

    expect([
      legacyUser.kind,
      legacyMember.kind,
      humanAuthor.kind,
      botAuthor.kind,
      systemAuthor.kind,
      roomHumanActor.kind,
    ]).toEqual(["user", "member", "human", "bot", "system", "human"]);
  });
});
