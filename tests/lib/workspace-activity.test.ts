import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { appendTaskTrace, createProjectWithRoom, createRoomInProject, postUserMessage } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildProjectActivitySummaries, formatRelativeActivityShort } from "@/lib/workspace-activity";

describe("workspace activity helpers", () => {
  it("formats compact relative timestamps", () => {
    const referenceTimeMs = Date.parse("2026-03-12T10:00:00.000Z");

    expect(formatRelativeActivityShort("2026-03-12T09:55:00.000Z", referenceTimeMs)).toBe("5m");
    expect(formatRelativeActivityShort("2026-03-12T08:00:00.000Z", referenceTimeMs)).toBe("2h");
    expect(formatRelativeActivityShort("2026-03-10T10:00:00.000Z", referenceTimeMs)).toBe("2d");
    expect(formatRelativeActivityShort("2026-02-26T10:00:00.000Z", referenceTimeMs)).toBe("2w");
  });

  it("sorts projects and rooms by latest activity while preserving running state", () => {
    let snapshot = createSeedWorkspace();
    const primaryProjectId = snapshot.projectOrder[0];
    const primaryRoomId = snapshot.selection.roomId;
    if (!primaryProjectId || !primaryRoomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const templateId = snapshot.rooms[primaryRoomId]?.templateId;
    if (!templateId) {
      throw new Error("Expected seeded room template");
    }

    snapshot = createProjectWithRoom(
      snapshot,
      {
        projectName: "Archive",
        templateId,
      },
      createRuntimeContext(200, "2026-03-09T08:30:00.000Z"),
    );
    snapshot = createRoomInProject(
      snapshot,
      {
        projectId: primaryProjectId,
        templateId,
      },
      createRuntimeContext(300, "2026-03-09T09:10:00.000Z"),
    );

    const latestRoomId = snapshot.roomOrderByProject[primaryProjectId]?.at(-1);
    if (!latestRoomId) {
      throw new Error("Expected a second room in the primary project");
    }

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: latestRoomId,
        content: "Prioritize the sidebar running-state polish",
      },
      createRuntimeContext(400, "2026-03-09T09:20:00.000Z"),
    );

    const runningMember = snapshot.rooms[latestRoomId]?.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member?.status === "running");
    if (!runningMember?.activeTaskId) {
      throw new Error("Expected the latest room to have a running member");
    }

    snapshot = appendTaskTrace(
      snapshot,
      {
        taskId: runningMember.activeTaskId,
        roomId: latestRoomId,
        memberId: runningMember.id,
        kind: "status",
        title: "Progress",
        content: "Applying compact transcript spacing and running badges",
      },
      createRuntimeContext(500, "2026-03-09T09:25:00.000Z"),
    );

    const summaries = buildProjectActivitySummaries(snapshot);

    expect(summaries[0]?.project.id).toBe(primaryProjectId);
    expect(summaries[0]?.hasRunning).toBe(true);
    expect(summaries[0]?.rooms[0]?.room.id).toBe(latestRoomId);
    expect(summaries[0]?.rooms[0]?.hasRunning).toBe(true);
    expect(summaries[0]?.rooms[0]?.updatedAt).toBe("2026-03-09T09:25:00.000Z");
    expect(summaries[1]?.hasRunning).toBe(false);
  });
});
