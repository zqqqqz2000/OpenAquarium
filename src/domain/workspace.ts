import type {
  AccentTone,
  ChatAuthor,
  ChatMessage,
  CompleteTaskInput,
  ProjectId,
  CreateRoomInput,
  CreateProjectInput,
  MemberId,
  MemberTask,
  MessageId,
  PostMemberMessageInput,
  PostMemberDraftInput,
  PostUserMessageInput,
  ProviderBinding,
  RoomId,
  Room,
  RoomTeamMemberInput,
  TaskId,
  TaskTraceEntry,
  TemplateId,
  TeamMember,
  TeamMemberBlueprint,
  TeamTemplate,
  UpsertWatcherInput,
  UpdateMemberConfigInput,
  UpdateRoomSettingsInput,
  UpdateRoomTeamInput,
  UpdateTemplateInput,
  WatchSubscription,
  WorkspaceSnapshot,
} from "./model";
import type { MutationContext } from "./identity";
import { normalizeAllowedSkillIds } from "../lib/skills";
import { formatTime } from "../lib/time";
import { isVisibleMainRoomMessage } from "../lib/message-visibility";
import {
  countUnreadRoomMemberMessages,
  resolveRoomVisibleMemberIds,
  resolveRoomVisibleMemberIdSet,
  resolveTemplateVisibleMemberBlueprintIds,
} from "../lib/room-message-preferences";

function cloneSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    projects: { ...snapshot.projects },
    projectOrder: [...snapshot.projectOrder],
    rooms: { ...snapshot.rooms },
    roomOrderByProject: Object.fromEntries(
      Object.entries(snapshot.roomOrderByProject).map(([projectId, roomIds]) => [projectId, [...roomIds]]),
    ),
    templates: { ...snapshot.templates },
    templateOrder: [...snapshot.templateOrder],
    members: { ...snapshot.members },
    messages: { ...snapshot.messages },
    messageOrderByRoom: Object.fromEntries(
      Object.entries(snapshot.messageOrderByRoom).map(([roomId, messageIds]) => [roomId, [...messageIds]]),
    ),
    tasks: { ...snapshot.tasks },
    taskTraces: { ...snapshot.taskTraces },
    taskTraceOrderByTask: Object.fromEntries(
      Object.entries(snapshot.taskTraceOrderByTask).map(([taskId, traceIds]) => [taskId, [...traceIds]]),
    ),
    watchers: { ...snapshot.watchers },
    selection: { ...snapshot.selection },
  };
}

function buildUserAuthor(userName: string): ChatAuthor {
  return {
    kind: "user",
    id: "user",
    label: userName,
  };
}

function buildSystemAuthor(label: string): ChatAuthor {
  return {
    kind: "system",
    id: "system",
    label,
  };
}

function buildMemberAuthor(member: TeamMember): ChatAuthor {
  return {
    kind: "member",
    id: member.id,
    label: member.name,
  };
}

function touchRoomActivity(snapshot: WorkspaceSnapshot, roomId: RoomId, timestamp: string): void {
  const room = snapshot.rooms[roomId];
  if (!room) {
    return;
  }

  snapshot.rooms[roomId] = {
    ...room,
    updatedAt: timestamp,
  };

  const project = snapshot.projects[room.projectId];
  if (!project) {
    return;
  }

  snapshot.projects[project.id] = {
    ...project,
    updatedAt: timestamp,
  };
}

function setRoomReadState(snapshot: WorkspaceSnapshot, roomId: RoomId, readAt: string): void {
  const room = snapshot.rooms[roomId];
  if (!room) {
    return;
  }

  snapshot.rooms[roomId] = {
    ...room,
    lastReadMemberMessageAt: readAt,
    unreadMemberMessageCount: 0,
  };
}

function recalculateRoomUnreadCount(snapshot: WorkspaceSnapshot, roomId: RoomId): void {
  const room = snapshot.rooms[roomId];
  if (!room) {
    return;
  }

  snapshot.rooms[roomId] = {
    ...room,
    unreadMemberMessageCount: countUnreadRoomMemberMessages(snapshot, room, snapshot.templates[room.templateId]),
  };
}

function insertMessage(snapshot: WorkspaceSnapshot, message: ChatMessage): void {
  snapshot.messages[message.id] = message;
  snapshot.messageOrderByRoom[message.roomId] ??= [];
  snapshot.messageOrderByRoom[message.roomId].push(message.id);
}

function insertSystemRoomMessage(snapshot: WorkspaceSnapshot, args: {
  roomId: RoomId;
  content: string;
  createdAt: string;
  createId: MutationContext["createId"];
}): void {
  insertMessage(snapshot, {
    id: args.createId("message"),
    roomId: args.roomId,
    author: buildSystemAuthor("System"),
    content: args.content,
    createdAt: args.createdAt,
    transport: "group",
    status: "sent",
    mentionedMemberIds: [],
    quotedMemberIds: [],
    recipientMemberIds: [],
  });
  touchRoomActivity(snapshot, args.roomId, args.createdAt);
}

const ASSIGNMENT_TOKEN_PATTERN = /@>([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)?)/gu;
const REFERENCE_TOKEN_PATTERN = /@([\p{L}\p{N}_-]+)/gu;
const ROLE_NOTE_COMMAND_PATTERN = /^\/role-note\s+([\p{L}\p{N}_-]+)\s*$/u;
const ROLE_NOTES_COMMAND_PATTERN = /^\/role-notes\s+([\p{L}\p{N}_-]+)\s*$/u;

interface ResolvedRoomRoute {
  hasAssignments: boolean;
  memberIds: MemberId[];
  notices: string[];
}

interface RoleCommandResult {
  handled: boolean;
  notices?: string[];
}

export type RoleStaffingOperation =
  | {
    kind: "add";
    role: string;
    employeeHandle: string;
    reason?: string;
  }
  | {
    kind: "remove";
    role: string;
    employeeHandle: string;
    reason?: string;
  }
  | {
    kind: "rename";
    employeeHandle: string;
    name: string;
  };

export interface RoleStaffingResult {
  ok: boolean;
  notices: string[];
}

function normalizeHandleToken(value: string): string {
  return value.trim().replace(/^[@>]+/u, "").toLowerCase();
}

function getNormalizedRoleLabel(member: Pick<TeamMember, "roleName" | "roleId" | "handle">): string {
  const rawRoleName = typeof member.roleName === "string" ? member.roleName.trim() : "";
  const fallbackRoleName = member.handle.trim().replace(/^@/u, "");
  return normalizeHandleToken(rawRoleName || fallbackRoleName);
}

function getNormalizedRoleId(member: Pick<TeamMember, "roleId" | "handle">): string {
  const rawRoleId = typeof member.roleId === "string" ? member.roleId.trim() : "";
  const fallbackRoleId = member.handle.trim().replace(/^@/u, "");
  return normalizeHandleToken(rawRoleId || fallbackRoleId);
}

function getActiveRoomMembers(snapshot: WorkspaceSnapshot, roomId: RoomId): TeamMember[] {
  const room = snapshot.rooms[roomId];
  if (!room) {
    return [];
  }

  return room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .filter((member): member is TeamMember => Boolean(member) && !member.archivedAt);
}

function resolveMemberByHandle(snapshot: WorkspaceSnapshot, roomId: RoomId, handle: string): TeamMember | undefined {
  const normalizedHandle = normalizeHandleToken(handle);
  return getActiveRoomMembers(snapshot, roomId).find((member) => member.handle.toLowerCase() === normalizedHandle);
}

function resolveMembersByRole(snapshot: WorkspaceSnapshot, roomId: RoomId, role: string): TeamMember[] {
  const normalizedRole = normalizeHandleToken(role);
  return getActiveRoomMembers(snapshot, roomId)
    .filter((member) => getNormalizedRoleLabel(member) === normalizedRole || getNormalizedRoleId(member) === normalizedRole)
    .sort((left, right) => left.handle.localeCompare(right.handle));
}

function resolveRoleOwner(snapshot: WorkspaceSnapshot, roomId: RoomId, role: string): TeamMember | undefined {
  const normalizedRole = normalizeHandleToken(role);
  return getActiveRoomMembers(snapshot, roomId).find(
    (member) =>
      member.isRole === true
      && (member.handle.toLowerCase() === normalizedRole
        || getNormalizedRoleLabel(member) === normalizedRole
        || getNormalizedRoleId(member) === normalizedRole),
  );
}

function humanizeHandle(handle: string): string {
  return normalizeHandleToken(handle)
    .split(/[-_]+/u)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function stripMarkdownCodeSegments(content: string): string {
  let sanitized = "";
  let cursor = 0;

  while (cursor < content.length) {
    if (content[cursor] !== "`") {
      sanitized += content[cursor];
      cursor += 1;
      continue;
    }

    let delimiterLength = 1;
    while (content[cursor + delimiterLength] === "`") {
      delimiterLength += 1;
    }

    const delimiter = "`".repeat(delimiterLength);
    const closingIndex = content.indexOf(delimiter, cursor + delimiterLength);
    if (closingIndex === -1) {
      cursor += delimiterLength;
      continue;
    }

    cursor = closingIndex + delimiterLength;
  }

  return sanitized;
}

function resolveRoleRouting(snapshot: WorkspaceSnapshot, roomId: RoomId, content: string): ResolvedRoomRoute {
  const seenTargets = new Set<string>();
  const memberIds: MemberId[] = [];
  const notices: string[] = [];
  let hasAssignments = false;

  for (const match of content.matchAll(ASSIGNMENT_TOKEN_PATTERN)) {
    const rawTarget = match[1];
    if (!rawTarget) {
      continue;
    }
    hasAssignments = true;

    const normalizedTarget = rawTarget.toLowerCase();
    if (seenTargets.has(normalizedTarget)) {
      continue;
    }
    seenTargets.add(normalizedTarget);

    if (normalizedTarget === "handle") {
      continue;
    }

    const [roleToken, explicitHandle] = rawTarget.split("/", 2);
    const exactMember = explicitHandle ? undefined : resolveMemberByHandle(snapshot, roomId, rawTarget);

    if (exactMember) {
      memberIds.push(exactMember.id);
      continue;
    }

    const roleMembers = resolveMembersByRole(snapshot, roomId, roleToken);
    if (explicitHandle) {
      const explicitMember = resolveMemberByHandle(snapshot, roomId, explicitHandle);
      if (!explicitMember || !roleMembers.some((member) => member.id === explicitMember.id)) {
        notices.push(`岗位路由未执行：@>${rawTarget} 未命中该岗位员工。`);
        continue;
      }

      memberIds.push(explicitMember.id);
      notices.push(`岗位路由已执行：@>${rawTarget} -> ${explicitMember.name}（@${explicitMember.handle}）。`);
      continue;
    }

    if (roleMembers.length === 0) {
      notices.push(`岗位路由未执行：@>${roleToken} 对应岗位当前无人可接。`);
      continue;
    }

    if (roleMembers.length > 1) {
      notices.push(`岗位路由未执行：@>${roleToken} 对应多个活跃员工，请改用 @>${roleToken}/employee-handle。`);
      continue;
    }

    const [member] = roleMembers;
    if (!member) {
      continue;
    }

    memberIds.push(member.id);
    notices.push(`岗位路由已执行：@>${roleToken} -> ${member.name}（@${member.handle}）。`);
  }

  return {
    hasAssignments,
    memberIds: [...new Set(memberIds)],
    notices,
  };
}

function resolveRoleCommand(
  snapshot: WorkspaceSnapshot,
  roomId: RoomId,
  content: string,
): RoleCommandResult {
  const roleNoteMatch = content.match(ROLE_NOTE_COMMAND_PATTERN);
  if (roleNoteMatch) {
    const handle = roleNoteMatch[1];
    const member = handle ? resolveMemberByHandle(snapshot, roomId, handle) : undefined;
    if (!member) {
      return {
        handled: true,
        notices: [`查询岗位备注失败：未找到成员 @${handle}。`],
      };
    }

    return {
      handled: true,
      notices: [
        member.note?.trim()
          ? `查询岗位备注：@${member.handle}（岗位：${member.roleName}）备注：${member.note.trim()}。`
          : `查询岗位备注：@${member.handle}（岗位：${member.roleName}）备注为空。`,
      ],
    };
  }

  const roleNotesMatch = content.match(ROLE_NOTES_COMMAND_PATTERN);
  if (roleNotesMatch) {
    const role = roleNotesMatch[1];
    const members = role ? resolveMembersByRole(snapshot, roomId, role) : [];
    if (members.length === 0) {
      return {
        handled: true,
        notices: [`查询岗位备注失败：未找到岗位 @${role}。`],
      };
    }

    return {
      handled: true,
      notices: [[
        `查询岗位备注：@${normalizeHandleToken(role)} 岗位下共有 ${members.length} 名员工。`,
        ...members.map((member) =>
          member.note?.trim()
            ? `- @${member.handle}（岗位：${member.roleName}）备注：${member.note.trim()}。`
            : `- @${member.handle}（岗位：${member.roleName}）备注为空。`,
        ),
      ].join("\n")],
    };
  }

  return { handled: false };
}

function applyRoleStaffingOperationToSnapshot(
  snapshot: WorkspaceSnapshot,
  roomId: RoomId,
  operation: RoleStaffingOperation,
  actorLabel: string,
  context: MutationContext,
): RoleStaffingResult {
  if (operation.kind === "add") {
    const roleOwner = resolveRoleOwner(snapshot, roomId, operation.role);
    const employeeHandle = normalizeHandleToken(operation.employeeHandle);
    if (!roleOwner) {
      return {
        ok: false,
        notices: [`岗位成员新增失败：未找到岗位 @${normalizeHandleToken(operation.role)}。`],
      };
    }
    if (!employeeHandle) {
      return {
        ok: false,
        notices: ["岗位成员新增失败：员工 handle 不能为空。"],
      };
    }
    if (resolveMemberByHandle(snapshot, roomId, employeeHandle)) {
      return {
        ok: false,
        notices: [`岗位成员新增失败：@${employeeHandle} 已存在。`],
      };
    }

    const room = snapshot.rooms[roomId];
    if (!room) {
      return {
        ok: false,
        notices: ["岗位成员新增失败：未找到房间。"],
      };
    }

    const memberId = context.createId("member");
    snapshot.members[memberId] = {
      ...roleOwner,
      id: memberId,
      blueprintId: roleOwner.blueprintId,
      name: humanizeHandle(employeeHandle),
      handle: employeeHandle,
      isRole: false,
      isEntryMember: false,
      note: undefined,
      status: "idle",
      providerSessionId: undefined,
      activeTaskId: undefined,
      archivedAt: undefined,
    };
    snapshot.rooms[roomId] = {
      ...room,
      memberIds: [...room.memberIds, memberId],
      visibleMemberIds: validateVisibleIds([...(room.visibleMemberIds ?? room.memberIds), memberId], [...room.memberIds, memberId]),
    };

    const reason = operation.reason?.trim();
    return {
      ok: true,
      notices: [
        reason
          ? `@${employeeHandle}（岗位：${roleOwner.roleName}）被 ${actorLabel} 加入群组，原因是：${reason}。`
          : `@${employeeHandle}（岗位：${roleOwner.roleName}）被 ${actorLabel} 加入群组。`,
      ],
    };
  }

  if (operation.kind === "remove") {
    const roleOwner = resolveRoleOwner(snapshot, roomId, operation.role);
    const employee = resolveMemberByHandle(snapshot, roomId, operation.employeeHandle);
    if (!roleOwner) {
      return {
        ok: false,
        notices: [`岗位成员移除失败：未找到岗位 @${normalizeHandleToken(operation.role)}。`],
      };
    }
    if (!employee || employee.roleId !== roleOwner.roleId) {
      return {
        ok: false,
        notices: [`岗位成员移除失败：@${normalizeHandleToken(operation.employeeHandle)} 不在岗位 @${roleOwner.handle} 下。`],
      };
    }
    if (employee.id === roleOwner.id) {
      return {
        ok: false,
        notices: [`岗位成员移除失败：不能直接移除岗位默认成员 @${employee.handle}。`],
      };
    }

    const activeTask = employee.activeTaskId ? snapshot.tasks[employee.activeTaskId] : undefined;
    if (activeTask?.status === "running") {
      return {
        ok: false,
        notices: [`岗位成员移除失败：@${employee.handle} 仍在处理中。`],
      };
    }

    const room = snapshot.rooms[roomId];
    if (!room) {
      return {
        ok: false,
        notices: ["岗位成员移除失败：未找到房间。"],
      };
    }

    snapshot.members[employee.id] = {
      ...employee,
      status: "idle",
      activeTaskId: undefined,
      providerSessionId: undefined,
      archivedAt: context.now(),
    };
    snapshot.rooms[roomId] = {
      ...room,
      memberIds: room.memberIds.filter((memberId) => memberId !== employee.id),
      visibleMemberIds: (room.visibleMemberIds ?? room.memberIds).filter((memberId) => memberId !== employee.id),
      watcherIds: room.watcherIds.filter((watcherId) => snapshot.watchers[watcherId]?.memberId !== employee.id),
    };
    Object.entries(snapshot.watchers).forEach(([watcherId, watcher]) => {
      if (watcher.memberId === employee.id) {
        delete snapshot.watchers[watcherId];
      }
    });

    const reason = operation.reason?.trim();
    return {
      ok: true,
      notices: [
        reason
          ? `@${employee.handle}（岗位：${roleOwner.roleName}）被 ${actorLabel} 移除群组，原因是：${reason}。`
          : `@${employee.handle}（岗位：${roleOwner.roleName}）被 ${actorLabel} 移除群组。`,
      ],
    };
  }

  const member = resolveMemberByHandle(snapshot, roomId, operation.employeeHandle);
  const nextName = operation.name.trim();
  if (!member) {
    return {
      ok: false,
      notices: [`岗位成员更名失败：未找到成员 @${normalizeHandleToken(operation.employeeHandle)}。`],
    };
  }
  if (!nextName) {
    return {
      ok: false,
      notices: ["岗位成员更名失败：名称不能为空。"],
    };
  }

  snapshot.members[member.id] = {
    ...member,
    name: nextName,
  };
  return {
    ok: true,
    notices: [`@${member.handle}（岗位：${member.roleName}）被 ${actorLabel} 更名为 ${nextName}。`],
  };
}

export function executeRoleStaffingOperation(
  current: WorkspaceSnapshot,
  input: {
    roomId: RoomId;
    actorLabel: string;
    operation: RoleStaffingOperation;
  },
  context: MutationContext,
): { snapshot: WorkspaceSnapshot; result: RoleStaffingResult } {
  const snapshot = cloneSnapshot(current);
  const room = snapshot.rooms[input.roomId];

  if (!room) {
    throw new Error(`Unknown room "${input.roomId}"`);
  }

  const now = context.now();
  const result = applyRoleStaffingOperationToSnapshot(
    snapshot,
    input.roomId,
    input.operation,
    input.actorLabel,
    context,
  );
  result.notices.forEach((notice) => {
    insertSystemRoomMessage(snapshot, {
      roomId: input.roomId,
      content: notice,
      createdAt: now,
      createId: context.createId,
    });
  });
  snapshot.selection.roomId = room.id;
  snapshot.selection.projectId = room.projectId;

  return {
    snapshot,
    result,
  };
}

export function applyRoleStaffingOperation(
  current: WorkspaceSnapshot,
  input: {
    roomId: RoomId;
    actorLabel: string;
    operation: RoleStaffingOperation;
  },
  context: MutationContext,
): WorkspaceSnapshot {
  return executeRoleStaffingOperation(current, input, context).snapshot;
}

function updateMember(snapshot: WorkspaceSnapshot, member: TeamMember): void {
  snapshot.members[member.id] = member;
}

function updateTask(snapshot: WorkspaceSnapshot, task: MemberTask): void {
  snapshot.tasks[task.id] = task;
}

function insertTaskTrace(snapshot: WorkspaceSnapshot, trace: TaskTraceEntry): void {
  snapshot.taskTraces[trace.id] = trace;
  snapshot.taskTraceOrderByTask[trace.taskId] ??= [];
  snapshot.taskTraceOrderByTask[trace.taskId].push(trace.id);
}

function findLatestTaskTrace(
  snapshot: WorkspaceSnapshot,
  taskId: TaskId,
  predicate: (trace: TaskTraceEntry) => boolean,
): TaskTraceEntry | undefined {
  const traceIds = snapshot.taskTraceOrderByTask[taskId] ?? [];

  for (let index = traceIds.length - 1; index >= 0; index -= 1) {
    const traceId = traceIds[index];
    if (!traceId) {
      continue;
    }
    const trace = snapshot.taskTraces[traceId];
    if (trace && predicate(trace)) {
      return trace;
    }
  }

  return undefined;
}

function findLatestTaskTraceEntry(snapshot: WorkspaceSnapshot, taskId: TaskId): TaskTraceEntry | undefined {
  const traceIds = snapshot.taskTraceOrderByTask[taskId] ?? [];

  for (let index = traceIds.length - 1; index >= 0; index -= 1) {
    const currentTraceId = traceIds[index];
    if (!currentTraceId) {
      continue;
    }
    return snapshot.taskTraces[currentTraceId];
  }

  return undefined;
}

function findBlueprint(template: TeamTemplate, predicate: (member: TeamMemberBlueprint) => boolean): TeamMemberBlueprint {
  const match = template.members.find(predicate);

  if (!match) {
    throw new Error(`Template "${template.id}" is missing a required member blueprint`);
  }

  return match;
}

function deriveRoomName(content: string): string {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return "Untitled Thread";
  }

  if (/[\u4e00-\u9fff]/u.test(trimmed) && !trimmed.includes(" ")) {
    return trimmed.slice(0, 12);
  }

  const sanitized = trimmed.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
  const words = sanitized.split(" ").slice(0, 4);

  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function shouldInitializeRoomFromFirstMessage(snapshot: WorkspaceSnapshot, room: Room): boolean {
  const messageCount = snapshot.messageOrderByRoom[room.id]?.length ?? 0;
  return messageCount === 0 && room.topic.trim().length === 0;
}

function deriveRoomTitlesFromFirstMessage(content: string): Pick<Room, "name" | "topic"> {
  const trimmed = content.trim();
  return {
    name: deriveRoomName(trimmed),
    topic: trimmed,
  };
}

function buildTaskTitle(message: ChatMessage): string {
  if (message.transport === "watch-digest") {
    return "Review watcher digest";
  }

  if (message.transport === "direct") {
    return "Respond to direct message";
  }

  if (message.author.kind === "user") {
    return "Respond to user";
  }

  return "Handle teammate mention";
}

function markTaskInterrupted(
  snapshot: WorkspaceSnapshot,
  member: TeamMember,
  interruptingMessageId: MessageId,
  now: string,
  createId: MutationContext["createId"],
): void {
  if (!member.activeTaskId) {
    return;
  }

  const existingTask = snapshot.tasks[member.activeTaskId];

  if (!existingTask || existingTask.status !== "running") {
    return;
  }

  const interruptedTask: MemberTask = {
    ...existingTask,
    status: "interrupted",
    updatedAt: now,
    interruptedByMessageId: interruptingMessageId,
  };

  updateTask(snapshot, interruptedTask);
  insertTaskTrace(snapshot, {
    id: createId("trace"),
    taskId: interruptedTask.id,
    roomId: interruptedTask.roomId,
    memberId: interruptedTask.memberId,
    kind: "interrupted",
    title: "Task interrupted",
    content: snapshot.messages[interruptingMessageId]?.content ?? interruptingMessageId,
    createdAt: now,
  });

  if (existingTask.draftMessageId) {
    const draft = snapshot.messages[existingTask.draftMessageId];
    if (draft?.visibility === "internal") {
      snapshot.messages[existingTask.draftMessageId] = {
        ...draft,
        status: "interrupted",
      };
    }
  }
}

function startTaskForMember(
  snapshot: WorkspaceSnapshot,
  room: Room,
  member: TeamMember,
  sourceMessageId: MessageId,
  now: string,
  createId: MutationContext["createId"],
): void {
  markTaskInterrupted(snapshot, member, sourceMessageId, now, createId);

  const taskId = createId("task");
  const sourceMessage = snapshot.messages[sourceMessageId];
  const nextTask: MemberTask = {
    id: taskId,
    roomId: room.id,
    memberId: member.id,
    sourceMessageId,
    title: buildTaskTitle(sourceMessage),
    status: "running",
    startedAt: now,
    updatedAt: now,
  };

  const nextMember: TeamMember = {
    ...member,
    status: snapshot.members[member.id].activeTaskId ? "interrupted" : "running",
    activeTaskId: taskId,
  };

  updateTask(snapshot, nextTask);
  updateMember(snapshot, { ...nextMember, status: "running" });
  insertTaskTrace(snapshot, {
    id: createId("trace"),
    taskId,
    roomId: room.id,
    memberId: member.id,
    kind: "task-started",
    title: nextTask.title,
    content: `${sourceMessage.author.label}: ${sourceMessage.content}`,
    createdAt: now,
  });
}

function resolveRecipients(snapshot: WorkspaceSnapshot, message: ChatMessage, routing?: ResolvedRoomRoute): MemberId[] {
  const room = snapshot.rooms[message.roomId];

  if (!room) {
    return [];
  }

  if (message.transport === "direct" || message.transport === "watch-digest") {
    return [...new Set(message.recipientMemberIds)].filter((memberId) => {
      if (message.transport === "watch-digest") {
        return room.memberIds.includes(memberId);
      }

      return snapshot.members[memberId]?.acceptsDirectMessages !== false;
    });
  }

  const resolvedRouting = routing ?? resolveRoleRouting(snapshot, message.roomId, message.content);
  const addressedMemberIds = resolvedRouting.memberIds;
  if (message.author.kind === "user") {
    return addressedMemberIds.length > 0 || resolvedRouting.hasAssignments ? addressedMemberIds : [room.entryMemberId];
  }

  return addressedMemberIds;
}

function routeMessage(snapshot: WorkspaceSnapshot, message: ChatMessage, now: string, createId: MutationContext["createId"]): void {
  const room = snapshot.rooms[message.roomId];

  if (!room) {
    return;
  }

  if (message.transport === "group") {
    const routing = resolveRoleRouting(snapshot, message.roomId, message.content);
    routing.notices.forEach((notice) => {
      insertSystemRoomMessage(snapshot, {
        roomId: message.roomId,
        content: notice,
        createdAt: now,
        createId,
      });
    });
    const recipients = resolveRecipients(snapshot, message, routing);
    recipients.forEach((memberId) => {
      const member = snapshot.members[memberId];
      if (!member) {
        return;
      }
      startTaskForMember(snapshot, room, member, message.id, now, createId);
    });
    return;
  }

  const recipients = resolveRecipients(snapshot, message);
  recipients.forEach((memberId) => {
    const member = snapshot.members[memberId];
    if (!member) {
      return;
    }
    startTaskForMember(snapshot, room, member, message.id, now, createId);
  });
}

function instantiateMember(
  roomId: string,
  blueprint: TeamMemberBlueprint,
  createId: MutationContext["createId"],
): TeamMember {
  return {
    id: createId("member"),
    roomId,
    blueprintId: blueprint.id,
    roleId: blueprint.id,
    roleName: blueprint.handle,
    name: blueprint.name,
    handle: blueprint.handle,
    isRole: blueprint.isRole === true,
    summary: blueprint.summary,
    prompt: blueprint.prompt,
    accentTone: blueprint.accentTone,
    modelProfileId: blueprint.modelProfileId,
    modelId: blueprint.modelId,
    allowedSkillIds: blueprint.allowedSkillIds,
    provider: blueprint.provider,
    acceptsDirectMessages: blueprint.acceptsDirectMessages ?? true,
    isEntryMember: blueprint.isEntryMember ?? false,
    codexThinkingDepth: blueprint.codexThinkingDepth,
    providerSessionId: undefined,
    status: "idle",
  };
}

function instantiateWatcher(
  roomId: string,
  memberId: string,
  blueprint: TeamMemberBlueprint,
  createId: MutationContext["createId"],
): WatchSubscription | undefined {
  if (!blueprint.watch) {
    return undefined;
  }

  return {
    id: createId("watcher"),
    roomId,
    memberId,
    intervalMinutes: blueprint.watch.intervalMinutes,
    enabled: blueprint.watch.enabledByDefault,
    persistent: blueprint.watch.persistent ?? false,
    prompt: blueprint.watch.prompt,
    pausedUntilActivity: false,
  };
}

function buildRoomTeamFields(template: TeamTemplate): Pick<Room, "teamName" | "teamDescription" | "teamAccentTone"> {
  return {
    teamName: template.name,
    teamDescription: template.description,
    teamAccentTone: template.accentTone,
  };
}

export function createWorkspaceSnapshot(templates: TeamTemplate[], currentUserName = "You"): WorkspaceSnapshot {
  return {
    projects: {},
    projectOrder: [],
    rooms: {},
    roomOrderByProject: {},
    templates: Object.fromEntries(templates.map((template) => [template.id, template])),
    templateOrder: templates.map((template) => template.id),
    members: {},
    messages: {},
    messageOrderByRoom: {},
    tasks: {},
    taskTraces: {},
    taskTraceOrderByTask: {},
    watchers: {},
    selection: {},
    currentUserName,
  };
}

export function createProjectWithRoom(
  current: WorkspaceSnapshot,
  input: CreateProjectInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const now = context.now();
  const projectId = context.createId("project");

  snapshot.projects[projectId] = {
    id: projectId,
    name: input.projectName.trim(),
    path: input.path?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  snapshot.projectOrder.push(projectId);
  snapshot.roomOrderByProject[projectId] = [];

  return createRoomInProject(
    snapshot,
    {
      projectId,
      templateId: input.templateId,
    },
    context,
  );
}

export function createRoomInProject(
  current: WorkspaceSnapshot,
  input: CreateRoomInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const template = snapshot.templates[input.templateId];
  const project = snapshot.projects[input.projectId];

  if (!project) {
    throw new Error(`Unknown project "${input.projectId}"`);
  }
  if (!template) {
    throw new Error(`Unknown template "${input.templateId}"`);
  }

  const now = context.now();
  const roomId = context.createId("room");
  const roomMembers = template.members.map((blueprint) => instantiateMember(roomId, blueprint, context.createId));
  const memberIdByBlueprint = Object.fromEntries(roomMembers.map((member) => [member.blueprintId, member.id]));
  const defaultVisibleBlueprintIds = new Set(resolveTemplateVisibleMemberBlueprintIds(template));
  const entryBlueprint = findBlueprint(template, (member) => member.isEntryMember === true);
  const watcherIds = template.members
    .map((blueprint) => instantiateWatcher(roomId, memberIdByBlueprint[blueprint.id], blueprint, context.createId))
    .filter((watcher): watcher is WatchSubscription => watcher !== undefined);

  snapshot.roomOrderByProject[input.projectId] = [...(snapshot.roomOrderByProject[input.projectId] ?? []), roomId];
  snapshot.rooms[roomId] = {
    id: roomId,
    projectId: input.projectId,
    name: "New room",
    topic: "",
    templateId: template.id,
    ...buildRoomTeamFields(template),
    memberIds: roomMembers.map((member) => member.id),
    watcherIds: watcherIds.map((watcher) => watcher.id),
    entryMemberId: memberIdByBlueprint[entryBlueprint.id],
    createdAt: now,
    updatedAt: now,
    visibleMemberIds: roomMembers
      .filter((member) => defaultVisibleBlueprintIds.has(member.blueprintId))
      .map((member) => member.id),
    lastReadMemberMessageAt: now,
    unreadMemberMessageCount: 0,
  };
  snapshot.messageOrderByRoom[roomId] = [];
  roomMembers.forEach((member) => {
    snapshot.members[member.id] = member;
  });
  watcherIds.forEach((watcher) => {
    snapshot.watchers[watcher.id] = watcher;
  });
  snapshot.selection = {
    projectId: input.projectId,
    roomId,
    memberId: memberIdByBlueprint[entryBlueprint.id],
  };
  snapshot.projects[input.projectId] = {
    ...project,
    updatedAt: now,
  };
  return snapshot;
}

function resolveSelection(snapshot: WorkspaceSnapshot, preferredProjectId?: ProjectId): WorkspaceSnapshot["selection"] {
  const projectId =
    (preferredProjectId && snapshot.projects[preferredProjectId] ? preferredProjectId : undefined)
    ?? (snapshot.selection.projectId && snapshot.projects[snapshot.selection.projectId] ? snapshot.selection.projectId : undefined)
    ?? snapshot.projectOrder[0];
  const roomIds = projectId ? snapshot.roomOrderByProject[projectId] ?? [] : [];
  const roomId =
    (snapshot.selection.roomId && roomIds.includes(snapshot.selection.roomId) ? snapshot.selection.roomId : undefined)
    ?? roomIds[0];
  const room = roomId ? snapshot.rooms[roomId] : undefined;
  const memberId = room
    ? ((snapshot.selection.memberId && room.memberIds.includes(snapshot.selection.memberId)) ? snapshot.selection.memberId : room.entryMemberId)
    : undefined;

  return {
    projectId,
    roomId,
    memberId,
  };
}

function removeRoomArtifacts(snapshot: WorkspaceSnapshot, roomId: RoomId): void {
  const room = snapshot.rooms[roomId];
  if (!room) {
    return;
  }

  (snapshot.messageOrderByRoom[roomId] ?? []).forEach((messageId) => {
    delete snapshot.messages[messageId];
  });
  delete snapshot.messageOrderByRoom[roomId];

  Object.values(snapshot.tasks)
    .filter((task) => task.roomId === roomId)
    .forEach((task) => {
      (snapshot.taskTraceOrderByTask[task.id] ?? []).forEach((traceId) => {
        delete snapshot.taskTraces[traceId];
      });
      delete snapshot.taskTraceOrderByTask[task.id];
      delete snapshot.tasks[task.id];
    });

  Object.values(snapshot.watchers)
    .filter((watcher) => watcher.roomId === roomId)
    .forEach((watcher) => {
      delete snapshot.watchers[watcher.id];
    });
  Object.values(snapshot.members)
    .filter((member) => member.roomId === roomId)
    .forEach((member) => {
      delete snapshot.members[member.id];
    });
  delete snapshot.rooms[roomId];
}

export function deleteRoom(current: WorkspaceSnapshot, roomId: RoomId): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const room = snapshot.rooms[roomId];

  if (!room) {
    throw new Error(`Unknown room "${roomId}"`);
  }

  removeRoomArtifacts(snapshot, roomId);
  snapshot.roomOrderByProject[room.projectId] = (snapshot.roomOrderByProject[room.projectId] ?? []).filter((candidate) => candidate !== roomId);
  snapshot.selection = resolveSelection(snapshot, room.projectId);

  return snapshot;
}

export function deleteProject(current: WorkspaceSnapshot, projectId: ProjectId): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);

  if (!snapshot.projects[projectId]) {
    throw new Error(`Unknown project "${projectId}"`);
  }

  const roomIds = [...(snapshot.roomOrderByProject[projectId] ?? [])];
  roomIds.forEach((roomId) => {
    removeRoomArtifacts(snapshot, roomId);
  });
  delete snapshot.roomOrderByProject[projectId];
  delete snapshot.projects[projectId];
  snapshot.projectOrder = snapshot.projectOrder.filter((candidate) => candidate !== projectId);
  snapshot.selection = resolveSelection(snapshot);

  return snapshot;
}

export function deleteTemplate(current: WorkspaceSnapshot, templateId: TemplateId): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);

  if (!snapshot.templates[templateId]) {
    throw new Error(`Unknown template "${templateId}"`);
  }

  if (snapshot.templateOrder.length <= 1) {
    throw new Error("At least one team template must remain.");
  }

  delete snapshot.templates[templateId];
  snapshot.templateOrder = snapshot.templateOrder.filter((candidate) => candidate !== templateId);

  return snapshot;
}

export function postUserMessage(
  current: WorkspaceSnapshot,
  input: PostUserMessageInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const room = snapshot.rooms[input.roomId];

  if (!room) {
    throw new Error(`Unknown room "${input.roomId}"`);
  }

  const now = context.now();
  const trimmedContent = input.content.trim();

  if (shouldInitializeRoomFromFirstMessage(snapshot, room)) {
    snapshot.rooms[room.id] = {
      ...room,
      ...deriveRoomTitlesFromFirstMessage(trimmedContent),
    };
  }

  const message: ChatMessage = {
    id: context.createId("message"),
    roomId: input.roomId,
    author: buildUserAuthor(snapshot.currentUserName),
    content: trimmedContent,
    createdAt: now,
    transport: input.directMemberId ? "direct" : "group",
    status: "sent",
    visibility: "public",
    mentionedMemberIds: input.mentionedMemberIds ?? extractMentionMemberIds(snapshot, input.roomId, trimmedContent),
    quotedMemberIds: input.quotedMemberIds ?? extractQuotedMemberIds(snapshot, input.roomId, trimmedContent),
    recipientMemberIds: input.directMemberId ? [input.directMemberId] : [],
  };

  insertMessage(snapshot, message);
  setRoomReadState(snapshot, room.id, now);
  touchRoomActivity(snapshot, room.id, now);
  const roleCommand = !input.directMemberId
    ? resolveRoleCommand(snapshot, input.roomId, trimmedContent)
    : { handled: false };
  if (roleCommand.handled) {
    roleCommand.notices?.forEach((notice) => {
      insertSystemRoomMessage(snapshot, {
        roomId: room.id,
        content: notice,
        createdAt: now,
        createId: context.createId,
      });
    });
    snapshot.selection.roomId = room.id;
    snapshot.selection.projectId = room.projectId;
    return snapshot;
  }
  routeMessage(snapshot, message, now, context.createId);
  snapshot.selection.roomId = room.id;
  snapshot.selection.projectId = room.projectId;
  snapshot.selection.memberId = resolveRecipients(snapshot, message)[0] ?? snapshot.selection.memberId;

  return snapshot;
}

export function postMemberMessage(
  current: WorkspaceSnapshot,
  input: PostMemberMessageInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const member = snapshot.members[input.memberId];

  if (!member) {
    throw new Error(`Unknown member "${input.memberId}"`);
  }

  const now = context.now();
  const isDirectMessage = Boolean(input.directMemberId || input.directToUser);
  const content = input.content.trim();
  const recipientMemberIds = input.directMemberId ? [input.directMemberId] : [];

  const message: ChatMessage = {
    id: context.createId("message"),
    roomId: input.roomId,
    author: buildMemberAuthor(member),
    content,
    createdAt: now,
    transport: isDirectMessage ? "direct" : "group",
    status: "completed",
    visibility: "public",
    mentionedMemberIds: isDirectMessage ? [] : input.mentionedMemberIds ?? extractMentionMemberIds(snapshot, input.roomId, content),
    quotedMemberIds: isDirectMessage ? [] : input.quotedMemberIds ?? extractQuotedMemberIds(snapshot, input.roomId, content),
    recipientMemberIds,
    recipientUser: input.directToUser ? true : undefined,
    taskId: input.taskId,
  };

  insertMessage(snapshot, message);
  if (input.taskId) {
    const task = snapshot.tasks[input.taskId];
    if (task) {
      updateTask(snapshot, {
        ...task,
        draftMessageId: message.id,
        updatedAt: now,
      });
    }
  }
  const roleCommand = !isDirectMessage
    ? resolveRoleCommand(snapshot, input.roomId, content)
    : { handled: false };
  if (roleCommand.handled) {
    roleCommand.notices?.forEach((notice) => {
      insertSystemRoomMessage(snapshot, {
        roomId: input.roomId,
        content: notice,
        createdAt: now,
        createId: context.createId,
      });
    });
    return snapshot;
  }
  routeMessage(snapshot, message, now, context.createId);

  return snapshot;
}

export function postMemberDraft(
  current: WorkspaceSnapshot,
  input: PostMemberDraftInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const task = snapshot.tasks[input.taskId];

  if (!task) {
    throw new Error(`Unknown task "${input.taskId}"`);
  }

  const member = snapshot.members[task.memberId];
  const now = context.now();
  updateTask(snapshot, {
    ...task,
    updatedAt: now,
  });
  updateMember(snapshot, {
    ...member,
    status: "running",
    activeTaskId: task.id,
  });

  return snapshot;
}

export function completeMemberTask(
  current: WorkspaceSnapshot,
  input: CompleteTaskInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const task = snapshot.tasks[input.taskId];

  if (!task) {
    throw new Error(`Unknown task "${input.taskId}"`);
  }

  const member = snapshot.members[task.memberId];
  const now = context.now();
  let publishedMessageId = task.draftMessageId;

  if (input.publishResult && input.finalContent) {
    const messageId = context.createId("message");
    const completedMessage: ChatMessage = {
      id: messageId,
      roomId: task.roomId,
      author: buildMemberAuthor(member),
      content: input.finalContent.trim(),
      createdAt: now,
      transport: "group",
      status: "completed",
      visibility: "public",
      mentionedMemberIds: extractMentionMemberIds(snapshot, task.roomId, input.finalContent),
      quotedMemberIds: extractQuotedMemberIds(snapshot, task.roomId, input.finalContent),
      recipientMemberIds: [],
      taskId: task.id,
    };
    insertMessage(snapshot, completedMessage);
    routeMessage(snapshot, completedMessage, now, context.createId);
    publishedMessageId = messageId;
  }

  updateTask(snapshot, {
    ...task,
    draftMessageId: publishedMessageId,
    status: "completed",
    updatedAt: now,
  });
  updateMember(snapshot, {
    ...member,
    status: "idle",
    activeTaskId: member.activeTaskId === task.id ? undefined : member.activeTaskId,
  });

  return snapshot;
}

export function updateMemberPrompt(current: WorkspaceSnapshot, memberId: MemberId, prompt: string): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const { member } = resolveActiveRoomMember(snapshot, memberId);

  snapshot.members[memberId] = {
    ...member,
    prompt,
  };

  return snapshot;
}

function validateProviderCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((capability) => capability.trim()).filter(Boolean))];
}

function validateAllowedSkillIds(skillIds: string[]): string[] {
  return normalizeAllowedSkillIds(skillIds);
}

function normalizeProviderBinding(provider: ProviderBinding): ProviderBinding {
  if (!provider.label.trim() || !provider.command.trim()) {
    throw new Error("Provider label and command are required");
  }

  return {
    ...provider,
    label: provider.label.trim(),
    command: provider.command.trim(),
    args: provider.args.map((arg) => arg.trim()).filter(Boolean),
    capabilities: validateProviderCapabilities(provider.capabilities),
  };
}

function validateAccentTone(accentTone: AccentTone): AccentTone {
  return accentTone;
}

function resolveActiveRoomMember(
  snapshot: WorkspaceSnapshot,
  memberId: MemberId,
): { member: TeamMember; room: Room } {
  const member = snapshot.members[memberId];

  if (!member) {
    throw new Error(`Unknown member "${memberId}"`);
  }

  const room = snapshot.rooms[member.roomId];
  if (!room || member.archivedAt || !room.memberIds.includes(memberId)) {
    throw new Error(`Member "${memberId}" is no longer active in its room`);
  }

  return {
    member,
    room,
  };
}

function validateTemplateMembers(members: TeamMemberBlueprint[]): TeamMemberBlueprint[] {
  if (members.length === 0) {
    throw new Error("A template requires at least one member");
  }

  const normalizedMembers = members.map((member) => {
    if (!member.id.trim() || !member.name.trim() || !member.handle.trim()) {
      throw new Error("Each template member requires an id, name, and handle");
    }

    const watch = member.watch
      ? {
          intervalMinutes: Math.round(member.watch.intervalMinutes),
          enabledByDefault: member.watch.enabledByDefault,
          persistent: member.watch.persistent ?? false,
          prompt: member.watch.prompt?.trim() || undefined,
        }
      : undefined;

    if (watch && (!Number.isFinite(watch.intervalMinutes) || watch.intervalMinutes <= 0)) {
      throw new Error(`Watcher interval for @${member.handle} must be a positive number`);
    }
    if (member.isRole === true && watch) {
      throw new Error(`Role member @${member.handle} cannot enable Watch`);
    }

    return {
      ...member,
      id: member.id.trim(),
      name: member.name.trim(),
      handle: member.handle.trim().replace(/^@/u, ""),
      isRole: member.isRole === true,
      summary: member.summary.trim(),
      prompt: member.prompt.trim(),
      accentTone: validateAccentTone(member.accentTone),
      modelProfileId: member.modelProfileId?.trim() || undefined,
      modelId: member.modelId?.trim() || undefined,
      codexThinkingDepth: member.codexThinkingDepth,
      allowedSkillIds: validateAllowedSkillIds(member.allowedSkillIds),
      provider: normalizeProviderBinding(member.provider),
      watch,
    };
  });

  const entryMembers = normalizedMembers.filter((member) => member.isEntryMember === true);
  if (entryMembers.length !== 1) {
    throw new Error("A template must define exactly one entry member");
  }

  const seenIds = new Set<string>();
  const seenHandles = new Set<string>();
  normalizedMembers.forEach((member) => {
    if (seenIds.has(member.id)) {
      throw new Error(`Duplicate template member id "${member.id}"`);
    }
    if (seenHandles.has(member.handle)) {
      throw new Error(`Duplicate template member handle "${member.handle}"`);
    }
    seenIds.add(member.id);
    seenHandles.add(member.handle);
  });

  return normalizedMembers;
}

interface NormalizedRoomTeamMemberInput extends Omit<RoomTeamMemberInput, "watch"> {
  watch?: {
    enabled: boolean;
    intervalMinutes: number;
    persistent: boolean;
    prompt?: string;
  };
}

function validateRoomTeamMembers(members: RoomTeamMemberInput[]): NormalizedRoomTeamMemberInput[] {
  if (members.length === 0) {
    throw new Error("A room team requires at least one member");
  }

  const normalizedMembers = members.map((member) => {
    if (!member.memberId.trim() || !member.name.trim() || !member.handle.trim()) {
      throw new Error("Each room member requires an id, name, and handle");
    }

    const watch = member.watch
      ? {
          enabled: member.watch.enabled,
          intervalMinutes: Math.round(member.watch.intervalMinutes),
          persistent: member.watch.persistent ?? false,
          prompt: member.watch.prompt?.trim() || undefined,
        }
      : undefined;

    if (watch && (!Number.isFinite(watch.intervalMinutes) || watch.intervalMinutes <= 0)) {
      throw new Error(`Watcher interval for @${member.handle} must be a positive number`);
    }

    return {
      ...member,
      memberId: member.memberId.trim(),
      roleId: member.roleId?.trim() || member.memberId.trim(),
      roleName: member.roleName?.trim() || member.handle.trim().replace(/^@/u, ""),
      name: member.name.trim(),
      handle: member.handle.trim().replace(/^@/u, ""),
      isRole: member.isRole === true,
      summary: member.summary.trim(),
      note: member.note?.trim() || undefined,
      prompt: member.prompt.trim(),
      accentTone: validateAccentTone(member.accentTone),
      modelProfileId: member.modelProfileId?.trim() || undefined,
      modelId: member.modelId?.trim() || undefined,
      codexThinkingDepth: member.codexThinkingDepth,
      allowedSkillIds: validateAllowedSkillIds(member.allowedSkillIds),
      provider: normalizeProviderBinding(member.provider),
      watch,
    };
  });

  const entryMembers = normalizedMembers.filter((member) => member.isEntryMember === true);
  if (entryMembers.length !== 1) {
    throw new Error("A room team must define exactly one entry member");
  }

  const seenIds = new Set<string>();
  const seenHandles = new Set<string>();
  normalizedMembers.forEach((member) => {
    if (seenIds.has(member.memberId)) {
      throw new Error(`Duplicate room member id "${member.memberId}"`);
    }
    if (seenHandles.has(member.handle)) {
      throw new Error(`Duplicate room member handle "${member.handle}"`);
    }
    seenIds.add(member.memberId);
    seenHandles.add(member.handle);
  });

  return normalizedMembers;
}

export function updateMemberConfig(current: WorkspaceSnapshot, input: UpdateMemberConfigInput): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const { member, room } = resolveActiveRoomMember(snapshot, input.memberId);

  if (input.isRole === false) {
    const hasRoleEmployees = getActiveRoomMembers(snapshot, room.id).some(
      (candidate) => candidate.id !== member.id && candidate.roleId === member.roleId,
    );
    if (member.isRole && hasRoleEmployees) {
      throw new Error("Remove role employees before turning Role off.");
    }
  }

  snapshot.members[input.memberId] = {
    ...member,
    isRole: input.isRole === true,
    summary: input.summary.trim(),
    prompt: input.prompt.trim(),
    modelProfileId: input.modelProfileId?.trim() || undefined,
    modelId: input.modelId?.trim() || undefined,
    acceptsDirectMessages: input.acceptsDirectMessages,
    codexThinkingDepth: input.codexThinkingDepth,
    allowedSkillIds: validateAllowedSkillIds(input.allowedSkillIds),
    provider: member.provider,
  };

  if (input.isRole === true) {
    room.watcherIds
      .filter((watcherId) => snapshot.watchers[watcherId]?.memberId === member.id)
      .forEach((watcherId) => {
        delete snapshot.watchers[watcherId];
      });
    snapshot.rooms[room.id] = {
      ...room,
      watcherIds: room.watcherIds.filter((watcherId) => snapshot.watchers[watcherId]),
    };
  }

  return snapshot;
}

export function updateTemplate(current: WorkspaceSnapshot, input: UpdateTemplateInput): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const template = snapshot.templates[input.templateId];

  if (!template) {
    throw new Error(`Unknown template "${input.templateId}"`);
  }

  if (!input.name.trim()) {
    throw new Error("Template name is required");
  }

  snapshot.templates[input.templateId] = {
    ...template,
    name: input.name.trim(),
    description: input.description.trim(),
    accentTone: validateAccentTone(input.accentTone),
    members: validateTemplateMembers(input.members),
    defaultVisibleMemberBlueprintIds: validateVisibleIds(
      input.defaultVisibleMemberBlueprintIds ?? resolveTemplateVisibleMemberBlueprintIds(template),
      input.members.map((member) => member.id),
    ),
  };

  return snapshot;
}

function validateVisibleIds(visibleIds: string[], allowedIds: string[]): string[] {
  const allowedIdSet = new Set(allowedIds);
  return [...new Set(visibleIds.filter((id) => allowedIdSet.has(id)))];
}

export function acknowledgeRoom(
  current: WorkspaceSnapshot,
  roomId: RoomId,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const room = snapshot.rooms[roomId];

  if (!room) {
    throw new Error(`Unknown room "${roomId}"`);
  }

  setRoomReadState(snapshot, roomId, context.now());
  return snapshot;
}

export function updateRoomSettings(
  current: WorkspaceSnapshot,
  input: UpdateRoomSettingsInput,
  context: MutationContext,
  options?: { markAsRead?: boolean },
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const room = snapshot.rooms[input.roomId];

  if (!room) {
    throw new Error(`Unknown room "${input.roomId}"`);
  }

  snapshot.rooms[input.roomId] = {
    ...room,
    visibleMemberIds: validateVisibleIds(input.visibleMemberIds, room.memberIds),
  };

  if (options?.markAsRead) {
    setRoomReadState(snapshot, input.roomId, context.now());
    return snapshot;
  }

  recalculateRoomUnreadCount(snapshot, input.roomId);
  return snapshot;
}

export function syncUnreadStateForMessage(
  current: WorkspaceSnapshot,
  messageId: MessageId,
  activeRoomId?: RoomId,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const message = snapshot.messages[messageId];

  if (!message || message.author.kind !== "member") {
    return snapshot;
  }

  const room = snapshot.rooms[message.roomId];
  if (!room) {
    return snapshot;
  }

  const visibleMemberIds = resolveRoomVisibleMemberIdSet(snapshot, room, snapshot.templates[room.templateId]);

  if (activeRoomId && activeRoomId === room.id && isVisibleMainRoomMessage(message, visibleMemberIds)) {
    setRoomReadState(snapshot, room.id, message.createdAt);
    return snapshot;
  }

  if (!isVisibleMainRoomMessage(message, visibleMemberIds)) {
    return snapshot;
  }

  snapshot.rooms[room.id] = {
    ...room,
    unreadMemberMessageCount: (room.unreadMemberMessageCount ?? 0) + 1,
  };

  return snapshot;
}

export function updateRoomTeam(
  current: WorkspaceSnapshot,
  input: UpdateRoomTeamInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const room = snapshot.rooms[input.roomId];

  if (!room) {
    throw new Error(`Unknown room "${input.roomId}"`);
  }

  if (!input.teamName.trim()) {
    throw new Error("Room team name is required");
  }

  const normalizedMembers = validateRoomTeamMembers(input.members);
  const activeMemberIds = new Set(room.memberIds);
  const previousVisibleMemberIds = new Set(resolveRoomVisibleMemberIds(snapshot, room, snapshot.templates[room.templateId]));
  const nextMemberIds: MemberId[] = [];
  const nextVisibleMemberIds: MemberId[] = [];
  const nextWatcherIds: string[] = [];
  const now = context.now();
  const addedMembers: Array<{ name: string; note?: string }> = [];
  const removedMembers: Array<{ name: string }> = [];

  normalizedMembers.forEach((memberInput) => {
    const existingMember = activeMemberIds.has(memberInput.memberId) ? snapshot.members[memberInput.memberId] : undefined;
    const nextMemberId = existingMember?.id ?? context.createId("member");

    snapshot.members[nextMemberId] = existingMember
      ? {
          ...existingMember,
          roleId: memberInput.roleId ?? existingMember.roleId,
          roleName: memberInput.roleName ?? existingMember.roleName,
          isRole: memberInput.isRole === true,
          name: memberInput.name,
          handle: memberInput.handle,
          summary: memberInput.summary,
          note: memberInput.note,
          prompt: memberInput.prompt,
          accentTone: memberInput.accentTone,
          modelProfileId: memberInput.modelProfileId,
          modelId: memberInput.modelId,
          allowedSkillIds: memberInput.allowedSkillIds,
          provider: memberInput.provider,
          acceptsDirectMessages: memberInput.acceptsDirectMessages ?? true,
          isEntryMember: memberInput.isEntryMember === true,
          codexThinkingDepth: memberInput.codexThinkingDepth,
          archivedAt: undefined,
        }
      : {
          id: nextMemberId,
          roomId: room.id,
          blueprintId: memberInput.memberId,
          roleId: memberInput.roleId ?? memberInput.memberId,
          roleName: memberInput.roleName ?? memberInput.handle,
          isRole: memberInput.isRole === true,
          name: memberInput.name,
          handle: memberInput.handle,
          summary: memberInput.summary,
          note: memberInput.note,
          prompt: memberInput.prompt,
          accentTone: memberInput.accentTone,
          modelProfileId: memberInput.modelProfileId,
          modelId: memberInput.modelId,
          allowedSkillIds: memberInput.allowedSkillIds,
          provider: memberInput.provider,
          acceptsDirectMessages: memberInput.acceptsDirectMessages ?? true,
          isEntryMember: memberInput.isEntryMember === true,
          codexThinkingDepth: memberInput.codexThinkingDepth,
          status: "idle",
          providerSessionId: undefined,
          activeTaskId: undefined,
          archivedAt: undefined,
        };
    if (!existingMember) {
      addedMembers.push({
        name: memberInput.name,
        note: memberInput.note,
      });
    }

    nextMemberIds.push(nextMemberId);
    if (!existingMember || previousVisibleMemberIds.has(existingMember.id)) {
      nextVisibleMemberIds.push(nextMemberId);
    }

    const existingWatcherId = room.watcherIds.find((watcherId) => snapshot.watchers[watcherId]?.memberId === existingMember?.id);
    if (!memberInput.watch) {
      if (existingWatcherId) {
        delete snapshot.watchers[existingWatcherId];
      }
      return;
    }

    const watcherId = existingWatcherId ?? context.createId("watcher");
    snapshot.watchers[watcherId] = {
      id: watcherId,
      roomId: room.id,
      memberId: nextMemberId,
      enabled: memberInput.watch.enabled,
      intervalMinutes: memberInput.watch.intervalMinutes,
      persistent: memberInput.watch.persistent,
      prompt: memberInput.watch.prompt,
      pausedUntilActivity: existingWatcherId ? snapshot.watchers[existingWatcherId]?.pausedUntilActivity ?? false : false,
      lastConsumedMessageId: existingWatcherId ? snapshot.watchers[existingWatcherId]?.lastConsumedMessageId : undefined,
      lastConsumedStateAt: existingWatcherId ? snapshot.watchers[existingWatcherId]?.lastConsumedStateAt : undefined,
    };
    nextWatcherIds.push(watcherId);
  });

  room.memberIds
    .filter((memberId) => !nextMemberIds.includes(memberId))
    .forEach((memberId) => {
      const member = snapshot.members[memberId];
      if (!member) {
        return;
      }

      const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
      if (activeTask?.status === "running") {
        throw new Error(`Cannot remove @${member.handle} while the member is still running a task.`);
      }

      snapshot.members[memberId] = {
        ...member,
        isEntryMember: false,
        status: "idle",
        activeTaskId: undefined,
        providerSessionId: undefined,
        archivedAt: now,
      };
      removedMembers.push({ name: member.name });
    });

  room.watcherIds
    .filter((watcherId) => !nextWatcherIds.includes(watcherId))
    .forEach((watcherId) => {
      delete snapshot.watchers[watcherId];
    });

  const entryMemberInput = normalizedMembers.find((member) => member.isEntryMember === true);
  const entryMemberId = entryMemberInput
    ? nextMemberIds[normalizedMembers.findIndex((member) => member.memberId === entryMemberInput.memberId)]
    : undefined;

  if (!entryMemberId) {
    throw new Error("A room team must define exactly one entry member");
  }

  snapshot.rooms[room.id] = {
    ...room,
    teamName: input.teamName.trim(),
    teamDescription: input.teamDescription.trim(),
    teamAccentTone: validateAccentTone(input.teamAccentTone),
    memberIds: nextMemberIds,
    visibleMemberIds: validateVisibleIds(nextVisibleMemberIds, nextMemberIds),
    watcherIds: nextWatcherIds,
    entryMemberId,
  };

  if (snapshot.selection.roomId === room.id && snapshot.selection.memberId && !nextMemberIds.includes(snapshot.selection.memberId)) {
    snapshot.selection = {
      ...snapshot.selection,
      memberId: entryMemberId,
    };
  }

  addedMembers.forEach((member) => {
    insertSystemRoomMessage(snapshot, {
      roomId: room.id,
      createdAt: now,
      createId: context.createId,
      content: member.note?.trim()
        ? `${member.name} 被 ${snapshot.currentUserName} 加入群组，原因是：${member.note.trim()}`
        : `${member.name} 被 ${snapshot.currentUserName} 加入群组。`,
    });
  });
  removedMembers.forEach((member) => {
    insertSystemRoomMessage(snapshot, {
      roomId: room.id,
      createdAt: now,
      createId: context.createId,
      content: `${member.name} 被 ${snapshot.currentUserName} 移除群组。`,
    });
  });

  return snapshot;
}

export function setEntryMember(current: WorkspaceSnapshot, memberId: MemberId): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const { room } = resolveActiveRoomMember(snapshot, memberId);
  room.memberIds.forEach((roomMemberId) => {
    snapshot.members[roomMemberId] = {
      ...snapshot.members[roomMemberId],
      isEntryMember: roomMemberId === memberId,
    };
  });
  snapshot.rooms[room.id] = {
    ...room,
    entryMemberId: memberId,
  };

  return snapshot;
}

export function upsertMemberWatcher(
  current: WorkspaceSnapshot,
  input: UpsertWatcherInput,
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const { member, room } = resolveActiveRoomMember(snapshot, input.memberId);

  if (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes <= 0) {
    throw new Error("Watcher interval must be a positive number");
  }
  if (member.isRole) {
    throw new Error("Role members cannot enable Watch.");
  }

  const existingWatcherId = room.watcherIds.find((watcherId) => snapshot.watchers[watcherId]?.memberId === member.id);

  if (existingWatcherId) {
    snapshot.watchers[existingWatcherId] = {
      ...snapshot.watchers[existingWatcherId],
      enabled: input.enabled,
      intervalMinutes: Math.round(input.intervalMinutes),
      persistent: input.persistent ?? snapshot.watchers[existingWatcherId]?.persistent ?? false,
      prompt: input.prompt?.trim() || undefined,
    };
    return snapshot;
  }

  const watcherId = context.createId("watcher");
  snapshot.watchers[watcherId] = {
    id: watcherId,
    roomId: room.id,
    memberId: member.id,
    enabled: input.enabled,
    intervalMinutes: Math.round(input.intervalMinutes),
    persistent: input.persistent ?? false,
    prompt: input.prompt?.trim() || undefined,
    pausedUntilActivity: false,
  };
  snapshot.rooms[room.id] = {
    ...room,
    watcherIds: [...room.watcherIds, watcherId],
  };

  return snapshot;
}

export function appendTaskTrace(
  current: WorkspaceSnapshot,
  input: {
    taskId: TaskId;
    roomId: RoomId;
    memberId: MemberId;
    kind: TaskTraceEntry["kind"];
    title: string;
    content: string;
  },
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  insertTaskTrace(snapshot, {
    id: context.createId("trace"),
    taskId: input.taskId,
    roomId: input.roomId,
    memberId: input.memberId,
    kind: input.kind,
    title: input.title.trim(),
    content: input.content.trim(),
    createdAt: context.now(),
  });
  return snapshot;
}

export function upsertTaskTrace(
  current: WorkspaceSnapshot,
  input: {
    taskId: TaskId;
    roomId: RoomId;
    memberId: MemberId;
    kind: TaskTraceEntry["kind"];
    title: string;
    content: string;
  },
  context: MutationContext,
): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const title = input.title.trim();
  const content = input.content.trim();
  const existing = findLatestTaskTrace(
    snapshot,
    input.taskId,
    (trace) => trace.kind === input.kind && trace.title === title,
  );

  const latestTrace = findLatestTaskTraceEntry(snapshot, input.taskId);

  if (existing && latestTrace?.id === existing.id) {
    snapshot.taskTraces[existing.id] = {
      ...existing,
      content,
      createdAt: context.now(),
    };
    return snapshot;
  }

  insertTaskTrace(snapshot, {
    id: context.createId("trace"),
    taskId: input.taskId,
    roomId: input.roomId,
    memberId: input.memberId,
    kind: input.kind,
    title,
    content,
    createdAt: context.now(),
  });
  return snapshot;
}

export function toggleWatcher(current: WorkspaceSnapshot, watcherId: string): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const watcher = snapshot.watchers[watcherId];

  if (!watcher) {
    throw new Error(`Unknown watcher "${watcherId}"`);
  }

  snapshot.watchers[watcherId] = {
    ...watcher,
    enabled: !watcher.enabled,
    pausedUntilActivity: false,
  };

  return snapshot;
}

export function pauseWatcherUntilActivity(current: WorkspaceSnapshot, watcherId: string): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const watcher = snapshot.watchers[watcherId];

  if (!watcher) {
    throw new Error(`Unknown watcher "${watcherId}"`);
  }
  if (!watcher.enabled) {
    throw new Error("Cannot pause a disabled watcher");
  }
  if (!watcher.persistent) {
    throw new Error("Only persistent watchers can pause until activity");
  }

  snapshot.watchers[watcherId] = {
    ...watcher,
    pausedUntilActivity: true,
  };

  return snapshot;
}

function formatDigestLine(snapshot: WorkspaceSnapshot, messageId: MessageId): string {
  const message = snapshot.messages[messageId];
  const stamp = formatTime(message.createdAt);
  const mentionSuffix =
    message.mentionedMemberIds.length > 0
      ? ` @>${message.mentionedMemberIds.map((memberId) => snapshot.members[memberId]?.handle ?? memberId).join(", @>")}`
      : "";
  const referenceSuffix =
    (message.quotedMemberIds?.length ?? 0) > 0
      ? ` @${message.quotedMemberIds?.map((memberId) => snapshot.members[memberId]?.handle ?? memberId).join(", @")}`
      : "";

  return `[${stamp}] ${message.author.label}: ${message.content}${mentionSuffix}${referenceSuffix}`;
}

function truncateWatcherStateContent(content: string, maxLength = 180): string {
  const normalized = content.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeWatcherMessageContent(content: string): string {
  return content.trim().replace(/\s+/gu, " ").toLowerCase();
}

function isWatcherTaskOutput(snapshot: WorkspaceSnapshot, message: ChatMessage): boolean {
  if (!message.taskId) {
    return false;
  }

  const task = snapshot.tasks[message.taskId];
  if (!task) {
    return false;
  }

  return snapshot.messages[task.sourceMessageId]?.transport === "watch-digest";
}

function isTemplateAckMessage(message: ChatMessage): boolean {
  const content = normalizeWatcherMessageContent(message.content);

  return (
    /^收到任务[。.!！]?我会先整理当前房间上下文[。.!！]?如果需要协调其他成员[，,]?(?:我会)?在最终消息里明确 @>handle[。.!！]?$/u.test(
      content,
    )
    || /^收到群消息[。.!！]?我会按 .+ 先给出一版可执行方向[，,]?然后视情况 @>其他成员[。.!！]?$/u.test(content)
    || /^收到私信[。.!！]?我先按 .+ 处理这个点[，,]?再决定是否回群里同步[。.!！]?$/u.test(content)
  );
}

function isDigestLikeMessageContent(content: string): boolean {
  const normalized = normalizeWatcherMessageContent(content);

  return (
    normalized.startsWith("new room activity since last poll:")
    || normalized.startsWith("watcher activity since last watch:")
    || normalized.startsWith("本轮 watcher digest")
    || normalized.includes("已消费 watcher digest")
    || normalized.includes("这轮 watcher digest")
    || normalized.includes("watcher digest 仅新增")
  );
}

function isWatcherTriggeredTask(snapshot: WorkspaceSnapshot, taskId: TaskId | undefined): boolean {
  if (!taskId) {
    return false;
  }

  const task = snapshot.tasks[taskId];
  if (!task) {
    return false;
  }

  return snapshot.messages[task.sourceMessageId]?.transport === "watch-digest";
}

function shouldExcludeFromWatcherDigest(snapshot: WorkspaceSnapshot, messageId: MessageId): boolean {
  const message = snapshot.messages[messageId];

  if (!message) {
    return true;
  }

  return (
    message.visibility === "internal"
    || message.transport === "watch-digest"
    || isWatcherTaskOutput(snapshot, message)
    || isTemplateAckMessage(message)
    || isDigestLikeMessageContent(message.content)
  );
}

function shouldExcludeWatcherStateTrace(snapshot: WorkspaceSnapshot, trace: TaskTraceEntry): boolean {
  return trace.kind === "task-prompt" || isWatcherTriggeredTask(snapshot, trace.taskId);
}

function collectWatcherStateChanges(snapshot: WorkspaceSnapshot, watcher: WatchSubscription): TaskTraceEntry[] {
  return Object.values(snapshot.taskTraces)
    .filter((trace) => trace.roomId === watcher.roomId)
    .filter((trace) => watcher.lastConsumedStateAt === undefined || trace.createdAt > watcher.lastConsumedStateAt)
    .filter((trace) => !shouldExcludeWatcherStateTrace(snapshot, trace))
    .sort((left, right) => {
      const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
      return createdAtOrder !== 0 ? createdAtOrder : left.id.localeCompare(right.id);
    });
}

function findLatestWatcherStateChangeAt(snapshot: WorkspaceSnapshot, watcher: WatchSubscription): string | undefined {
  return Object.values(snapshot.taskTraces)
    .filter((trace) => trace.roomId === watcher.roomId)
    .filter((trace) => !shouldExcludeWatcherStateTrace(snapshot, trace))
    .sort((left, right) => {
      const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
      return createdAtOrder !== 0 ? createdAtOrder : right.id.localeCompare(left.id);
    })[0]?.createdAt;
}

function formatWatcherMemberStateLine(snapshot: WorkspaceSnapshot, roomId: RoomId, memberId: MemberId): string {
  const member = snapshot.members[memberId];
  if (!member || member.roomId !== roomId || member.archivedAt) {
    return `@${memberId}: unavailable`;
  }

  const segments = [`@${member.handle}: ${member.status}`];
  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
  if (activeTask) {
    segments.push(`task: ${activeTask.title}`);
  }

  const latestTrace = Object.values(snapshot.taskTraces)
    .filter((trace) => trace.roomId === roomId && trace.memberId === member.id)
    .filter((trace) => !shouldExcludeWatcherStateTrace(snapshot, trace))
    .sort((left, right) => {
      const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
      return createdAtOrder !== 0 ? createdAtOrder : right.id.localeCompare(left.id);
    })[0];
  if (latestTrace) {
    segments.push(`${latestTrace.kind}: ${truncateWatcherStateContent(latestTrace.content)}`);
  }

  return segments.join(" | ");
}

function buildWatcherDigestContent(
  snapshot: WorkspaceSnapshot,
  roomId: RoomId,
  newMessageIds: MessageId[],
  stateChanges: TaskTraceEntry[],
  persistentHeartbeat: boolean,
): string {
  const sections = ["Watcher activity since last watch:"];

  if (newMessageIds.length > 0) {
    sections.push("", "[Unseen messages]");
    sections.push(...newMessageIds.map((messageId) => `- ${formatDigestLine(snapshot, messageId)}`));
  }

  sections.push("", "[Member state]");
  sections.push(
    ...((snapshot.rooms[roomId]?.memberIds ?? [])
      .map((memberId) => `- ${formatWatcherMemberStateLine(snapshot, roomId, memberId)}`)),
  );

  if (persistentHeartbeat && newMessageIds.length === 0 && stateChanges.length === 0) {
    sections.push("", "[Persistent watch]");
    sections.push("- No new room messages or member state changes since the last interval.");
  }

  return sections.join("\n");
}

function advanceWatcherCursor(
  snapshot: WorkspaceSnapshot,
  watcher: WatchSubscription,
  watcherId: string,
  nextCursor: {
    lastConsumedMessageId?: MessageId;
    lastConsumedStateAt?: string;
  },
): void {
  snapshot.watchers[watcherId] = {
    ...watcher,
    lastConsumedMessageId: nextCursor.lastConsumedMessageId,
    lastConsumedStateAt: nextCursor.lastConsumedStateAt,
  };
}

export function runWatcher(current: WorkspaceSnapshot, watcherId: string, context: MutationContext): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const watcher = snapshot.watchers[watcherId];

  if (!watcher || !watcher.enabled) {
    return snapshot;
  }

  const roomMessageIds = snapshot.messageOrderByRoom[watcher.roomId] ?? [];
  const validRoomMessageIds = roomMessageIds.filter((messageId) => snapshot.messages[messageId]?.roomId === watcher.roomId);
  const latestRoomMessageId = validRoomMessageIds[validRoomMessageIds.length - 1];
  const latestStateChangeAt = findLatestWatcherStateChangeAt(snapshot, watcher);
  const watcherStateCursor = watcher.lastConsumedStateAt ?? latestStateChangeAt;
  const watcherWithResolvedStateCursor =
    watcher.lastConsumedStateAt === watcherStateCursor
      ? watcher
      : {
          ...watcher,
          lastConsumedStateAt: watcherStateCursor,
        };

  if (!watcher.lastConsumedMessageId && watcher.lastConsumedStateAt === undefined) {
    advanceWatcherCursor(snapshot, watcher, watcherId, {
      lastConsumedMessageId: latestRoomMessageId,
      lastConsumedStateAt: latestStateChangeAt,
    });
    return snapshot;
  }

  const startIndex = watcher.lastConsumedMessageId ? validRoomMessageIds.indexOf(watcher.lastConsumedMessageId) + 1 : 0;
  if (startIndex <= 0) {
    advanceWatcherCursor(snapshot, watcher, watcherId, {
      lastConsumedMessageId: latestRoomMessageId,
      lastConsumedStateAt: latestStateChangeAt ?? watcher.lastConsumedStateAt,
    });
    return snapshot;
  }

  const observedMessageIds = validRoomMessageIds.slice(startIndex);
  const newMessageIds = observedMessageIds.filter((messageId) => !shouldExcludeFromWatcherDigest(snapshot, messageId));
  const stateChanges = collectWatcherStateChanges(snapshot, watcherWithResolvedStateCursor);
  const hasObservedActivity = observedMessageIds.length > 0 || stateChanges.length > 0;
  const hasDigestActivity = newMessageIds.length > 0 || stateChanges.length > 0;
  const nextCursor = {
    lastConsumedMessageId:
      observedMessageIds.length > 0 ? observedMessageIds[observedMessageIds.length - 1] : watcher.lastConsumedMessageId,
    lastConsumedStateAt: stateChanges[stateChanges.length - 1]?.createdAt ?? watcherWithResolvedStateCursor.lastConsumedStateAt,
  };
  let effectiveWatcher = watcher;

  if (watcher.pausedUntilActivity) {
    if (!hasObservedActivity) {
      return snapshot;
    }

    effectiveWatcher = {
      ...watcher,
      pausedUntilActivity: false,
    };
    snapshot.watchers[watcherId] = effectiveWatcher;
  }

  if (!hasObservedActivity && !effectiveWatcher.persistent) {
    return snapshot;
  }

  if (!hasDigestActivity && !effectiveWatcher.persistent) {
    advanceWatcherCursor(snapshot, effectiveWatcher, watcherId, nextCursor);
    return snapshot;
  }

  const now = context.now();
  const digestMessage: ChatMessage = {
    id: context.createId("message"),
    roomId: effectiveWatcher.roomId,
    author: buildSystemAuthor("Watcher"),
    content: buildWatcherDigestContent(snapshot, effectiveWatcher.roomId, newMessageIds, stateChanges, effectiveWatcher.persistent ?? false),
    createdAt: now,
    transport: "watch-digest",
    status: "sent",
    visibility: "internal",
    mentionedMemberIds: [],
    quotedMemberIds: [],
    recipientMemberIds: [effectiveWatcher.memberId],
  };

  insertMessage(snapshot, digestMessage);
  advanceWatcherCursor(snapshot, effectiveWatcher, watcherId, {
    lastConsumedMessageId: hasObservedActivity ? digestMessage.id : effectiveWatcher.lastConsumedMessageId,
    lastConsumedStateAt: nextCursor.lastConsumedStateAt,
  });
  routeMessage(snapshot, digestMessage, now, context.createId);

  return snapshot;
}

export function extractMentionMemberIds(snapshot: WorkspaceSnapshot, roomId: string, content: string): MemberId[] {
  return extractTaggedHandles(snapshot, roomId, content, "@>");
}

export function extractQuotedMemberIds(snapshot: WorkspaceSnapshot, roomId: string, content: string): MemberId[] {
  return extractTaggedHandles(snapshot, roomId, content, "@");
}

export function extractAddressedMemberIds(snapshot: WorkspaceSnapshot, roomId: string, content: string): MemberId[] {
  return extractMentionMemberIds(snapshot, roomId, content);
}

function extractTaggedHandles(
  snapshot: WorkspaceSnapshot,
  roomId: string,
  content: string,
  trigger: "@>" | "@",
): MemberId[] {
  const room = snapshot.rooms[roomId];

  if (!room) {
    return [];
  }

  if (trigger === "@>") {
    return resolveRoleRouting(snapshot, roomId, content).memberIds;
  }

  const sanitizedContent = stripMarkdownCodeSegments(content);
  const seenHandles = new Set<string>();
  const memberIdByHandle = new Map(
    room.memberIds.map((memberId) => [snapshot.members[memberId]?.handle.toLowerCase(), memberId] as const),
  );
  const handles: MemberId[] = [];

  for (const match of sanitizedContent.matchAll(REFERENCE_TOKEN_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (!handle || seenHandles.has(handle)) {
      continue;
    }

    const memberId = memberIdByHandle.get(handle);
    if (!memberId) {
      continue;
    }

    seenHandles.add(handle);
    handles.push(memberId);
  }

  return handles;
}
