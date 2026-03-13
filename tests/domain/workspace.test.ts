import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import type { ChatMessage } from "@/domain/model";
import {
  appendTaskTrace,
  completeMemberTask,
  createProjectWithRoom,
  createWorkspaceSnapshot,
  extractAddressedMemberIds,
  extractMentionMemberIds,
  extractQuotedMemberIds,
  postMemberDraft,
  postMemberMessage,
  postUserMessage,
  runWatcher,
  setEntryMember,
  upsertTaskTrace,
  updateRoomTeam,
  updateRoomSettings,
  updateTemplate,
  updateMemberConfig,
  upsertMemberWatcher,
  syncUnreadStateForMessage,
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
    expect(digestMessages[0].content).toContain("[Member state changes]");
    expect(digestMessages[0].content).toContain("@lead status: Plan updated (2 step(s))");
    expect(latestTrace).toBeDefined();
    expect(digestMessages[0].content).toContain(`[${formatTime(latestTrace!.createdAt)}] @lead status: Plan updated (2 step(s))`);
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

  it("does not auto-route monitor-all members when a teammate sends a normal group reply", () => {
    const context = createRuntimeContext();
    let snapshot = createStartedProjectSnapshot(context);

    const lead = Object.values(snapshot.members).find((member) => member.isEntryMember);
    const scribe = Object.values(snapshot.members).find((member) => member.handle === "scribe");
    const roomId = snapshot.selection.roomId!;
    expect(lead?.activeTaskId).toBeDefined();
    expect(scribe?.observeAllRoomMessages).toBe(true);
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
      skills: [
        {
          id: "ship",
          name: "Ship code",
          description: "提交改动",
          command: "./bin/oa-room-send --scope group --text \"已提交\"",
        },
      ],
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
    expect(snapshot.members[builder.id].skills).toHaveLength(1);
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
            name: lead.name,
            handle: lead.handle,
            summary: lead.summary,
            prompt: lead.prompt,
            accentTone: lead.accentTone,
            modelProfileId: lead.modelProfileId,
            skills: lead.skills,
            provider: lead.provider,
            isEntryMember: true,
            observeAllRoomMessages: lead.observeAllRoomMessages,
            acceptsDirectMessages: lead.acceptsDirectMessages,
          },
          {
            memberId: builder.id,
            name: builder.name,
            handle: builder.handle,
            summary: "Room-local builder summary",
            prompt: builder.prompt,
            accentTone: builder.accentTone,
            modelProfileId: builder.modelProfileId,
            skills: builder.skills,
            provider: builder.provider,
            observeAllRoomMessages: builder.observeAllRoomMessages,
            acceptsDirectMessages: builder.acceptsDirectMessages,
            watch: {
              enabled: true,
              intervalMinutes: 9,
            },
          },
          {
            memberId: "qa-temp",
            name: "Signal Heron",
            handle: "qa",
            summary: "负责当前 room 的质量检查。",
            prompt: "检查当前 room 里的实现和回归风险。",
            accentTone: "blueprint",
            modelProfileId: builder.modelProfileId,
            skills: builder.skills,
            provider: builder.provider,
            observeAllRoomMessages: false,
            acceptsDirectMessages: true,
          },
        ],
      },
      context,
    );

    const nextRoom = snapshot.rooms[roomId];
    const nextMembers = nextRoom.memberIds.map((memberId) => snapshot.members[memberId]);
    const qa = nextMembers.find((member) => member.handle === "qa");

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
  });
});
