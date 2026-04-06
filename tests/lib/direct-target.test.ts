import { describe, expect, it } from "vitest";

import { resolveDirectTarget } from "@/lib/direct-target";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("resolveDirectTarget", () => {
  it("resolves role-scoped employee handles to the matching member", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    snapshot.members.builder_employee = {
      ...builder,
      id: "builder_employee",
      blueprintId: "builder_employee",
      isRole: false,
      isEntryMember: false,
      name: "Signal Heron",
      handle: "builder-4",
      status: "idle",
      activeTaskId: undefined,
    };
    snapshot.rooms[roomId] = {
      ...room,
      memberIds: [...room.memberIds, "builder_employee"],
    };

    expect(resolveDirectTarget(snapshot, roomId, "@builder/builder-4")).toEqual({
      directMemberId: "builder_employee",
    });
  });

  it("resolves room human handles to direct human recipients", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;

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

    expect(resolveDirectTarget(snapshot, roomId, "@alice")).toEqual({
      directHumanId: "human_alice",
    });
  });

  it("ignores archived or cross-room humans when resolving direct human recipients", () => {
    const snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;

    snapshot.humans = {
      human_archived: {
        id: "human_archived",
        roomId,
        displayName: "Alice Archived",
        handle: "alice",
        kind: "human",
        archivedAt: "2026-03-10T10:00:00.000Z",
      },
      human_other_room: {
        id: "human_other_room",
        roomId: "room_other",
        displayName: "Alice Elsewhere",
        handle: "alice",
        kind: "human",
      },
      human_active: {
        id: "human_active",
        roomId,
        displayName: "Alice",
        handle: "alice",
        kind: "human",
      },
    };
    snapshot.humanOrderByRoom = {
      [roomId]: ["human_archived", "human_other_room", "human_active"],
    };

    expect(resolveDirectTarget(snapshot, roomId, "@alice")).toEqual({
      directHumanId: "human_active",
    });
  });
});
