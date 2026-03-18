import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import type { ChatMessage } from "@/domain/model";
import {
  acknowledgeWatcherDigestVisibility,
  appendTaskTrace,
  applyRoleStaffingOperation,
  completeMemberTask,
  createProjectWithRoom,
  createWorkspaceSnapshot,
  extractAddressedMemberIds,
  extractMentionMemberIds,
  extractQuotedMemberIds,
  postMemberDraft,
  postMemberMessage,
  postUserMessage,
  pauseWatcherUntilActivity,
  runWatcher,
  setEntryMember,
  upsertTaskTrace,
  updateRoomTeam,
  updateRoomSettings,
  updateTemplate,
  updateMemberConfig,
  upsertMemberWatcher,
  syncUnreadStateForMessage,
  toggleWatcher,
} from "@/domain/workspace";
import { formatTime } from "@/lib/time";
import { defaultTemplates } from "@/lib/sample-data/templates";

const DEFAULT_FIRST_MESSAGE = "实现一个可中断的 agent team";

function createStartedProjectSnapshot(context: ReturnType<typeof createRuntimeContext>) {
  let snapshot = createProjectWithRoom(
    createWorkspaceSnapshot(defaultTemplates),
    {
      projectName: "ACP Lab",
      templateId: "template-product-pod",
    },
    context,
  );

  snapshot = postUserMessage(
    snapshot,
    {
      roomId: snapshot.selection.roomId!,
      content: DEFAULT_FIRST_MESSAGE,
    },
    context,
  );

  return snapshot;
}

function cloneRoomTeamForRoleRouting(
  snapshot: ReturnType<typeof createStartedProjectSnapshot>,
  roomId: string,
  overrides: {
    builderHandles?: Array<{ handle: string; name: string; note?: string }>;
  },
  context: ReturnType<typeof createRuntimeContext>,
) {
  const room = snapshot.rooms[roomId];
  const roomMembers = room.memberIds.map((memberId) => snapshot.members[memberId]);
  const builder = roomMembers.find((member) => member.handle === "builder");

  if (!builder) {
    throw new Error("Expected builder member");
  }

  const builderOverrides = overrides.builderHandles;
  const nextMembers = roomMembers.flatMap((member) => {
    if (member.id !== builder.id) {
      return [
        {
          memberId: member.id,
          roleId: member.roleId,
          roleName: member.roleName,
          isRole: member.isRole,
          name: member.name,
          handle: member.handle,
          summary: member.summary,
          note: member.note,
          prompt: member.prompt,
          accentTone: member.accentTone,
          modelProfileId: member.modelProfileId,
          allowedSkillIds: member.allowedSkillIds,
          provider: member.provider,
          isEntryMember: member.isEntryMember,
          acceptsDirectMessages: member.acceptsDirectMessages,
        },
      ];
    }

    if (!builderOverrides || builderOverrides.length === 0) {
      return [];
    }

    return builderOverrides.map((override, index) => ({
      memberId: index === 0 ? builder.id : `builder-role-${index}`,
      roleId: builder.roleId,
      roleName: builder.roleName,
      isRole: index === 0 ? builder.isRole : false,
      name: override.name,
      handle: override.handle,
      summary: builder.summary,
      note: override.note,
      prompt: builder.prompt,
      accentTone: builder.accentTone,
      modelProfileId: builder.modelProfileId,
      allowedSkillIds: builder.allowedSkillIds,
      provider: builder.provider,
      isEntryMember: false,
      acceptsDirectMessages: builder.acceptsDirectMessages,
    }));
  });

  return updateRoomTeam(
    snapshot,
    {
      roomId,
      teamName: room.teamName ?? "Product Pod Review Loop",
      teamDescription: room.teamDescription ?? "Product pod",
      teamAccentTone: room.teamAccentTone ?? "paper",
      members: nextMembers,
    },
    context,
  );
}

describe("workspace domain", () => {
  it("creates a virtual room before the first user message and initializes it from that message", () => {
    const context = createRuntimeContext();
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId;
    expect(roomId).toBeDefined();
    if (!roomId) {
      throw new Error("Expected a room id");
    }

    expect(snapshot.rooms[roomId].name).toBe("New room");
    expect(snapshot.rooms[roomId].topic).toBe("");
    expect(snapshot.messageOrderByRoom[roomId]).toEqual([]);
    expect(snapshot.members[snapshot.rooms[roomId].entryMemberId].activeTaskId).toBeUndefined();

    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "实现一个可中断的 agent team",
      },
      context,
    );

    expect(snapshot.rooms[roomId].name).toBe("实现一个可中断的 Agent Team");
    expect(snapshot.rooms[roomId].topic).toBe("实现一个可中断的 agent team");
    expect(snapshot.messageOrderByRoom[roomId]).toHaveLength(1);
    expect(snapshot.members[snapshot.rooms[roomId].entryMemberId].activeTaskId).toBeDefined();
  });

  it("routes the first prompt to the entry member and derives a room name", () => {
    const context = createRuntimeContext();
    const snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId;
    expect(roomId).toBeDefined();
    expect(snapshot.rooms[roomId!].name).toBe("实现一个可中断的 Agent Team");

    const entryMember = Object.values(snapshot.members).find((member) => member.isEntryMember);
    expect(entryMember?.activeTaskId).toBeDefined();
    expect(snapshot.tasks[entryMember!.activeTaskId!].title).toBe("Respond to user");
    expect(
      Object.values(snapshot.members)
        .filter((member) => !member.isEntryMember)
        .every((member) => member.activeTaskId === undefined),
    ).toBe(true);
  });

  it("copies watcher prompt from the template when creating a room", () => {
    const context = createRuntimeContext();
    const templates = defaultTemplates.map((template) =>
      template.id !== "template-product-pod"
        ? template
        : {
            ...template,
            members: template.members.map((member) =>
              member.id !== "scribe"
                ? member
                : {
                    ...member,
                    watch: {
                      ...member.watch!,
                      prompt: "Only summarize unseen messages and owner/status changes.",
                    },
                  }),
          });
    const snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(templates),
      {
        projectName: "ACP Lab",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId;
    if (!roomId) {
      throw new Error("Expected a room id");
    }

    const room = snapshot.rooms[roomId];
    const scribe = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");

    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    const watcherId = room.watcherIds.find((candidate) => snapshot.watchers[candidate]?.memberId === scribe.id);
    if (!watcherId) {
      throw new Error("Expected scribe watcher");
    }

    expect(snapshot.watchers[watcherId]?.prompt).toBe("Only summarize unseen messages and owner/status changes.");
  });

  it("preserves role-owner state from the template when creating a room", () => {
    const context = createRuntimeContext();
    const baseSnapshot = createWorkspaceSnapshot(defaultTemplates);
    const template = baseSnapshot.templates["template-product-pod"];

    if (!template) {
      throw new Error("Expected template-product-pod template");
    }

    const updatedSnapshot = updateTemplate(baseSnapshot, {
      templateId: template.id,
      name: template.name,
      description: template.description,
      accentTone: template.accentTone,
      defaultVisibleMemberBlueprintIds: template.defaultVisibleMemberBlueprintIds,
      members: template.members.map((member) =>
        member.handle === "builder"
          ? {
              ...member,
              isRole: true,
            }
          : member),
    });

    const snapshot = createProjectWithRoom(
      updatedSnapshot,
      {
        projectName: "ACP Lab",
        templateId: template.id,
      },
      context,
    );

    const roomId = snapshot.selection.roomId;
    if (!roomId) {
      throw new Error("Expected a room id");
    }

    const builder = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    expect(builder.isRole).toBe(true);
  });

  it("interrupts a running member without leaking internal draft text into the room transcript", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const entryMember = Object.values(snapshot.members).find((member) => member.isEntryMember)!;
    snapshot = postMemberDraft(
      snapshot,
      {
        taskId: entryMember.activeTaskId!,
        content: "我已经拆出一半状态机，准备继续写 provider。",
      },
      context,
    );

    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "@lead 先别继续写 provider，改成先做群组 UI。",
        mentionedMemberIds: [entryMember.id],
      },
      context,
    );

    expect((snapshot.messageOrderByRoom[roomId] ?? []).map((messageId) => snapshot.messages[messageId].author.kind)).toEqual(["user", "user"]);
    expect(snapshot.members[entryMember.id].activeTaskId).not.toBe(snapshot.tasks[entryMember.activeTaskId!]?.interruptedByMessageId);
    expect(snapshot.members[entryMember.id].status).toBe("running");
  });

  it("keeps an earlier draft trace when a status trace lands between draft updates", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const entryMember = Object.values(snapshot.members).find((member) => member.isEntryMember);

    if (!entryMember?.activeTaskId) {
      throw new Error("Expected an active entry member task");
    }

    const taskId = entryMember.activeTaskId;
    const roomId = snapshot.tasks[taskId].roomId;

    snapshot = upsertTaskTrace(
      snapshot,
      {
        taskId,
        roomId,
        memberId: entryMember.id,
        kind: "draft",
        title: "Internal draft",
        content: "我先查代码和文档里这些开关对应的字段与行为。",
      },
      context,
    );
    snapshot = appendTaskTrace(
      snapshot,
      {
        taskId,
        roomId,
        memberId: entryMember.id,
        kind: "status",
        title: "Tool call",
        content: "Read message-feed.ts (called)",
      },
      context,
    );
    snapshot = upsertTaskTrace(
      snapshot,
      {
        taskId,
        roomId,
        memberId: entryMember.id,
        kind: "draft",
        title: "Internal draft",
        content: "我先查代码和文档里这些开关对应的字段与行为。我已经定位到用户问的是成员配置/房间行为相关的开关。",
      },
      context,
    );

    const taskTraceIds = snapshot.taskTraceOrderByTask[taskId] ?? [];
    const taskTraces = taskTraceIds.map((traceId) => snapshot.taskTraces[traceId]);
    const draftTraces = taskTraces.filter((trace) => trace?.kind === "draft");

    expect(taskTraces.map((trace) => `${trace?.kind}:${trace?.title}`)).toEqual([
      "task-started:Respond to user",
      "draft:Internal draft",
      "status:Tool call",
      "draft:Internal draft",
    ]);
    expect(draftTraces).toHaveLength(2);
    expect(draftTraces[0]?.content).toBe("我先查代码和文档里这些开关对应的字段与行为。");
    expect(draftTraces[1]?.content).toBe("我先查代码和文档里这些开关对应的字段与行为。我已经定位到用户问的是成员配置/房间行为相关的开关。");
  });

  it("extracts active assignments by handle from message content", () => {
    const context = createRuntimeContext();
    const snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const mentionIds = extractMentionMemberIds(snapshot, roomId, "@>builder 帮我补 UI，@>scribe 负责记录");
    const handles = mentionIds.map((memberId) => snapshot.members[memberId].handle).sort();

    expect(handles).toEqual(["builder", "scribe"]);
  });

  it("extracts active assignments from inline code and malformed backtick spans", () => {
    const context = createRuntimeContext();
    const snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const mentionIds = extractMentionMemberIds(
      snapshot,
      roomId,
      "切片说明：`file.write` facade`**\n\n`@>builder` 先实现 bridge，下一个再给 `@>scribe` 记要点。",
    );
    const handles = mentionIds.map((memberId) => snapshot.members[memberId].handle).sort();

    expect(handles).toEqual(["builder", "scribe"]);
  });

  it("extracts passive references without routing them", () => {
    const context = createRuntimeContext();
    const snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const quoteIds = extractQuotedMemberIds(snapshot, roomId, "@builder 作为参考，@scribe 负责记录。");
    const handles = quoteIds.map((memberId) => snapshot.members[memberId].handle).sort();

    expect(handles).toEqual(["builder", "scribe"]);
    expect(extractAddressedMemberIds(snapshot, roomId, "@builder 作为参考")).toEqual([]);
  });

  it("treats only @> members as routed recipients", () => {
    const context = createRuntimeContext();
    const snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const addressedIds = extractAddressedMemberIds(snapshot, roomId, "@>builder @>research 先同步一下，再提到 @scribe 作为引用。");
    const addressedHandles = addressedIds.map((memberId) => snapshot.members[memberId].handle);

    expect(addressedHandles).toEqual(["builder", "research"]);
  });

  it("keeps exact member handles ahead of role routing", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [
          { handle: "builder", name: "Forge Crab" },
          { handle: "builder-4", name: "Signal Heron", note: "补位质量检查" },
        ],
      },
      context,
    );

    const addressedIds = extractAddressedMemberIds(snapshot, roomId, "@>builder 继续实现");
    const addressedHandles = addressedIds.map((memberId) => snapshot.members[memberId]?.handle);
    const routed = postUserMessage(snapshot, { roomId, content: "@>builder 继续实现" }, context);
    const systemMessages = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .filter((message) => message.author.kind === "system");

    expect(addressedHandles).toEqual(["builder"]);
    expect(systemMessages.some((message) => message.content.includes("岗位路由"))).toBe(false);
    expect(Object.values(routed.tasks).some((task) => routed.members[task.memberId]?.handle === "builder")).toBe(true);
  });

  it("routes @>role to the only active employee and records a fixed system notice", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [{ handle: "builder-main", name: "Forge Crab" }],
      },
      context,
    );

    const addressedIds = extractAddressedMemberIds(snapshot, roomId, "@>builder 继续实现");
    const addressedHandles = addressedIds.map((memberId) => snapshot.members[memberId]?.handle);
    const routed = postUserMessage(snapshot, { roomId, content: "@>builder 继续实现" }, context);
    const latestSystemMessage = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .filter((message) => message.author.kind === "system")
      .at(-1);

    expect(addressedHandles).toEqual(["builder-main"]);
    expect(latestSystemMessage?.content).toBe("岗位路由已执行：@>builder -> Forge Crab（@builder-main）。");
    expect(Object.values(routed.tasks).some((task) => routed.members[task.memberId]?.handle === "builder-main")).toBe(true);
  });

  it("routes role handles without crashing when legacy members are missing roleName", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [{ handle: "builder-main", name: "Forge Crab" }],
      },
      context,
    );

    const builderMain = Object.values(snapshot.members).find((member) => member.handle === "builder-main");
    if (!builderMain) {
      throw new Error("Expected builder-main member");
    }

    snapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        [builderMain.id]: {
          ...builderMain,
          roleName: undefined,
        } as unknown as typeof builderMain,
      },
    };

    const addressedIds = extractAddressedMemberIds(snapshot, roomId, "@>builder 继续实现");

    expect(addressedIds.map((memberId) => snapshot.members[memberId]?.handle)).toEqual(["builder-main"]);
  });

  it("routes role handles without crashing when legacy members are missing roleId", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [{ handle: "builder-main", name: "Forge Crab" }],
      },
      context,
    );

    const builderMain = Object.values(snapshot.members).find((member) => member.handle === "builder-main");
    if (!builderMain) {
      throw new Error("Expected builder-main member");
    }

    snapshot = {
      ...snapshot,
      members: {
        ...snapshot.members,
        [builderMain.id]: {
          ...builderMain,
          roleId: undefined,
        } as unknown as typeof builderMain,
      },
    };

    const addressedIds = extractAddressedMemberIds(snapshot, roomId, "@>builder 继续实现");

    expect(addressedIds.map((memberId) => snapshot.members[memberId]?.handle)).toEqual(["builder-main"]);
  });

  it("does not create member tasks when @>role is ambiguous across multiple employees", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [
          { handle: "builder-1", name: "Forge Crab" },
          { handle: "builder-4", name: "Signal Heron", note: "补位质量检查" },
        ],
      },
      context,
    );

    const previousTaskCount = Object.keys(snapshot.tasks).length;
    const routed = postUserMessage(snapshot, { roomId, content: "@>builder 继续实现" }, context);
    const systemMessages = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .filter((message) => message.author.kind === "system");

    expect(extractAddressedMemberIds(snapshot, roomId, "@>builder 继续实现")).toEqual([]);
    expect(systemMessages.at(-1)?.content).toBe("岗位路由未执行：@>builder 对应多个活跃员工，请改用 @>builder/employee-handle。");
    expect(Object.keys(routed.tasks)).toHaveLength(previousTaskCount);
    expect(Object.values(routed.tasks).filter((task) => task.sourceMessageId === routed.messageOrderByRoom[roomId]?.at(-2))).toEqual(
      [],
    );
  });

  it("does not create member tasks when @>role has no active employees", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [],
      },
      context,
    );

    const previousTaskCount = Object.keys(snapshot.tasks).length;
    const routed = postUserMessage(snapshot, { roomId, content: "@>builder 继续实现" }, context);
    const systemMessages = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .filter((message) => message.author.kind === "system");

    expect(extractAddressedMemberIds(snapshot, roomId, "@>builder 继续实现")).toEqual([]);
    expect(systemMessages.at(-1)?.content).toBe("岗位路由未执行：@>builder 对应岗位当前无人可接。");
    expect(Object.keys(routed.tasks)).toHaveLength(previousTaskCount);
  });

  it("routes @>role/employee-handle to the matching employee inside that role", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [
          { handle: "builder-1", name: "Forge Crab" },
          { handle: "builder-4", name: "Signal Heron", note: "补位质量检查" },
        ],
      },
      context,
    );

    const addressedIds = extractAddressedMemberIds(snapshot, roomId, "@>builder/builder-4 跟进");
    const routed = postUserMessage(snapshot, { roomId, content: "@>builder/builder-4 跟进" }, context);
    const latestSystemMessage = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .filter((message) => message.author.kind === "system")
      .at(-1);

    expect(addressedIds.map((memberId) => snapshot.members[memberId]?.handle)).toEqual(["builder-4"]);
    expect(latestSystemMessage?.content).toBe("岗位路由已执行：@>builder/builder-4 -> Signal Heron（@builder-4）。");
    expect(Object.values(routed.tasks).some((task) => routed.members[task.memberId]?.handle === "builder-4")).toBe(true);
  });

  it("routes exact member handles from a member-authored group message to multiple builder workers", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [
          { handle: "builder", name: "Forge Crab" },
          { handle: "builder-wt1", name: "Builder Wt1" },
          { handle: "builder-wt2", name: "Builder Wt2" },
        ],
      },
      context,
    );

    const lead = snapshot.rooms[roomId]?.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead");
    if (!lead) {
      throw new Error("Expected lead member");
    }

    const content = [
      "- `@>builder` 继续作为 masking / token vault / controlled restore 最小闭环主责任人。",
      "- `@>builder-wt1` 只做 file.read -> redact/tokenize -> placeholder。",
      "- `@>builder-wt2` 只做 file.write restore。",
    ].join("\n");

    const routed = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: lead.id,
        content,
      },
      context,
    );

    const postedMessage = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .find((message) => message.author.kind === "member" && message.author.id === lead.id && message.content === content);

    expect(postedMessage?.mentionedMemberIds.map((memberId) => routed.members[memberId]?.handle)).toEqual([
      "builder",
      "builder-wt1",
      "builder-wt2",
    ]);
    expect(
      Object.values(routed.tasks)
        .filter((task) => task.sourceMessageId === postedMessage?.id)
        .map((task) => routed.members[task.memberId]?.handle)
        .sort(),
    ).toEqual(["builder", "builder-wt1", "builder-wt2"]);
  });

  it("answers /role-note and /role-notes with room-only system messages", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [
          { handle: "builder-1", name: "Forge Crab" },
          { handle: "builder-4", name: "Signal Heron", note: "补位质量检查" },
        ],
      },
      context,
    );

    const previousTaskCount = Object.keys(snapshot.tasks).length;
    const withSingleNote = postUserMessage(snapshot, { roomId, content: "/role-note builder-4" }, context);
    const withRoleNotes = postUserMessage(withSingleNote, { roomId, content: "/role-notes builder" }, context);
    const newMessages = (withRoleNotes.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => withRoleNotes.messages[messageId])
      .slice(-4);

    expect(Object.keys(withRoleNotes.tasks)).toHaveLength(previousTaskCount);
    expect(newMessages[1]?.author.kind).toBe("system");
    expect(newMessages[1]?.content).toBe("查询岗位备注：@builder-4（岗位：builder）备注：补位质量检查。");
    expect(newMessages[3]?.author.kind).toBe("system");
    expect(newMessages[3]?.content).toContain("查询岗位备注：@builder 岗位下共有 2 名员工。");
    expect(newMessages[3]?.content).toContain("- @builder-1（岗位：builder）备注为空。");
    expect(newMessages[3]?.content).toContain("- @builder-4（岗位：builder）备注：补位质量检查。");
  });

  it("adds, renames, and removes role employees through structured staffing operations", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;
    const builder = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    snapshot = updateMemberConfig(snapshot, {
      memberId: builder.id,
      isRole: true,
      summary: builder.summary,
      prompt: builder.prompt,
      modelProfileId: builder.modelProfileId,
      acceptsDirectMessages: builder.acceptsDirectMessages,
      codexThinkingDepth: builder.codexThinkingDepth,
      allowedSkillIds: builder.allowedSkillIds,
      provider: builder.provider,
    });

    const taskCountBefore = Object.keys(snapshot.tasks).length;
    snapshot = applyRoleStaffingOperation(snapshot, {
      roomId,
      actorLabel: "You",
      operation: {
        kind: "add",
        role: "builder",
        employeeHandle: "builder-5",
        reason: "补位实现",
      },
    }, context);
    snapshot = applyRoleStaffingOperation(snapshot, {
      roomId,
      actorLabel: "You",
      operation: {
        kind: "rename",
        employeeHandle: "builder-5",
        name: "Signal Heron",
      },
    }, context);
    snapshot = applyRoleStaffingOperation(snapshot, {
      roomId,
      actorLabel: "You",
      operation: {
        kind: "remove",
        role: "builder",
        employeeHandle: "builder-5",
      },
    }, context);

    const room = snapshot.rooms[roomId];
    const recentMessages = (snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => snapshot.messages[messageId])
      .slice(-3);

    expect(Object.keys(snapshot.tasks)).toHaveLength(taskCountBefore);
    expect(recentMessages[0]?.content).toBe("@builder-5（岗位：builder）被 You 加入群组，原因是：补位实现。");
    expect(recentMessages[1]?.content).toBe("@builder-5（岗位：builder）被 You 更名为 Signal Heron。");
    expect(recentMessages[2]?.content).toBe("@builder-5（岗位：builder）被 You 移除群组。");
    expect(room.memberIds.map((memberId) => snapshot.members[memberId]?.handle)).not.toContain("builder-5");
  });

  it("prevents enabling Watch for role members", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;
    const builder = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    snapshot = updateMemberConfig(snapshot, {
      memberId: builder.id,
      isRole: true,
      summary: builder.summary,
      prompt: builder.prompt,
      modelProfileId: builder.modelProfileId,
      acceptsDirectMessages: builder.acceptsDirectMessages,
      codexThinkingDepth: builder.codexThinkingDepth,
      allowedSkillIds: builder.allowedSkillIds,
      provider: builder.provider,
    });

    expect(() =>
      upsertMemberWatcher(
        snapshot,
        {
          memberId: builder.id,
          enabled: true,
          intervalMinutes: 5,
          persistent: false,
        },
        context,
      ),
    ).toThrow("Role members cannot enable Watch.");
  });

  it("lets members run structured staffing operations without prompt-gated parsing", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;
    const builder = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    if (!builder) {
      throw new Error("Expected builder member");
    }

    snapshot = updateMemberConfig(snapshot, {
      memberId: builder.id,
      isRole: true,
      summary: builder.summary,
      prompt: builder.prompt,
      modelProfileId: builder.modelProfileId,
      acceptsDirectMessages: builder.acceptsDirectMessages,
      codexThinkingDepth: builder.codexThinkingDepth,
      allowedSkillIds: builder.allowedSkillIds,
      provider: builder.provider,
    });

    const updated = applyRoleStaffingOperation(snapshot, {
      roomId,
      actorLabel: builder.name,
      operation: {
        kind: "add",
        role: "builder",
        employeeHandle: "builder-7",
      },
    }, context);

    const latestNotice = (updated.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => updated.messages[messageId])
      .at(-1);

    expect(latestNotice?.content).toBe("@builder-7（岗位：builder）被 Forge Crab 加入群组。");
    expect(updated.rooms[roomId]?.memberIds.map((memberId) => updated.members[memberId]?.handle)).toContain("builder-7");
  });

  it("copies template default visible members into new rooms", () => {
    const context = createRuntimeContext();
    const template = defaultTemplates[0];
    if (!template) {
      throw new Error("Expected default product template");
    }

    const snapshot = createProjectWithRoom(
      createWorkspaceSnapshot([
        {
          ...template,
          defaultVisibleMemberBlueprintIds: ["builder"],
        },
      ]),
      {
        projectName: "ACP Lab",
        templateId: template.id,
      },
      context,
    );

    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const visibleHandles = (room.visibleMemberIds ?? []).map((memberId) => snapshot.members[memberId]?.handle);

    expect(visibleHandles).toEqual(["builder"]);
  });

  it("keeps user messages visible while filtering room member messages per member", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");

    if (!builder || !research) {
      throw new Error("Expected builder and research members");
    }

    snapshot = updateRoomSettings(
      snapshot,
      {
        roomId,
        visibleMemberIds: [builder.id],
      },
      context,
    );

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: research.id,
        content: "这条 research 消息不应出现在 room 主视图。",
      },
      context,
    );
    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: builder.id,
        content: "这条 builder 消息应该保留。",
      },
      context,
    );

    const updatedRoom = snapshot.rooms[roomId];
    const visibleContents = (snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => snapshot.messages[messageId])
      .filter((message) => message.transport !== "direct" && message.visibility !== "internal")
      .filter((message) => message.author.kind !== "member" || updatedRoom.visibleMemberIds?.includes(message.author.id))
      .map((message) => message.content);

    expect(visibleContents).toContain(DEFAULT_FIRST_MESSAGE);
    expect(visibleContents).toContain("这条 builder 消息应该保留。");
    expect(visibleContents).not.toContain("这条 research 消息不应出现在 room 主视图。");
  });

  it("counts unread only for currently visible member messages", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");

    if (!builder || !research) {
      throw new Error("Expected builder and research members");
    }

    snapshot = updateRoomSettings(
      snapshot,
      {
        roomId,
        visibleMemberIds: [builder.id],
      },
      context,
    );

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: research.id,
        content: "隐藏成员消息",
      },
      context,
    );
    const hiddenMessageId = snapshot.messageOrderByRoom[roomId]?.at(-1);
    if (!hiddenMessageId) {
      throw new Error("Expected hidden member message");
    }
    snapshot = syncUnreadStateForMessage(snapshot, hiddenMessageId);

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: builder.id,
        content: "可见成员消息",
      },
      context,
    );
    const visibleMessageId = snapshot.messageOrderByRoom[roomId]?.at(-1);
    if (!visibleMessageId) {
      throw new Error("Expected visible member message");
    }
    snapshot = syncUnreadStateForMessage(snapshot, visibleMessageId);

    expect(snapshot.rooms[roomId].unreadMemberMessageCount).toBe(1);
  });

  it("routes member tasks from inline mentions anywhere in the message body", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.isEntryMember)!;

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: lead.id,
        taskId: lead.activeTaskId,
        content: "我负责接住需求，@>research 负责调研，@>builder 负责实现。",
      },
      context,
    );

    const teammateHandles = Object.values(snapshot.tasks)
      .filter((task) => task.roomId === roomId && task.memberId !== lead.id)
      .map((task) => snapshot.members[task.memberId].handle)
      .sort();

    expect(teammateHandles).toEqual(["builder", "research"]);
  });

  it("stores member-to-user directs without routing a new teammate task", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.isEntryMember)!;

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: lead.id,
        taskId: lead.activeTaskId,
        content: "DM-OK",
        directToUser: true,
      },
      context,
    );

    const lastMessageId = snapshot.messageOrderByRoom[roomId]?.at(-1);
    const lastMessage = lastMessageId ? snapshot.messages[lastMessageId] : undefined;

    expect(lastMessage?.transport).toBe("direct");
    expect(lastMessage?.recipientUser).toBe(true);
    expect(
      Object.values(snapshot.tasks).filter((task) => task.roomId === roomId && task.sourceMessageId === lastMessage?.id),
    ).toHaveLength(0);
  });

  it("establishes a watcher baseline before sending digests for new room activity", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    const firstRun = runWatcher(snapshot, watcherId, context);
    const firstDigestMessages = (firstRun.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => firstRun.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(firstDigestMessages).toHaveLength(0);
    expect(firstRun.watchers[watcherId].lastConsumedMessageId).toBeDefined();

    const secondSnapshot = postUserMessage(
      firstRun,
      {
        roomId,
        content: "这是一个新的房间消息",
      },
      context,
    );
    const secondRun = runWatcher(secondSnapshot, watcherId, context);

    const digestMessages = (secondRun.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => secondRun.messages[messageId])
      .filter((message) => message.transport === "watch-digest");
    const latestRoomMessageId = secondSnapshot.messageOrderByRoom[roomId]?.at(-1);
    const latestRoomMessage = latestRoomMessageId ? secondSnapshot.messages[latestRoomMessageId] : undefined;

    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0].content).toContain("这是一个新的房间消息");
    expect(latestRoomMessage).toBeDefined();
    expect(digestMessages[0].content).toContain(
      `[${formatTime(latestRoomMessage!.createdAt)}] ${latestRoomMessage!.author.label}: ${latestRoomMessage!.content}`,
    );
    expect(digestMessages[0].visibility).toBe("internal");
    const watcherMemberId = secondRun.watchers[watcherId].memberId;
    const watcherTask = Object.values(secondRun.tasks).find(
      (task) => task.memberId === watcherMemberId && task.sourceMessageId === digestMessages[0].id,
    );
    expect(watcherTask?.title).toBe("Review watcher digest");
    expect(secondRun.watchers[watcherId].lastConsumedMessageId).toBeDefined();
  });

  it("emits a heartbeat digest for persistent watch even without new activity", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    snapshot.watchers[watcherId] = {
      ...snapshot.watchers[watcherId],
      persistent: true,
    };

    snapshot = runWatcher(snapshot, watcherId, context);
    const next = runWatcher(snapshot, watcherId, context);
    const digestMessages = (next.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => next.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0].content).toContain("[Persistent watch]");
    expect(digestMessages[0].content).toContain("No new room messages or member state changes");
  });

  it("keeps toggle as pure enable/disable for persistent watchers", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    snapshot.watchers[watcherId] = {
      ...snapshot.watchers[watcherId],
      persistent: true,
      enabled: true,
      pausedUntilActivity: true,
    };

    snapshot = toggleWatcher(snapshot, watcherId);
    expect(snapshot.watchers[watcherId].enabled).toBe(false);
    expect(snapshot.watchers[watcherId].pausedUntilActivity).toBe(false);

    snapshot = toggleWatcher(snapshot, watcherId);
    expect(snapshot.watchers[watcherId].enabled).toBe(true);
    expect(snapshot.watchers[watcherId].pausedUntilActivity).toBe(false);
  });

  it("resumes a paused persistent watcher on new activity and consumes that activity immediately", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    snapshot.watchers[watcherId] = {
      ...snapshot.watchers[watcherId],
      persistent: true,
    };

    snapshot = runWatcher(snapshot, watcherId, context);
    snapshot = pauseWatcherUntilActivity(snapshot, watcherId);
    snapshot = postUserMessage(snapshot, { roomId, content: "pause 后的新消息" }, context);
    snapshot = runWatcher(snapshot, watcherId, context);

    const digestMessages = (snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => snapshot.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(snapshot.watchers[watcherId].pausedUntilActivity).toBe(false);
    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0].content).toContain("pause 后的新消息");
  });

  it("keeps a paused persistent watcher paused when only watcher-task output arrives", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    snapshot.watchers[watcherId] = {
      ...snapshot.watchers[watcherId],
      persistent: true,
    };

    snapshot = runWatcher(snapshot, watcherId, context);
    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "第一条真实消息",
      },
      context,
    );
    snapshot = runWatcher(snapshot, watcherId, context);

    const digestMessage = [...(snapshot.messageOrderByRoom[roomId] ?? [])]
      .map((messageId) => snapshot.messages[messageId])
      .reverse()
      .find((message): message is ChatMessage => message.transport === "watch-digest");
    if (!digestMessage) {
      throw new Error("Expected a watcher digest");
    }

    const digestTask = Object.values(snapshot.tasks).find(
      (task) => task.sourceMessageId === digestMessage.id,
    );
    if (!digestTask) {
      throw new Error("Expected a watcher digest task");
    }

    snapshot = acknowledgeWatcherDigestVisibility(snapshot, digestTask.id);
    snapshot = pauseWatcherUntilActivity(snapshot, watcherId);
    snapshot = completeMemberTask(
      snapshot,
      {
        taskId: digestTask.id,
        finalContent: "本轮 watcher digest 仅新增一条提醒，暂无新决策、新分工或待跟进事项。",
      },
      context,
    );

    const summaryMessageId = snapshot.messageOrderByRoom[roomId][snapshot.messageOrderByRoom[roomId].length - 1];
    const next = runWatcher(snapshot, watcherId, context);
    const digestMessages = (next.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => next.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(next.watchers[watcherId].pausedUntilActivity).toBe(true);
    expect(next.watchers[watcherId].lastConsumedMessageId).toBe(summaryMessageId);
    expect(digestMessages).toHaveLength(1);
  });

  it("triggers a watcher when member state changes even without a new room message", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead");

    if (!lead?.activeTaskId) {
      throw new Error("Expected an active lead task");
    }

    snapshot = runWatcher(snapshot, watcherId, context);
    snapshot = appendTaskTrace(
      snapshot,
      {
        taskId: lead.activeTaskId,
        roomId,
        memberId: lead.id,
        kind: "status",
        title: "ACP status",
        content: "Plan updated (2 step(s))",
      },
      context,
    );

    const next = runWatcher(snapshot, watcherId, context);
    const digestMessages = (next.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => next.messages[messageId])
      .filter((message) => message.transport === "watch-digest");
    const latestTraceId = snapshot.taskTraceOrderByTask[lead.activeTaskId]?.at(-1);
    const latestTrace = latestTraceId ? snapshot.taskTraces[latestTraceId] : undefined;

    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0].content).toContain("[Member state]");
    expect(digestMessages[0].content).toContain("@lead: running");
    expect(digestMessages[0].content).toContain("task:");
    expect(digestMessages[0].content).toContain("status: Plan updated (2 step(s))");
    expect(latestTrace).toBeDefined();
    expect(digestMessages[0].content).not.toContain("[Unseen messages]");
    expect(next.watchers[watcherId].lastConsumedStateAt).toBeDefined();
  });

  it("filters template ack placeholders without blocking later real updates", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    const builder = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder")!;

    snapshot = runWatcher(snapshot, watcherId, context);
    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: builder.id,
        content: "收到任务。我会先整理当前房间上下文。如果需要协调其他成员，我会在最终消息里明确 @>handle。",
      },
      context,
    );

    const afterAckRun = runWatcher(snapshot, watcherId, context);
    const messagesAfterAck = (afterAckRun.messageOrderByRoom[roomId] ?? []).map((messageId) => afterAckRun.messages[messageId]);

    expect(messagesAfterAck.filter((message) => message.transport === "watch-digest")).toHaveLength(0);
    expect(afterAckRun.watchers[watcherId].lastConsumedMessageId).toBe(messagesAfterAck[messagesAfterAck.length - 1].id);

    const nextSnapshot = postUserMessage(
      afterAckRun,
      {
        roomId,
        content: "这是一个新的房间消息",
      },
      context,
    );
    const finalRun = runWatcher(nextSnapshot, watcherId, context);
    const digestMessages = (finalRun.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => finalRun.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0].content).toContain("这是一个新的房间消息");
    expect(digestMessages[0].content).not.toContain("收到任务");
  });

  it("excludes watcher-task digest summaries from future watcher digests", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];

    snapshot = runWatcher(snapshot, watcherId, context);
    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "第一条真实消息",
      },
      context,
    );
    snapshot = runWatcher(snapshot, watcherId, context);

    const firstDigest = [...((snapshot.messageOrderByRoom[roomId] ?? []).map((messageId) => snapshot.messages[messageId]))]
      .reverse()
      .find((message): message is ChatMessage => message.transport === "watch-digest");

    expect(firstDigest).toBeDefined();

    const digestTask = Object.values(snapshot.tasks).find((task) => task.sourceMessageId === firstDigest!.id);
    expect(digestTask).toBeDefined();
    snapshot = acknowledgeWatcherDigestVisibility(snapshot, digestTask!.id);

    snapshot = completeMemberTask(
      snapshot,
      {
        taskId: digestTask!.id,
        finalContent: "本轮 watcher digest 仅新增一条提醒，暂无新决策、新分工或待跟进事项。",
      },
      context,
    );

    const summaryMessageId = snapshot.messageOrderByRoom[roomId][snapshot.messageOrderByRoom[roomId].length - 1];
    const afterSummaryRun = runWatcher(snapshot, watcherId, context);
    const digestMessagesAfterSummary = (afterSummaryRun.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => afterSummaryRun.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(digestMessagesAfterSummary).toHaveLength(1);
    expect(afterSummaryRun.watchers[watcherId].lastConsumedMessageId).toBe(summaryMessageId);

    const nextSnapshot = postUserMessage(
      afterSummaryRun,
      {
        roomId,
        content: "第二条真实消息",
      },
      context,
    );
    const finalRun = runWatcher(nextSnapshot, watcherId, context);
    const finalDigestMessages = (finalRun.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => finalRun.messages[messageId])
      .filter((message) => message.transport === "watch-digest");
    const latestDigest = finalDigestMessages[finalDigestMessages.length - 1];

    expect(finalDigestMessages).toHaveLength(2);
    expect(latestDigest.content).toContain("第二条真实消息");
    expect(latestDigest.content).not.toContain("本轮 watcher digest");
  });

  it("does not auto-route unrelated members when a teammate sends a normal group reply", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const lead = Object.values(snapshot.members).find((member) => member.isEntryMember);
    const scribe = Object.values(snapshot.members).find((member) => member.handle === "scribe");
    const roomId = snapshot.selection.roomId!;
    expect(lead?.activeTaskId).toBeDefined();
    expect(scribe?.activeTaskId).toBeUndefined();

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: lead!.id,
        taskId: lead!.activeTaskId!,
        content: "我先整理范围，暂时不委派其他成员。",
      },
      context,
    );
    snapshot = completeMemberTask(snapshot, { taskId: lead!.activeTaskId! }, context);

    expect(Object.values(snapshot.tasks).filter((task) => task.status === "running")).toHaveLength(0);
    expect(snapshot.members[scribe!.id].activeTaskId).toBeUndefined();
  });

  it("keeps treating quoted @> syntax inside code spans as active role routing", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);
    const roomId = snapshot.selection.roomId!;
    const lead = Object.values(snapshot.members).find((member) => member.isEntryMember);

    if (!lead?.activeTaskId) {
      throw new Error("Expected an active entry member task");
    }

    snapshot = cloneRoomTeamForRoleRouting(
      snapshot,
      roomId,
      {
        builderHandles: [],
      },
      context,
    );

    const routed = postUserMessage(snapshot, { roomId, content: "@>builder 继续实现" }, context);
    const noticeCountBeforeReply = (routed.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => routed.messages[messageId])
      .filter((message) => message.author.kind === "system" && message.content === "岗位路由未执行：@>builder 对应岗位当前无人可接。").length;

    const withReply = postMemberMessage(
      routed,
      {
        roomId,
        memberId: lead.id,
        taskId: lead.activeTaskId,
        content: "当前阻塞点是代码样式的 ``@>builder`` 只是示例，不应再触发岗位路由。",
      },
      context,
    );
    const noticeCountAfterReply = (withReply.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => withReply.messages[messageId])
      .filter((message) => message.author.kind === "system" && message.content === "岗位路由未执行：@>builder 对应岗位当前无人可接。").length;

    expect(noticeCountBeforeReply).toBe(1);
    expect(noticeCountAfterReply).toBe(2);
  });

  it("updates member config, supports entry-member reassignment, and respects direct-message opt-out", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder")!;

    snapshot = updateMemberConfig(snapshot, {
      memberId: builder.id,
      summary: "新的 builder summary",
      prompt: "新的 builder prompt",
      modelProfileId: "model-codex-acp-default",
      acceptsDirectMessages: false,
      allowedSkillIds: ["room-send-group"],
      provider: {
        ...builder.provider,
        command: "claude-code",
        args: ["--stdio"],
        env: { ANTHROPIC_API_KEY: "demo" },
        capabilities: ["prompt", "cancel"],
      },
    });
    snapshot = setEntryMember(snapshot, builder.id);
    snapshot = upsertMemberWatcher(
      snapshot,
      {
        memberId: builder.id,
        enabled: true,
        intervalMinutes: 7,
      },
      context,
    );
    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "这是一条 direct message",
        directMemberId: builder.id,
      },
      context,
    );

    expect(snapshot.members[builder.id].provider.command).toBe(builder.provider.command);
    expect(snapshot.members[builder.id].modelProfileId).toBe("model-codex-acp-default");
    expect(snapshot.members[builder.id].allowedSkillIds).toHaveLength(1);
    expect(snapshot.rooms[roomId].entryMemberId).toBe(builder.id);
    expect(snapshot.members[builder.id].isEntryMember).toBe(true);
    expect(snapshot.rooms[roomId].watcherIds.some((watcherId) => snapshot.watchers[watcherId]?.memberId === builder.id)).toBe(true);
    expect(snapshot.members[builder.id].activeTaskId).toBeUndefined();
  });

  it("updates global template defaults without rewriting existing room members", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const template = snapshot.templates[room.templateId];
    const builderBlueprint = template.members.find((member) => member.handle === "builder");
    const roomBuilder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder");

    if (!builderBlueprint || !roomBuilder) {
      throw new Error("Expected builder blueprint and builder room member");
    }

    snapshot = updateTemplate(snapshot, {
      templateId: template.id,
      name: "Product Pod v2",
      description: "新的全局模板描述",
      accentTone: "correction",
      members: template.members.map((member) =>
        member.id === builderBlueprint.id
          ? {
              ...member,
              summary: "新的模板 builder summary",
              prompt: "新的模板 builder prompt",
              provider: {
                ...member.provider,
                command: "claude-code",
              },
            }
          : member),
    });

    expect(snapshot.templates[template.id].name).toBe("Product Pod v2");
    expect(snapshot.templates[template.id].accentTone).toBe("correction");
    expect(snapshot.templates[template.id].members.find((member) => member.id === builderBlueprint.id)?.summary).toBe("新的模板 builder summary");
    expect(snapshot.templates[template.id].members.find((member) => member.id === builderBlueprint.id)?.provider.command).toBe("claude-code");
    expect(snapshot.members[roomBuilder.id].summary).not.toBe("新的模板 builder summary");
    expect(snapshot.members[roomBuilder.id].provider.command).not.toBe("claude-code");
  });

  it("keeps room team metadata and composition local to the room", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const roomMembers = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = roomMembers.find((member) => member.handle === "lead");
    const builder = roomMembers.find((member) => member.handle === "builder");
    const research = roomMembers.find((member) => member.handle === "research");

    if (!lead || !builder || !research) {
      throw new Error("Expected lead, builder, and research members");
    }

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId,
        memberId: research.id,
        content: "这是 research 留下的一条历史消息。",
      },
      context,
    );
    const historyMessageId = snapshot.messageOrderByRoom[roomId]?.at(-1);

    snapshot = updateRoomTeam(
      snapshot,
      {
        roomId,
        teamName: "Room Tiger Team",
        teamDescription: "只对当前 room 生效的本地团队配置。",
        teamAccentTone: "correction",
        members: [
          {
            memberId: lead.id,
            roleId: lead.roleId,
            roleName: lead.roleName,
            name: lead.name,
            handle: lead.handle,
            summary: lead.summary,
            note: lead.note,
            prompt: lead.prompt,
            accentTone: lead.accentTone,
            modelProfileId: lead.modelProfileId,
            allowedSkillIds: lead.allowedSkillIds,
            provider: lead.provider,
            isEntryMember: true,
            acceptsDirectMessages: lead.acceptsDirectMessages,
          },
          {
            memberId: builder.id,
            roleId: builder.roleId,
            roleName: builder.roleName,
            name: builder.name,
            handle: builder.handle,
            summary: "Room-local builder summary",
            note: builder.note,
            prompt: builder.prompt,
            accentTone: builder.accentTone,
            modelProfileId: builder.modelProfileId,
            allowedSkillIds: builder.allowedSkillIds,
            provider: builder.provider,
            acceptsDirectMessages: builder.acceptsDirectMessages,
            watch: {
              enabled: true,
              intervalMinutes: 9,
            },
          },
          {
            memberId: "qa-temp",
            roleId: builder.roleId,
            roleName: builder.roleName,
            name: "Signal Heron",
            handle: "builder-4",
            summary: builder.summary,
            note: "补位质量检查。",
            prompt: builder.prompt,
            accentTone: builder.accentTone,
            modelProfileId: builder.modelProfileId,
            allowedSkillIds: builder.allowedSkillIds,
            provider: builder.provider,
            acceptsDirectMessages: builder.acceptsDirectMessages,
          },
        ],
      },
      context,
    );

    const nextRoom = snapshot.rooms[roomId];
    const nextMembers = nextRoom.memberIds.map((memberId) => snapshot.members[memberId]);
    const qa = nextMembers.find((member) => member.handle === "builder-4");
    const systemNotices = (snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => snapshot.messages[messageId])
      .filter((message) => message.author.kind === "system");

    expect(nextRoom.teamName).toBe("Room Tiger Team");
    expect(nextRoom.teamDescription).toBe("只对当前 room 生效的本地团队配置。");
    expect(nextRoom.teamAccentTone).toBe("correction");
    expect(snapshot.templates[room.templateId].name).toBe("Product Pod");
    expect(nextMembers.some((member) => member.id === research.id)).toBe(false);
    expect(snapshot.members[research.id].archivedAt).toBeDefined();
    expect(snapshot.messages[historyMessageId!]?.author.id).toBe(research.id);
    expect(nextMembers.find((member) => member.id === builder.id)?.summary).toBe("Room-local builder summary");
    expect(nextRoom.watcherIds.some((watcherId) => snapshot.watchers[watcherId]?.memberId === builder.id)).toBe(true);
    expect(qa?.roomId).toBe(roomId);
    expect(qa?.roleId).toBe(builder.roleId);
    expect(systemNotices.some((message) => message.content.includes("Signal Heron 被 You 加入群组"))).toBe(true);
    expect(systemNotices.some((message) => message.content.includes(`${research.name} 被 You 移除群组`))).toBe(true);
  });
});
