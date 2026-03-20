import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { completeMemberTask, postSystemMessage, postUserMessage, runWatcher } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildTaskPrompt, buildTaskPromptPayload, MEMBER_FULL_PROMPT_REFRESH_INTERVAL } from "@/server/prompt-builder";
import type { WorkspaceSnapshot } from "@/domain/model";
import { getRoomContextDirectoryPath } from "@/server/room-transcript-files";
import {
  getDefaultRoomTodoTreeFilePath,
  getProjectInteractiveDirectoryPath,
  getRoomInteractiveDirectoryPath,
} from "@/server/room-context-files";

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
    expect(prompt).toContain("Send an early visible progress update");
    expect(prompt).toContain("Keep the user and team updated with short progress messages");
    expect(prompt).toContain("User-visible room and direct messages render as Markdown");
    expect(prompt).toContain("Mermaid");
    expect(prompt).toContain("Prefer $$...$$ for formulas");
    expect(prompt).toContain("oa_role_add_employee");
    expect(prompt).toContain("Do not send role-staffing instructions as room text.");
    expect(prompt).toContain("not a regular member like `research`");
    expect(prompt).toContain("[Role Owners]");
    expect(prompt).toContain("(none)");
    expect(prompt).toContain("允许使用岗位员工工具");
    expect(prompt).toContain(`prompt: ${member.prompt}`);
    expect(prompt).toContain("[AqTree]");
    expect(prompt).toContain("*.aqtree.xml");
    expect(prompt).toContain("Provider bindings are intentionally not exported");
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

  it("refreshes full prompts every 50 turns", () => {
    expect(MEMBER_FULL_PROMPT_REFRESH_INTERVAL).toBe(50);
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
        content: "@>lead 先做第一轮收口",
      },
      context,
    );

    const firstLeadTaskId = snapshot.members[lead.id].activeTaskId;
    if (!firstLeadTaskId) {
      throw new Error("Expected a first lead task");
    }

    snapshot = completeMemberTask(snapshot, { taskId: firstLeadTaskId }, context);
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
    expect(prompt).toContain("[Relevant History]");
    expect(prompt).toContain(`previous task: ${firstLeadTaskId}`);
    expect(prompt).toContain("Continue the current task using only the task state");
    expect(prompt).not.toContain(`prompt: ${lead.prompt}`);
  });

  it("reuses persisted openai-compatible conversation history and switches later turns to delta", () => {
    const context = createRuntimeContext(505, "2026-03-10T12:00:00.000Z");
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
          providerSessionId: "session_openai_previous",
        },
      },
    };

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>lead 先做第一轮收口",
      },
      context,
    );

    const firstLeadTaskId = snapshot.members[lead.id].activeTaskId;
    if (!firstLeadTaskId) {
      throw new Error("Expected a first lead task");
    }

    snapshot = completeMemberTask(snapshot, { taskId: firstLeadTaskId }, context);

    for (let index = 0; index < 18; index += 1) {
      snapshot = postUserMessage(
        snapshot,
        {
          roomId: room.id,
          content: `openai-history-${index}`,
        },
        createRuntimeContext(520 + index, `2026-03-10T12:${String(index).padStart(2, "0")}:00.000Z`),
      );
    }

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "继续，@>lead 收口一下",
      },
      createRuntimeContext(560, "2026-03-10T12:40:00.000Z"),
    );

    const nextLead = snapshot.members[lead.id];
    const currentTask = nextLead.activeTaskId ? snapshot.tasks[nextLead.activeTaskId] : undefined;
    if (!currentTask) {
      throw new Error("Expected a new lead task");
    }

    const openAICompatibleMember = {
      ...nextLead,
      openAICompatibleConversation: {
        messages: [
          {
            role: "user" as const,
            content: "Earlier full prompt",
          },
          {
            role: "assistant" as const,
            content: "Earlier assistant reply",
          },
        ],
      },
      modelId: "gpt-4.1-mini",
      provider: {
        kind: "openai-compatible" as const,
        label: "OpenAI-Compatible API",
        baseURL: "https://example.test/v1",
        apiKeyEnvVar: "OPENAI_API_KEY",
        headersFormat: "kv" as const,
        headers: {},
        extraBodyFormat: "json" as const,
        extraBody: {},
        mcpServers: [],
      },
    };

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: openAICompatibleMember,
      task: currentTask,
      snapshot,
    });

    const payload = buildTaskPromptPayload({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: openAICompatibleMember,
      task: currentTask,
      snapshot,
    });

    expect(prompt).toContain("prompt mode: delta");
    expect(prompt).toContain("[Relevant History]");
    expect(prompt).not.toContain("[Full Room Transcript]");
    expect(payload.messageHistory).toEqual([
      {
        role: "user",
        content: "Earlier full prompt",
      },
      {
        role: "assistant",
        content: "Earlier assistant reply",
      },
    ]);
    expect(payload.promptTraceContent).toContain("[Conversation History]");
    expect(payload.promptTraceContent).toContain("Earlier full prompt");
    expect(payload.promptTraceContent).toContain("[Current User Turn]");
  });

  it("does not fall back to older room transcript when a watcher heartbeat has no new visible messages", () => {
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const scribe = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "scribe");

    if (!scribe) {
      throw new Error("Expected the scribe member");
    }

    const watcherId = room.watcherIds.find((candidate) => snapshot.watchers[candidate]?.memberId === scribe.id);
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    snapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        [scribe.id]: {
          ...snapshot.members[scribe.id],
          providerSessionId: "session_scribe_1",
        },
      },
      watchers: {
        ...snapshot.watchers,
        [watcherId]: {
          ...snapshot.watchers[watcherId],
          enabled: true,
          persistent: true,
          lastConsumedMessageId: snapshot.messageOrderByRoom[room.id]?.at(-1),
        },
      },
    };

    const digestSnapshot: WorkspaceSnapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        [scribe.id]: {
          ...snapshot.members[scribe.id],
          providerSessionId: "session_scribe_1",
        },
      },
      messages: {
        ...snapshot.messages,
        heartbeat_digest: {
          id: "heartbeat_digest",
          roomId: room.id,
          author: { kind: "system", id: "system", label: "Watcher" },
          content: "Watcher activity since last watch:\n\n[Persistent watch]\n- No new room messages or member state changes since the last interval.",
          createdAt: "2026-03-10T12:11:00.000Z",
          transport: "watch-digest",
          status: "sent",
          visibility: "internal",
          mentionedMemberIds: [],
          quotedMemberIds: [],
          recipientMemberIds: [scribe.id],
        },
      },
      tasks: {
        ...snapshot.tasks,
        task_previous_digest: {
          id: "task_previous_digest",
          roomId: room.id,
          memberId: scribe.id,
          sourceMessageId: "message_0600",
          title: "Review watcher digest",
          status: "completed",
          startedAt: "2026-03-10T12:09:00.000Z",
          updatedAt: "2026-03-10T12:10:00.000Z",
        },
        task_heartbeat: {
          id: "task_heartbeat",
          roomId: room.id,
          memberId: scribe.id,
          sourceMessageId: "heartbeat_digest",
          title: "Review watcher digest",
          status: "running",
          startedAt: "2026-03-10T12:11:00.000Z",
          updatedAt: "2026-03-10T12:11:00.000Z",
        },
      },
    };
    const digestTask = digestSnapshot.tasks.task_heartbeat;

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member: digestSnapshot.members[scribe.id],
      task: digestTask,
      snapshot: digestSnapshot,
    });

    const deltaSection = prompt.slice(
      prompt.indexOf("[Relevant History]\n") + "[Relevant History]\n".length,
      prompt.indexOf("\n\n[Instruction]"),
    );

    expect(prompt).toContain("prompt mode: delta");
    expect(deltaSection.trim()).toBe("previous task: task_previous_digest (Review watcher digest), updated at 2026-03-10T12:10:00.000Z\n(none)");
  });

  it("filters a trailing self-authored room message out of the prompt transcript", () => {
    const context = createRuntimeContext(610, "2026-03-10T12:20:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "builder");

    if (!builder) {
      throw new Error("Expected the builder member");
    }

    snapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        [builder.id]: {
          ...snapshot.members[builder.id],
          providerSessionId: "session_builder_1",
        },
      },
    };

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>builder 先补第一版实现说明",
      },
      context,
    );

    const previousBuilderTaskId = snapshot.members[builder.id].activeTaskId;
    if (!previousBuilderTaskId) {
      throw new Error("Expected an initial builder task");
    }

    snapshot = completeMemberTask(snapshot, { taskId: previousBuilderTaskId }, context);
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>builder 补一个实现说明",
      },
      context,
    );

    const activeTaskId = snapshot.members[builder.id].activeTaskId;
    if (!activeTaskId) {
      throw new Error("Expected a builder task");
    }

    const selfMessage = "这是 builder 刚刚自己发出的最后一条消息";
    snapshot = {
      ...snapshot,
      messages: {
        ...snapshot.messages,
        message_builder_tail: {
          id: "message_builder_tail",
          roomId: room.id,
          author: { kind: "member", id: builder.id, label: builder.name },
          content: selfMessage,
          createdAt: "2026-03-10T12:21:00.000Z",
          transport: "group",
          status: "completed",
          mentionedMemberIds: [],
          quotedMemberIds: [],
          recipientMemberIds: [],
          taskId: activeTaskId,
        },
      },
      messageOrderByRoom: {
        ...snapshot.messageOrderByRoom,
        [room.id]: [...(snapshot.messageOrderByRoom[room.id] ?? []), "message_builder_tail"],
      },
      tasks: {
        ...snapshot.tasks,
        [activeTaskId]: {
          ...snapshot.tasks[activeTaskId],
          updatedAt: "2026-03-10T12:20:30.000Z",
        },
      },
    };

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member: snapshot.members[builder.id],
      task: snapshot.tasks[activeTaskId],
      snapshot,
    });

    expect(prompt).toContain("prompt mode: delta");
    expect(prompt).not.toContain(selfMessage);
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
    expect(prompt).toContain(
      `project interactive directory: ${getProjectInteractiveDirectoryPath(process.cwd(), project)}`,
    );
    expect(prompt).toContain(
      `room interactive directory: ${getRoomInteractiveDirectoryPath(process.cwd(), room, project)}`,
    );
    expect(prompt).toContain(
      `Default file path: ${getDefaultRoomTodoTreeFilePath(process.cwd(), room, project)}`,
    );
    expect(prompt).toContain(`${process.cwd()}/bin/oa-room-send --room ${room.id} --member ${member.id} --scope group`);
    expect(prompt).toContain("[Available Skills]");
    expect(prompt).toContain(`${process.cwd()}/skills/room-send-group/SKILL.md`);
  });

  it("truncates long room topics in the shared project section", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const member = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");
    const task = Object.values(snapshot.tasks).find((candidate) => candidate.memberId === member?.id);

    if (!member || !task) {
      throw new Error("Expected the lead member and its task");
    }

    const longTopic = `${"超长 topic ".repeat(120)}尾巴`;
    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project: snapshot.projects[room.projectId],
      room: {
        ...room,
        topic: longTopic,
      },
      member,
      task,
      snapshot,
    });

    expect(prompt).toContain("topic: ");
    expect(prompt).toContain("truncated; read room transcript/context files for the full topic if needed");
    expect(prompt).not.toContain(longTopic);
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

  it("includes watcher-specific prompt only on watcher-triggered turns", () => {
    const context = createRuntimeContext(710, "2026-03-10T12:46:00.000Z");
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

    snapshot = {
      ...snapshot,
      watchers: {
        ...snapshot.watchers,
        [watcherId]: {
          ...snapshot.watchers[watcherId],
          prompt: "Only summarize unseen messages and owner/status changes.",
        },
      },
    };

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "watcher prompt should appear here",
      },
      context,
    );
    snapshot = runWatcher(snapshot, watcherId, context);

    const nextScribe = snapshot.members[scribe.id];
    const currentTask = nextScribe.activeTaskId ? snapshot.tasks[nextScribe.activeTaskId] : undefined;
    if (!currentTask) {
      throw new Error("Expected a watcher task for the scribe member");
    }

    const watcherPrompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: snapshot.rooms[room.id],
      member: nextScribe,
      task: currentTask,
      snapshot,
    });

    expect(watcherPrompt).toContain("[Watcher Prompt]");
    expect(watcherPrompt).toContain("Only summarize unseen messages and owner/status changes.");

    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");
    if (!lead) {
      throw new Error("Expected the lead member");
    }

    const regularSnapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>lead regular task",
        mentionedMemberIds: [lead.id],
      },
      createRuntimeContext(711, "2026-03-10T12:47:00.000Z"),
    );
    const regularLead = regularSnapshot.members[lead.id];
    const regularTask = regularLead.activeTaskId ? regularSnapshot.tasks[regularLead.activeTaskId] : undefined;
    if (!regularTask) {
      throw new Error("Expected a regular lead task");
    }

    const regularPrompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room: regularSnapshot.rooms[room.id],
      member: regularLead,
      task: regularTask,
      snapshot: regularSnapshot,
    });

    expect(regularPrompt).not.toContain("[Watcher Prompt]");
    expect(regularPrompt).not.toContain("Only summarize unseen messages and owner/status changes.");
  });

  it("limits full prompts to the latest 30 visible room messages", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");
    const task = Object.values(snapshot.tasks).find((candidate) => candidate.memberId === lead?.id);

    if (!lead || !task) {
      throw new Error("Expected the lead member and its task");
    }

    const olderMessageIds = Array.from({ length: 35 }, (_, index) => `message_old_${index}`);
    const olderMessages = Object.fromEntries(
      olderMessageIds.map((messageId, index) => [
        messageId,
        {
          id: messageId,
          roomId: room.id,
          author: { kind: "user" as const, id: `user_old_${index}`, label: "You" },
          content: `older transcript message ${index}`,
          createdAt: `2026-03-10T11:${String(index).padStart(2, "0")}:00.000Z`,
          transport: "group" as const,
          status: "sent" as const,
          mentionedMemberIds: [],
          quotedMemberIds: [],
          recipientMemberIds: [],
        },
      ]),
    );

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member: lead,
      task,
      snapshot: {
        ...snapshot,
        messages: {
          ...olderMessages,
          ...snapshot.messages,
        },
        messageOrderByRoom: {
          ...snapshot.messageOrderByRoom,
          [room.id]: [...olderMessageIds, ...(snapshot.messageOrderByRoom[room.id] ?? [])],
        },
      },
    });

    expect(prompt).toContain("[Recent Room Transcript]");
    expect(prompt).toContain("limited to the latest 30 visible room messages");
    expect(prompt).not.toContain("older transcript message 0");
    expect(prompt).not.toContain("older transcript message 5");
    expect(prompt).toContain("older transcript message 6");
    expect(prompt).toContain("older transcript message 34");
  });

  it("drops older transcript messages when the inline transcript hits the char limit", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");
    const task = Object.values(snapshot.tasks).find((candidate) => candidate.memberId === lead?.id);

    if (!lead || !task) {
      throw new Error("Expected the lead member and its task");
    }

    const longMessageIds = Array.from({ length: 20 }, (_, index) => `message_long_${index}`);
    const longMessages = Object.fromEntries(
      longMessageIds.map((messageId, index) => [
        messageId,
        {
          id: messageId,
          roomId: room.id,
          author: { kind: "user" as const, id: `user_long_${index}`, label: "You" },
          content: `long transcript chunk ${index} ${"x".repeat(900)}`,
          createdAt: `2026-03-10T10:${String(index).padStart(2, "0")}:00.000Z`,
          transport: "group" as const,
          status: "sent" as const,
          mentionedMemberIds: [],
          quotedMemberIds: [],
          recipientMemberIds: [],
        },
      ]),
    );

    const prompt = buildTaskPrompt({
      workspaceRoot: process.cwd(),
      project,
      room,
      member: lead,
      task,
      snapshot: {
        ...snapshot,
        messages: {
          ...longMessages,
          ...snapshot.messages,
        },
        messageOrderByRoom: {
          ...snapshot.messageOrderByRoom,
          [room.id]: [...longMessageIds, ...(snapshot.messageOrderByRoom[room.id] ?? [])],
        },
      },
    });

    expect(prompt).toContain("limited to the latest 30 visible room messages and 12000 chars");
    expect(prompt).not.toContain("long transcript chunk 0");
    expect(prompt).toContain("long transcript chunk 19");
    expect(prompt).toContain("read the room transcript/member history files above with oa_read_file");
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

  it("keeps the bounded room transcript for entry members too", () => {
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

  it("excludes room status messages from member prompts", () => {
    const context = createRuntimeContext(830, "2026-03-10T13:20:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = snapshot.projects[room.projectId];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "lead");

    if (!lead) {
      throw new Error("Expected the lead member");
    }

    const statusContent = "@lead 任务执行失败：当前任务在 300 秒内没有新的进度或完成信号。";
    snapshot = postSystemMessage(
      snapshot,
      {
        roomId: room.id,
        label: "Task status",
        transport: "status",
        content: statusContent,
      },
      context,
    );
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>lead 继续处理当前问题",
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

    expect(prompt).not.toContain(statusContent);
  });
});
