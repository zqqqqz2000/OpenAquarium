import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage } from "@/domain/workspace";
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

  it("switches to a delta prompt after the first persisted member turn", () => {
    const context = createRuntimeContext(500, "2026-03-10T12:00:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");

    if (!lead) {
      throw new Error("Expected the lead member");
    }

    snapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        [lead.id]: {
          ...lead,
          providerSessionId: "session_1",
        },
      },
    };

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "继续，@lead 收口一下",
      },
      context,
    );

    const nextLead = snapshot.members[lead.id];
    const currentTask = nextLead.activeTaskId ? snapshot.tasks[nextLead.activeTaskId] : undefined;
    if (!currentTask) {
      throw new Error("Expected a new lead task");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: nextLead,
      task: currentTask,
      snapshot,
      transcriptFilePath: "/tmp/room-transcript.md",
    });

    expect(prompt).toContain("prompt mode: delta");
    expect(prompt).toContain("room transcript file: /tmp/room-transcript.md");
    expect(prompt).toContain("Recent Delta Transcript");
    expect(prompt).toContain("Use \"handle for non-routing references or quotes.");
  });
});
