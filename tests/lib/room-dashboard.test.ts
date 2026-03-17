import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postMemberMessage, postUserMessage } from "@/domain/workspace";
import { buildRoomDashboardMetrics, formatDurationLabel } from "@/lib/room-dashboard";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("room dashboard", () => {
  it("builds execution metrics from room tasks and messages", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const metrics = buildRoomDashboardMetrics(snapshot, room, members);

    expect(metrics.totalTasks).toBeGreaterThan(0);
    expect(metrics.executionTimeline).toHaveLength(metrics.totalTasks);
    expect(metrics.memberSummaries.some((member) => member.totalTaskCount > 0)).toBe(true);
  });

  it("captures source actor labels and single-line task summaries", () => {
    const context = createRuntimeContext(900, "2026-03-10T09:00:00.000Z");
    let snapshot = createSeedWorkspace();
    let room = snapshot.rooms[snapshot.selection.roomId!];

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "继续推进 execution timeline 的文案展示",
      },
      context,
    );

    room = snapshot.rooms[snapshot.selection.roomId!];
    const lead = snapshot.members[room.entryMemberId];

    if (!lead?.activeTaskId) {
      throw new Error("Expected the lead member to have an active task");
    }

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId: room.id,
        memberId: lead.id,
        taskId: lead.activeTaskId,
        content:
          "@>builder 先整理需求边界，然后补上特别长特别长的背景说明，确保 dashboard 上会被截成单行展示，避免挤占整个 timeline 的高度，还要继续补充更多上下文，说明每个边界条件和交互细节，确保这一行一定会被截断显示。\n第二行不应该被带进来。",
      },
      context,
    );

    room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder");
    const builderTaskId = builder?.activeTaskId;
    const metrics = buildRoomDashboardMetrics(snapshot, room, room.memberIds.map((memberId) => snapshot.members[memberId]));
    const initialTask = metrics.executionTimeline.find((span) => span.taskId === lead.activeTaskId);
    const teammateTask = metrics.executionTimeline.find((span) => span.taskId === builderTaskId);

    expect(initialTask?.sourceActorLabel).toBe("You");
    expect(initialTask?.taskTitle).toBe("Respond to user");
    expect(initialTask?.messageLine).toContain("继续推进 execution timeline");
    expect(teammateTask?.sourceActorLabel).toBe("lead");
    expect(teammateTask?.sourcePreview).toBe(
      "先整理需求边界，然后补上特别长特别长的背景说明，确保 dashboard 上会被截成单行展示，避免挤占整个 timeline 的高度，还要继续补充更多上下文，说明每个边界条件和交互细节，确保这一行一定会被截断显示。",
    );
    expect(teammateTask?.taskTitle).toBe("Handle teammate mention");
    expect(teammateTask?.messageLine.endsWith("...")).toBe(true);
  });

  it("formats durations for compact dashboard labels", () => {
    expect(formatDurationLabel(undefined)).toBe("n/a");
    expect(formatDurationLabel(700)).toBe("<1s");
    expect(formatDurationLabel(12_000)).toBe("12s");
    expect(formatDurationLabel(125_000)).toBe("2m 5s");
  });
});
