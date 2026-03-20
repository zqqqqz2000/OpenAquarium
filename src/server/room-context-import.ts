import type {
  ChatMessage,
  MemberTask,
  Project,
  Room,
  TaskTraceEntry,
  TeamMember,
  TeamTemplate,
  WatchSubscription,
  WorkspaceSnapshot,
} from "@/domain/model";
import type { MutationContext } from "@/domain/identity";
import {
  createProviderAssociationRequiredBinding,
} from "@/lib/provider-association";
import type {
  PersistedRoomContextMember,
  PersistedRoomContextSnapshot,
} from "@/server/room-context-files";

function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    projects: { ...snapshot.projects },
    projectOrder: [...snapshot.projectOrder],
    rooms: { ...snapshot.rooms },
    roomOrderByProject: Object.fromEntries(
      Object.entries(snapshot.roomOrderByProject).map(([projectId, roomIds]) => [
        projectId,
        [...roomIds],
      ]),
    ),
    templates: { ...snapshot.templates },
    templateOrder: [...snapshot.templateOrder],
    members: { ...snapshot.members },
    messages: { ...snapshot.messages },
    messageOrderByRoom: Object.fromEntries(
      Object.entries(snapshot.messageOrderByRoom).map(([roomId, messageIds]) => [
        roomId,
        [...messageIds],
      ]),
    ),
    tasks: { ...snapshot.tasks },
    taskTraces: { ...snapshot.taskTraces },
    taskTraceOrderByTask: Object.fromEntries(
      Object.entries(snapshot.taskTraceOrderByTask).map(([taskId, traceIds]) => [
        taskId,
        [...traceIds],
      ]),
    ),
    watchers: { ...snapshot.watchers },
    selection: { ...snapshot.selection },
  };
}

type ImportEntityKind =
  | "project"
  | "room"
  | "member"
  | "watcher"
  | "task"
  | "message"
  | "trace";

function buildReservedIdSet(snapshot: WorkspaceSnapshot): Set<string> {
  return new Set([
    ...Object.keys(snapshot.projects),
    ...Object.keys(snapshot.rooms),
    ...Object.keys(snapshot.templates),
    ...Object.keys(snapshot.members),
    ...Object.keys(snapshot.messages),
    ...Object.keys(snapshot.tasks),
    ...Object.keys(snapshot.taskTraces),
    ...Object.keys(snapshot.watchers),
  ]);
}

function allocateImportedId(args: {
  originalId: string;
  kind: ImportEntityKind;
  reservedIds: Set<string>;
  context: MutationContext;
}): string {
  const normalizedOriginalId = args.originalId.trim();
  if (normalizedOriginalId.length > 0 && !args.reservedIds.has(normalizedOriginalId)) {
    args.reservedIds.add(normalizedOriginalId);
    return normalizedOriginalId;
  }

  let nextId = args.context.createId(args.kind);
  while (args.reservedIds.has(nextId)) {
    nextId = args.context.createId(args.kind);
  }

  args.reservedIds.add(nextId);
  return nextId;
}

function mapOptionalId(id: string | undefined, idMap: ReadonlyMap<string, string>): string | undefined {
  return id ? idMap.get(id) : undefined;
}

function mapIdList(ids: string[] | undefined, idMap: ReadonlyMap<string, string>): string[] {
  if (!ids) {
    return [];
  }

  return ids.flatMap((id) => {
    const nextId = idMap.get(id);
    return nextId ? [nextId] : [];
  });
}

function buildProviderAssociationRequiredLabel(member: PersistedRoomContextMember): string {
  const hintLabel = member.providerHint?.label?.trim();
  return hintLabel
    ? `Provider association required (previously ${hintLabel})`
    : "Provider association required";
}

function resolveTemplateAccentTone(roomContext: PersistedRoomContextSnapshot): TeamTemplate["accentTone"] {
  return roomContext.room.teamAccentTone
    ?? roomContext.members[0]?.accentTone
    ?? "paper";
}

function buildImportedTemplate(roomContext: PersistedRoomContextSnapshot): TeamTemplate {
  const usedMemberIds = new Set<string>();
  const templateMemberIdByMemberId = new Map<string, string>();
  const members = roomContext.members.map((member, index) => {
    const baseId =
      member.blueprintId.trim()
      || member.roleId.trim()
      || member.handle.trim()
      || `member-${index + 1}`;
    let candidateId = baseId;
    let suffix = 2;

    while (usedMemberIds.has(candidateId)) {
      candidateId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    usedMemberIds.add(candidateId);
    templateMemberIdByMemberId.set(member.id, candidateId);

    return {
      id: candidateId,
      name: member.name,
      handle: member.handle,
      isRole: member.isRole,
      summary: member.summary,
      prompt: member.prompt,
      accentTone: member.accentTone,
      modelProfileId: member.modelProfileId,
      modelId: member.modelId,
      allowedSkillIds: [...member.allowedSkillIds],
      provider: createProviderAssociationRequiredBinding(
        buildProviderAssociationRequiredLabel(member),
      ),
      isEntryMember: member.isEntryMember,
      acceptsDirectMessages: member.acceptsDirectMessages,
      codexThinkingDepth: member.codexThinkingDepth,
    };
  });

  return {
    id: roomContext.room.templateId,
    name: roomContext.room.teamName?.trim() || roomContext.project.name,
    description:
      roomContext.room.teamDescription?.trim()
      || roomContext.room.topic.trim()
      || "Imported room team.",
    accentTone: resolveTemplateAccentTone(roomContext),
    defaultVisibleMemberBlueprintIds: mapIdList(
      roomContext.room.visibleMemberIds,
      templateMemberIdByMemberId,
    ),
    members,
  };
}

function ensureImportedTemplate(snapshot: WorkspaceSnapshot, roomContext: PersistedRoomContextSnapshot): string {
  const { templateId } = roomContext.room;

  if (!snapshot.templates[templateId]) {
    snapshot.templates[templateId] = buildImportedTemplate(roomContext);
  }

  if (!snapshot.templateOrder.includes(templateId)) {
    snapshot.templateOrder.push(templateId);
  }

  return templateId;
}

function normalizeImportedTaskStatus(task: MemberTask): MemberTask["status"] {
  return task.status === "running" ? "interrupted" : task.status;
}

function normalizeImportedMessageStatus(message: ChatMessage): ChatMessage["status"] {
  return message.status === "streaming" ? "interrupted" : message.status;
}

function compareRoomsByCreationTime(
  left: PersistedRoomContextSnapshot,
  right: PersistedRoomContextSnapshot,
): number {
  const createdOrder = left.room.createdAt.localeCompare(right.room.createdAt);
  return createdOrder !== 0 ? createdOrder : left.room.id.localeCompare(right.room.id);
}

function compareRoomsByUpdateTime(
  left: PersistedRoomContextSnapshot,
  right: PersistedRoomContextSnapshot,
): number {
  const leftUpdatedAt = left.room.updatedAt ?? left.room.createdAt;
  const rightUpdatedAt = right.room.updatedAt ?? right.room.createdAt;
  const updatedOrder = rightUpdatedAt.localeCompare(leftUpdatedAt);
  return updatedOrder !== 0 ? updatedOrder : left.room.id.localeCompare(right.room.id);
}

function createImportedProject(args: {
  projectId: string;
  roomContexts: PersistedRoomContextSnapshot[];
  projectName: string;
  projectPath?: string;
}): Project {
  const { projectId, roomContexts, projectName, projectPath } = args;
  const chronologicalRoomContexts = [...roomContexts].sort(compareRoomsByCreationTime);
  const latestRoomContext = [...roomContexts].sort(compareRoomsByUpdateTime)[0];
  const createdAt = chronologicalRoomContexts[0]?.room.createdAt ?? new Date().toISOString();
  const updatedAt = latestRoomContext?.room.updatedAt ?? latestRoomContext?.room.createdAt ?? createdAt;

  return {
    id: projectId,
    name: projectName.trim() || latestRoomContext?.project.name?.trim() || "Imported project",
    path: projectPath?.trim() || undefined,
    createdAt,
    updatedAt,
  };
}

export function importProjectFromRoomContexts(args: {
  current: WorkspaceSnapshot;
  roomContexts: PersistedRoomContextSnapshot[];
  projectName: string;
  projectPath?: string;
  context: MutationContext;
}): WorkspaceSnapshot {
  const { current, roomContexts, projectName, projectPath, context } = args;
  if (roomContexts.length === 0) {
    throw new Error("No importable room context files were found.");
  }

  const snapshot = cloneSnapshot(current);
  const reservedIds = buildReservedIdSet(snapshot);
  const sortedRoomContexts = [...roomContexts].sort(compareRoomsByCreationTime);
  const preferredRoomContext = [...roomContexts].sort(compareRoomsByUpdateTime)[0];
  const importedProjectSourceId = preferredRoomContext?.project.id ?? roomContexts[0]?.project.id ?? "";
  const projectId = allocateImportedId({
    originalId: importedProjectSourceId,
    kind: "project",
    reservedIds,
    context,
  });

  snapshot.projects[projectId] = createImportedProject({
    projectId,
    roomContexts,
    projectName,
    projectPath,
  });
  snapshot.projectOrder.push(projectId);
  snapshot.roomOrderByProject[projectId] = [];

  let selectionRoomId: string | undefined;
  let selectionMemberId: string | undefined;

  sortedRoomContexts.forEach((roomContext) => {
    const roomId = allocateImportedId({
      originalId: roomContext.room.id,
      kind: "room",
      reservedIds,
      context,
    });
    const templateId = ensureImportedTemplate(snapshot, roomContext);
    const memberIdMap = new Map(
      roomContext.members.map((member) => [
        member.id,
        allocateImportedId({
          originalId: member.id,
          kind: "member",
          reservedIds,
          context,
        }),
      ] as const),
    );
    const watcherIdMap = new Map(
      roomContext.watchers.map((watcher) => [
        watcher.id,
        allocateImportedId({
          originalId: watcher.id,
          kind: "watcher",
          reservedIds,
          context,
        }),
      ] as const),
    );
    const taskIdMap = new Map(
      roomContext.tasks.map((task) => [
        task.id,
        allocateImportedId({
          originalId: task.id,
          kind: "task",
          reservedIds,
          context,
        }),
      ] as const),
    );
    const messageIdMap = new Map(
      roomContext.messages.map((message) => [
        message.id,
        allocateImportedId({
          originalId: message.id,
          kind: "message",
          reservedIds,
          context,
        }),
      ] as const),
    );
    const traceIdMap = new Map(
      roomContext.taskTraces.map((trace) => [
        trace.id,
        allocateImportedId({
          originalId: trace.id,
          kind: "trace",
          reservedIds,
          context,
        }),
      ] as const),
    );

    const roomMemberIds = mapIdList(roomContext.room.memberIds, memberIdMap);
    if (roomMemberIds.length === 0) {
      throw new Error(`Imported room "${roomContext.room.name}" has no members.`);
    }

    const tasks = roomContext.tasks.flatMap((task) => {
      const nextTaskId = taskIdMap.get(task.id);
      const nextMemberId = memberIdMap.get(task.memberId);
      const nextSourceMessageId = messageIdMap.get(task.sourceMessageId);

      if (!nextTaskId || !nextMemberId || !nextSourceMessageId) {
        return [];
      }

      return [{
        ...task,
        id: nextTaskId,
        roomId,
        memberId: nextMemberId,
        sourceMessageId: nextSourceMessageId,
        status: normalizeImportedTaskStatus(task),
      } satisfies MemberTask];
    });

    const tasksById = Object.fromEntries(tasks.map((task) => [task.id, task] as const));
    const messages = roomContext.messages.flatMap((message) => {
      const nextMessageId = messageIdMap.get(message.id);
      if (!nextMessageId) {
        return [];
      }

      const nextAuthor =
        message.author.kind === "member"
          ? {
              ...message.author,
              id: memberIdMap.get(message.author.id) ?? message.author.id,
            }
          : message.author;

      return [{
        ...message,
        id: nextMessageId,
        roomId,
        author: nextAuthor,
        status: normalizeImportedMessageStatus(message),
        mentionedMemberIds: mapIdList(message.mentionedMemberIds, memberIdMap),
        quotedMemberIds: mapIdList(message.quotedMemberIds, memberIdMap),
        recipientMemberIds: mapIdList(message.recipientMemberIds, memberIdMap),
        taskId: mapOptionalId(message.taskId, taskIdMap),
      } satisfies ChatMessage];
    });

    const members = roomContext.members.flatMap((member) => {
      const nextMemberId = memberIdMap.get(member.id);
      if (!nextMemberId) {
        return [];
      }

      const {
        providerAssociationRequired,
        providerHint,
        ...persistedMember
      } = member;
      void providerAssociationRequired;

      return [{
        ...persistedMember,
        id: nextMemberId,
        roomId,
        provider: createProviderAssociationRequiredBinding(
          buildProviderAssociationRequiredLabel({
            ...member,
            providerHint,
          }),
        ),
        status: "idle",
        providerSessionId: undefined,
        openAICompatibleConversation: undefined,
        activeTaskId: undefined,
      } satisfies TeamMember];
    });

    const watchers = roomContext.watchers.flatMap((watcher) => {
      const nextWatcherId = watcherIdMap.get(watcher.id);
      const nextMemberId = memberIdMap.get(watcher.memberId);
      if (!nextWatcherId || !nextMemberId) {
        return [];
      }

      return [{
        ...watcher,
        id: nextWatcherId,
        roomId,
        memberId: nextMemberId,
        lastConsumedMessageId: mapOptionalId(watcher.lastConsumedMessageId, messageIdMap),
        pendingDigestMessageId: mapOptionalId(watcher.pendingDigestMessageId, messageIdMap),
        pendingConsumedMessageId: mapOptionalId(watcher.pendingConsumedMessageId, messageIdMap),
      } satisfies WatchSubscription];
    });

    const taskTraces = roomContext.taskTraces.flatMap((trace) => {
      const nextTraceId = traceIdMap.get(trace.id);
      const nextTaskId = taskIdMap.get(trace.taskId);
      if (!nextTraceId || !nextTaskId || !tasksById[nextTaskId]) {
        return [];
      }

      return [{
        ...trace,
        id: nextTraceId,
        taskId: nextTaskId,
      } satisfies TaskTraceEntry];
    });

    const nextEntryMemberId = memberIdMap.get(roomContext.room.entryMemberId) ?? roomMemberIds[0];
    const nextRoom: Room = {
      ...roomContext.room,
      id: roomId,
      projectId,
      templateId,
      memberIds: roomMemberIds,
      watcherIds: mapIdList(roomContext.room.watcherIds, watcherIdMap),
      entryMemberId: nextEntryMemberId,
      visibleMemberIds: roomContext.room.visibleMemberIds
        ? mapIdList(roomContext.room.visibleMemberIds, memberIdMap)
        : undefined,
      unreadMemberMessageCount: roomContext.room.unreadMemberMessageCount ?? 0,
    };

    snapshot.roomOrderByProject[projectId].push(roomId);
    snapshot.rooms[roomId] = nextRoom;
    snapshot.messageOrderByRoom[roomId] = mapIdList(roomContext.messageOrder, messageIdMap);

    members.forEach((member) => {
      snapshot.members[member.id] = member;
    });
    messages.forEach((message) => {
      snapshot.messages[message.id] = message;
    });
    tasks.forEach((task) => {
      snapshot.tasks[task.id] = task;
    });
    watchers.forEach((watcher) => {
      snapshot.watchers[watcher.id] = watcher;
    });
    taskTraces.forEach((trace) => {
      snapshot.taskTraces[trace.id] = trace;
    });

    Object.entries(roomContext.taskTraceOrderByTask).forEach(([originalTaskId, traceIds]) => {
      const nextTaskId = taskIdMap.get(originalTaskId);
      if (!nextTaskId || !snapshot.tasks[nextTaskId]) {
        return;
      }

      snapshot.taskTraceOrderByTask[nextTaskId] = mapIdList(traceIds, traceIdMap);
    });

    if (roomContext.room.id === preferredRoomContext?.room.id) {
      selectionRoomId = roomId;
      selectionMemberId = nextEntryMemberId;
    }
  });

  snapshot.selection = {
    projectId,
    roomId: selectionRoomId ?? snapshot.roomOrderByProject[projectId][0],
    memberId: selectionMemberId,
  };

  return snapshot;
}
