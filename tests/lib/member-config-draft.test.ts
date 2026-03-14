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
    draft.skills = [
      {
        id: "send-group",
        name: "群消息",
        description: "往群里发消息",
        command: "./bin/oa-room-send --scope group",
      },
    ];

    const payload = buildMemberConfigInput(builder, draft);

    expect(payload.modelProfileId).toBe("model-codex-acp-default");
    expect(payload.provider.command).toBe(builder.provider.command);
    expect(payload.skills[0]?.command).toContain("oa-room-send");
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
