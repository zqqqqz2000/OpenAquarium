import { describe, expect, it } from "vitest";

import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildTaskPrompt } from "@/server/prompt-builder";

describe("buildTaskPrompt", () => {
  it("tells members to publish progress updates during longer tasks", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const member = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");

    if (!member) {
      throw new Error("Expected the lead member");
    }

    const task = Object.values(snapshot.tasks).find((candidate) => candidate.memberId === member.id);
    if (!task) {
      throw new Error("Expected a task for the lead member");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member,
      task,
      snapshot,
    });

    expect(prompt).toContain("do not stay silent on long tasks");
    expect(prompt).toContain("send an early visible progress update");
    expect(prompt).toContain("Keep the user and team updated with short progress messages");
  });
});
