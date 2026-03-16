import { describe, expect, it } from "vitest";

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

  it("formats durations for compact dashboard labels", () => {
    expect(formatDurationLabel(undefined)).toBe("n/a");
    expect(formatDurationLabel(700)).toBe("<1s");
    expect(formatDurationLabel(12_000)).toBe("12s");
    expect(formatDurationLabel(125_000)).toBe("2m 5s");
  });
});
