import type {
  ChatAuthor,
  ChatMessage,
  CompleteTaskInput,
  CreateRoomInput,
  CreateProjectInput,
  MemberId,
  MemberTask,
  MessageId,
  PostMemberMessageInput,
  PostMemberDraftInput,
  PostUserMessageInput,
  RoomId,
  Room,
  SkillDefinition,
  TaskId,
  TaskTraceEntry,
  TeamMember,
  TeamMemberBlueprint,
  TeamTemplate,
  UpsertWatcherInput,
  UpdateMemberConfigInput,
  WatchSubscription,
  WorkspaceSnapshot,
} from "./model";
import type { MutationContext } from "./identity";

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

function insertMessage(snapshot: WorkspaceSnapshot, message: ChatMessage): void {
  snapshot.messages[message.id] = message;
  snapshot.messageOrderByRoom[message.roomId] ??= [];
  snapshot.messageOrderByRoom[message.roomId].push(message.id);
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

function findBlueprint(template: TeamTemplate, predicate: (member: TeamMemberBlueprint) => boolean): TeamMemberBlueprint {
  const match = template.members.find(predicate);

  if (!match) {
    throw new Error(`Template "${template.id}" is missing a required member blueprint`);
  }

  return match;
}

function deriveRoomName(firstPrompt: string): string {
  const trimmed = firstPrompt.trim();

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

function resolveRecipients(snapshot: WorkspaceSnapshot, message: ChatMessage): MemberId[] {
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

  const addressedMemberIds = extractAddressedMemberIds(snapshot, message.roomId, message.content);
  if (message.author.kind === "user") {
    return addressedMemberIds.length > 0 ? addressedMemberIds : [room.entryMemberId];
  }

  return addressedMemberIds;
}

function routeMessage(snapshot: WorkspaceSnapshot, message: ChatMessage, now: string, createId: MutationContext["createId"]): void {
  const room = snapshot.rooms[message.roomId];

  if (!room) {
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
    name: blueprint.name,
    handle: blueprint.handle,
    summary: blueprint.summary,
    prompt: blueprint.prompt,
    accentTone: blueprint.accentTone,
    skills: blueprint.skills,
    provider: blueprint.provider,
    observeAllRoomMessages: blueprint.observeAllRoomMessages ?? false,
    acceptsDirectMessages: blueprint.acceptsDirectMessages ?? true,
    isEntryMember: blueprint.isEntryMember ?? false,
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
    createdAt: now,
  };
  snapshot.projectOrder.push(projectId);
  snapshot.roomOrderByProject[projectId] = [];

  return createRoomInProject(
    snapshot,
    {
      projectId,
      firstPrompt: input.firstPrompt,
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
  const entryBlueprint = findBlueprint(template, (member) => member.isEntryMember === true);
  const watcherIds = template.members
    .map((blueprint) => instantiateWatcher(roomId, memberIdByBlueprint[blueprint.id], blueprint, context.createId))
    .filter((watcher): watcher is WatchSubscription => watcher !== undefined);

  snapshot.roomOrderByProject[input.projectId] = [...(snapshot.roomOrderByProject[input.projectId] ?? []), roomId];
  snapshot.rooms[roomId] = {
    id: roomId,
    projectId: input.projectId,
    name: deriveRoomName(input.firstPrompt),
    topic: input.firstPrompt.trim(),
    templateId: template.id,
    memberIds: roomMembers.map((member) => member.id),
    watcherIds: watcherIds.map((watcher) => watcher.id),
    entryMemberId: memberIdByBlueprint[entryBlueprint.id],
    createdAt: now,
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

  return postUserMessage(
    snapshot,
    {
      roomId,
      content: input.firstPrompt,
    },
    context,
  );
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
  const message: ChatMessage = {
    id: context.createId("message"),
    roomId: input.roomId,
    author: buildUserAuthor(snapshot.currentUserName),
    content: input.content.trim(),
    createdAt: now,
    transport: input.directMemberId ? "direct" : "group",
    status: "sent",
    visibility: "public",
    mentionedMemberIds: input.mentionedMemberIds ?? [],
    recipientMemberIds: input.directMemberId ? [input.directMemberId] : [],
  };

  insertMessage(snapshot, message);
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

export function toggleMemberMonitor(current: WorkspaceSnapshot, memberId: MemberId): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const member = snapshot.members[memberId];

  if (!member) {
    throw new Error(`Unknown member "${memberId}"`);
  }

  snapshot.members[memberId] = {
    ...member,
    observeAllRoomMessages: !member.observeAllRoomMessages,
  };

  return snapshot;
}

export function updateMemberPrompt(current: WorkspaceSnapshot, memberId: MemberId, prompt: string): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const member = snapshot.members[memberId];

  if (!member) {
    throw new Error(`Unknown member "${memberId}"`);
  }

  snapshot.members[memberId] = {
    ...member,
    prompt,
  };

  return snapshot;
}

function validateProviderCapabilities(capabilities: string[]): string[] {
  return [...new Set(capabilities.map((capability) => capability.trim()).filter(Boolean))];
}

function validateSkills(skills: SkillDefinition[]): SkillDefinition[] {
  return skills.map((skill) => {
    if (!skill.name.trim() || !skill.command.trim()) {
      throw new Error("Each skill requires a name and command");
    }

    return {
      ...skill,
      id: skill.id.trim(),
      name: skill.name.trim(),
      description: skill.description.trim(),
      command: skill.command.trim(),
    };
  });
}

export function updateMemberConfig(current: WorkspaceSnapshot, input: UpdateMemberConfigInput): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const member = snapshot.members[input.memberId];

  if (!member) {
    throw new Error(`Unknown member "${input.memberId}"`);
  }

  if (!input.provider.label.trim() || !input.provider.command.trim()) {
    throw new Error("Provider label and command are required");
  }

  snapshot.members[input.memberId] = {
    ...member,
    summary: input.summary.trim(),
    prompt: input.prompt.trim(),
    acceptsDirectMessages: input.acceptsDirectMessages,
    skills: validateSkills(input.skills),
    provider: {
      ...input.provider,
      label: input.provider.label.trim(),
      command: input.provider.command.trim(),
      args: input.provider.args.map((arg) => arg.trim()).filter(Boolean),
      capabilities: validateProviderCapabilities(input.provider.capabilities),
    },
  };

  return snapshot;
}

export function setEntryMember(current: WorkspaceSnapshot, memberId: MemberId): WorkspaceSnapshot {
  const snapshot = cloneSnapshot(current);
  const member = snapshot.members[memberId];

  if (!member) {
    throw new Error(`Unknown member "${memberId}"`);
  }

  const room = snapshot.rooms[member.roomId];
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
  const member = snapshot.members[input.memberId];

  if (!member) {
    throw new Error(`Unknown member "${input.memberId}"`);
  }

  if (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes <= 0) {
    throw new Error("Watcher interval must be a positive number");
  }

  const room = snapshot.rooms[member.roomId];
  const existingWatcherId = room.watcherIds.find((watcherId) => snapshot.watchers[watcherId]?.memberId === member.id);

  if (existingWatcherId) {
    snapshot.watchers[existingWatcherId] = {
      ...snapshot.watchers[existingWatcherId],
      enabled: input.enabled,
      intervalMinutes: Math.round(input.intervalMinutes),
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

  if (existing) {
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
  };

  return snapshot;
}

function formatDigestLine(snapshot: WorkspaceSnapshot, messageId: MessageId): string {
  const message = snapshot.messages[messageId];
  const stamp = message.createdAt.slice(11, 16);
  const mentionSuffix =
    message.mentionedMemberIds.length > 0
      ? ` @${message.mentionedMemberIds.map((memberId) => snapshot.members[memberId]?.handle ?? memberId).join(", @")}`
      : "";

  return `[${stamp}] ${message.author.label}: ${message.content}${mentionSuffix}`;
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
    /^收到任务[。.!！]?我会先整理当前房间上下文[。.!！]?如果需要协调其他成员[，,]?(?:我会)?在最终消息里明确 @handle[。.!！]?$/u.test(
      content,
    )
    || /^收到群消息[。.!！]?我会按 .+ 先给出一版可执行方向[，,]?然后视情况 @其他成员[。.!！]?$/u.test(content)
    || /^收到私信[。.!！]?我先按 .+ 处理这个点[，,]?再决定是否回群里同步[。.!！]?$/u.test(content)
  );
}

function isDigestLikeMessageContent(content: string): boolean {
  const normalized = normalizeWatcherMessageContent(content);

  return (
    normalized.startsWith("new room activity since last poll:")
    || normalized.startsWith("本轮 watcher digest")
    || normalized.includes("已消费 watcher digest")
    || normalized.includes("这轮 watcher digest")
    || normalized.includes("watcher digest 仅新增")
  );
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

function advanceWatcherCursor(
  snapshot: WorkspaceSnapshot,
  watcher: WatchSubscription,
  watcherId: string,
  lastConsumedMessageId: MessageId | undefined,
): void {
  snapshot.watchers[watcherId] = {
    ...watcher,
    lastConsumedMessageId,
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

  if (!watcher.lastConsumedMessageId) {
    advanceWatcherCursor(snapshot, watcher, watcherId, latestRoomMessageId);
    return snapshot;
  }

  const startIndex = validRoomMessageIds.indexOf(watcher.lastConsumedMessageId) + 1;
  if (startIndex <= 0) {
    advanceWatcherCursor(snapshot, watcher, watcherId, latestRoomMessageId);
    return snapshot;
  }

  const observedMessageIds = validRoomMessageIds.slice(startIndex);
  const newMessageIds = observedMessageIds.filter((messageId) => !shouldExcludeFromWatcherDigest(snapshot, messageId));

  if (observedMessageIds.length === 0) {
    return snapshot;
  }

  if (newMessageIds.length === 0) {
    advanceWatcherCursor(snapshot, watcher, watcherId, observedMessageIds[observedMessageIds.length - 1]);
    return snapshot;
  }

  const now = context.now();
  const digestMessage: ChatMessage = {
    id: context.createId("message"),
    roomId: watcher.roomId,
    author: buildSystemAuthor("Watcher"),
    content: `New room activity since last poll:\n${newMessageIds.map((messageId) => `- ${formatDigestLine(snapshot, messageId)}`).join("\n")}`,
    createdAt: now,
    transport: "watch-digest",
    status: "sent",
    visibility: "public",
    mentionedMemberIds: [],
    recipientMemberIds: [watcher.memberId],
  };

  insertMessage(snapshot, digestMessage);
  advanceWatcherCursor(snapshot, watcher, watcherId, digestMessage.id);
  routeMessage(snapshot, digestMessage, now, context.createId);

  return snapshot;
}

export function extractMentionMemberIds(snapshot: WorkspaceSnapshot, roomId: string, content: string): MemberId[] {
  const room = snapshot.rooms[roomId];

  if (!room) {
    return [];
  }

  const handles = [...content.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLowerCase());

  if (handles.length === 0) {
    return [];
  }

  return room.memberIds.filter((memberId) => handles.includes(snapshot.members[memberId]?.handle.toLowerCase()));
}

export function extractAddressedMemberIds(snapshot: WorkspaceSnapshot, roomId: string, content: string): MemberId[] {
  const room = snapshot.rooms[roomId];

  if (!room) {
    return [];
  }

  const handles: string[] = [];
  let remaining = content.trimStart();

  while (remaining.length > 0) {
    const match = remaining.match(/^@([\p{L}\p{N}_-]+)(?:[\s,，、:：;；]+|$)/u);
    if (!match) {
      break;
    }

    const handle = match[1]?.toLowerCase();
    if (!handle) {
      break;
    }

    handles.push(handle);
    remaining = remaining.slice(match[0].length).trimStart();
  }

  if (handles.length === 0) {
    return [];
  }

  return room.memberIds.filter((memberId) => {
    const handle = snapshot.members[memberId]?.handle.toLowerCase();
    return handle ? handles.includes(handle) : false;
  });
}
