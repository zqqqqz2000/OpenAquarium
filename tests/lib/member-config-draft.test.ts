import { describe, expect, it } from "vitest";

import { buildMemberConfigInput, buildWatcherConfigInput, createMemberConfigDraft } from "@/lib/member-config-draft";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("member config draft helpers", () => {
  it("round-trips provider and skill edits into a member config payload", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder")!;
    const draft = createMemberConfigDraft(builder);
    draft.providerCommand = "claude-code";
    draft.providerArgsText = "--stdio\n--model\nsonnet";
    draft.providerCapabilitiesText = "prompt, cancel, loadSession";
    draft.providerEnvText = "ANTHROPIC_API_KEY=test-key";
    draft.skills = [
      {
        id: "send-group",
        name: "群消息",
        description: "往群里发消息",
        command: "./bin/oa-room-send --scope group",
      },
    ];

    const payload = buildMemberConfigInput(builder, draft);

    expect(payload.provider.command).toBe("claude-code");
    expect(payload.provider.args).toEqual(["--stdio", "--model", "sonnet"]);
    expect(payload.provider.capabilities).toEqual(["prompt", "cancel", "loadSession"]);
    expect(payload.provider.env).toEqual({ ANTHROPIC_API_KEY: "test-key" });
    expect(payload.skills[0]?.command).toContain("oa-room-send");
  });

  it("builds watcher payloads with numeric interval validation", () => {
    expect(
      buildWatcherConfigInput("member_1", {
        enabled: true,
        intervalMinutes: "12",
      }),
    ).toEqual({
      memberId: "member_1",
      enabled: true,
      intervalMinutes: 12,
    });
    expect(() =>
      buildWatcherConfigInput("member_1", {
        enabled: true,
        intervalMinutes: "0",
      }),
    ).toThrow(/positive number/i);
  });
});
