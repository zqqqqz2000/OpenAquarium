import { describe, expect, it } from "vitest";

import { buildMemberConfigInput, buildWatcherConfigInput, createMemberConfigDraft } from "@/lib/member-config-draft";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("member config draft helpers", () => {
  it("round-trips model profile selection and skill edits into a member config payload", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder")!;
    const draft = createMemberConfigDraft(builder);
    draft.modelProfileId = "model-codex-acp-default";
    draft.allowedSkillIdsText = "room-send-group";

    const payload = buildMemberConfigInput(builder, draft);

    expect(payload.modelProfileId).toBe("model-codex-acp-default");
    expect(payload.provider.command).toBe(builder.provider.command);
    expect(payload.allowedSkillIds).toEqual(["room-send-group"]);
  });

  it("tolerates legacy members without allowedSkillIds when creating drafts", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder")!;
    const legacyBuilder = { ...builder, allowedSkillIds: undefined } as typeof builder;

    const draft = createMemberConfigDraft(legacyBuilder);

    expect(draft.allowedSkillIdsText).toBe("");
  });

  it("builds watcher payloads with numeric interval validation", () => {
    expect(
      buildWatcherConfigInput("member_1", {
        enabled: true,
        intervalMinutes: "12",
        persistent: true,
      }),
    ).toEqual({
      memberId: "member_1",
      enabled: true,
      intervalMinutes: 12,
      persistent: true,
    });
    expect(() =>
      buildWatcherConfigInput("member_1", {
        enabled: true,
        intervalMinutes: "0",
        persistent: false,
      }),
    ).toThrow(/positive number/i);
  });
});
