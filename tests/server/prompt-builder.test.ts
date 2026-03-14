import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage, runWatcher } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildTaskPrompt } from "@/server/prompt-builder";
import { getRoomContextDirectoryPath } from "@/server/room-transcript-files";

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
    expect(prompt).toContain("rendered to the user as Markdown");
    expect(prompt).toContain("Mermaid");
    expect(prompt).toContain("Prefer $$...$$ for formulas");
    expect(prompt).toContain("/role-add <role> <employee-handle> [reason]");
    expect(prompt).toContain("This shared prompt only tells you the commands exist.");
    expect(prompt).toContain("允许使用岗位员工命令");
    expect(prompt).toContain(`prompt: ${member.prompt}`);
  });

  it("adds persistent watch pause rules when the member has an enabled persistent watcher", () => {
    const context = createRuntimeContext();
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const member = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "scribe");

    if (!member) {
      throw new Error("Expected the scribe member");
    }

    const watcherId = room.watcherIds.find((candidate) => snapshot.watchers[candidate]?.memberId === member.id);
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    snapshot = {
      ...snapshot,
      watchers: {
        ...snapshot.watchers,
        [watcherId]: {
          ...snapshot.watchers[watcherId],
          enabled: true,
          persistent: true,
        },
      },
    };
    snapshot = runWatcher(snapshot, watcherId, context);

    const nextTaskId = snapshot.members[member.id].activeTaskId;
    if (!nextTaskId) {
      throw new Error("Expected watcher-triggered task");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member: snapshot.members[member.id],
      task: snapshot.tasks[nextTaskId],
      snapshot,
    });

    expect(prompt).toContain("[Persistent Watch Rules]");
    expect(prompt).toContain("proactively pause your persistent watch");
    expect(prompt).toContain("resumes automatically");
    expect(prompt).toContain(`oa-room-watch --watcher ${watcherId} --pause-until-activity`);
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
        content: "继续，@>lead 收口一下",
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
    expect(prompt).toContain(`room context directory: ${getRoomContextDirectoryPath(process.cwd(), snapshot.rooms[room.id])}`);
    expect(prompt).toContain("Recent Delta Transcript");
    expect(prompt).toContain("@handle: passive reference only.");
    expect(prompt).toContain("@>handle: active routing.");
    expect(prompt).toContain("It does not notify the member, does not route work");
    expect(prompt).toContain("render as Markdown");
    expect(prompt).toContain("Prefer $$...$$ for formulas");
    expect(prompt).toContain("/role-remove <role> <employee-handle> [reason]");
    expect(prompt).toContain("If your member/template prompt says `不允许使用岗位员工命令`");
    expect(prompt).toContain("prompt: omitted on this delta turn");
    expect(prompt).not.toContain(`prompt: ${lead.prompt}`);
  });

  it("rewrites OpenAquarium notification commands to absolute paths when a project path is set", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = {
      ...snapshot.projects[room.projectId],
      path: "/tmp/external-repo",
    };
    const member = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");
    const task = Object.values(snapshot.tasks).find((candidate) => candidate.memberId === member?.id);

    if (!member || !task) {
      throw new Error("Expected the lead member and its task");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member,
      task,
      snapshot,
    });

    expect(prompt).toContain(`project path: ${project.path}`);
    expect(prompt).toContain(`project working directory: ${project.path}`);
    expect(prompt).toContain(`${process.cwd()}/bin/oa-room-send --room ${room.id} --member ${member.id} --scope group`);
    expect(prompt).toContain("[Available Skills]");
    expect(prompt).toContain(`${process.cwd()}/skills/room-send-group/SKILL.md`);
  });

  it("includes private unseen watcher context without treating it as a room message", () => {
    const context = createRuntimeContext(700, "2026-03-10T12:45:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const scribe = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((candidate) => candidate.handle === "scribe");

    if (!scribe) {
      throw new Error("Expected the scribe member");
    }

    const watcherId = room.watcherIds.find((candidate) => snapshot.watchers[candidate]?.memberId === scribe.id);
    if (!watcherId) {
      throw new Error("Expected a watcher for the scribe member");
    }

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "这里有一条 watcher 还没见过的新消息。",
      },
      context,
    );
    snapshot = runWatcher(snapshot, watcherId, context);

    const nextScribe = snapshot.members[scribe.id];
    const currentTask = nextScribe.activeTaskId ? snapshot.tasks[nextScribe.activeTaskId] : undefined;
    if (!currentTask) {
      throw new Error("Expected a watcher task for the scribe member");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: nextScribe,
      task: currentTask,
      snapshot,
    });

    expect(prompt).toContain("private watcher digest");
    expect(prompt).toContain("was not posted into the room for others");
    expect(prompt).toContain("这里有一条 watcher 还没见过的新消息。");
    expect(prompt).toContain("member history files:");
  });

  it("keeps room transcript visible for regular members", () => {
    const context = createRuntimeContext(800, "2026-03-10T13:00:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "builder");

    if (!builder) {
      throw new Error("Expected the builder member");
    }

    const unrelatedMessage = "这是一个没分配给 builder 的普通 room 消息。";
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: unrelatedMessage,
      },
      context,
    );

    const assignedMessage = "@>builder 清理 Monitor 残留 UI。";
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: assignedMessage,
        mentionedMemberIds: [builder.id],
      },
      createRuntimeContext(801, "2026-03-10T13:01:00.000Z"),
    );

    const nextBuilder = snapshot.members[builder.id];
    const currentTask = nextBuilder.activeTaskId ? snapshot.tasks[nextBuilder.activeTaskId] : undefined;
    if (!currentTask) {
      throw new Error("Expected an active builder task");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: nextBuilder,
      task: currentTask,
      snapshot,
    });

    expect(prompt).toContain(`source message: ${assignedMessage}`);
    expect(prompt).toContain("[Recent Room Transcript]");
    expect(prompt).toContain(unrelatedMessage);
  });

  it("keeps the full room transcript for entry members too", () => {
    const context = createRuntimeContext(820, "2026-03-10T13:10:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");

    if (!lead) {
      throw new Error("Expected the lead member");
    }

    const monitorVisibleMessage = "这条 room 消息应该继续出现在 lead 成员的 transcript 里。";
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: monitorVisibleMessage,
      },
      context,
    );

    const nextLead = snapshot.members[lead.id];
    const currentTask = nextLead.activeTaskId ? snapshot.tasks[nextLead.activeTaskId] : undefined;
    if (!currentTask) {
      throw new Error("Expected an active lead task");
    }

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: nextLead,
      task: currentTask,
      snapshot,
    });

    expect(prompt).toContain("[Recent Room Transcript]");
    expect(prompt).toContain(monitorVisibleMessage);
  });
});
