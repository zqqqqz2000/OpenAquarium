import { describe, expect, it } from "vitest";

import { getMemberActivitySummary } from "@/components/members/member-utils";
import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("member-utils", () => {
  it("falls back to the previous tool name when the latest ACP tool trace is generic", () => {
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>builder 看一下 project live tooltip 的状态摘要",
        mentionedMemberIds: [builder.id],
      },
      createRuntimeContext(740, "2026-03-11T09:30:00.000Z"),
    );

    const runningBuilder = snapshot.members[builder.id];
    if (!runningBuilder?.activeTaskId) {
      throw new Error("Expected builder to have an active task");
    }

    snapshot.taskTraces.trace_0901 = {
      id: "trace_0901",
      taskId: runningBuilder.activeTaskId,
      roomId: room.id,
      memberId: runningBuilder.id,
      kind: "status",
      title: "Tool call [call_sidebar]",
      content: "Read member-session-feed.ts",
      createdAt: "2026-03-11T09:30:01.000Z",
    };
    snapshot.taskTraces.trace_0902 = {
      id: "trace_0902",
      taskId: runningBuilder.activeTaskId,
      roomId: room.id,
      memberId: runningBuilder.id,
      kind: "status",
      title: "Tool completed [call_sidebar]",
      content: "acp.acp_provider_agent_dynamic_tool",
      createdAt: "2026-03-11T09:30:02.000Z",
    };
    snapshot.taskTraceOrderByTask[runningBuilder.activeTaskId] = [
      "trace_0901",
      "trace_0902",
    ];

    const summary = getMemberActivitySummary(snapshot, runningBuilder);

    expect(summary.latestContentPreview).toBe("Read member-session-feed.ts");
    expect(summary.statusLine).toBe("Read member-session-feed.ts");
    expect(summary.latestContentPreview).not.toContain("dynamic_tool");
  });
});
