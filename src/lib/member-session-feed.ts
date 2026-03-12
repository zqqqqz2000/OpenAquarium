import type { Room, TaskStatus, TaskTraceKind, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import type { ContextBadge, MemberHistoryEntry, MessageHandlerSummary } from "@/lib/message-feed";
import { getMemberHistory } from "@/lib/message-feed";
import { getMemberTaskTraceGroups } from "@/lib/task-traces";

export interface MemberSessionMessageEntry {
  id: string;
  type: "message";
  createdAt: string;
  message: MemberHistoryEntry["message"];
  mentionedHandles: string[];
  quotedHandles: string[];
  recipientHandles: string[];
  handlerSummaries: MessageHandlerSummary[];
  contextBadges: ContextBadge[];
}

export interface MemberSessionTraceEntry {
  id: string;
  type: "trace";
  createdAt: string;
  traceKind: TaskTraceKind;
  title: string;
  content: string;
  taskId: string;
  taskTitle: string;
}

export type MemberSessionEntry = MemberSessionMessageEntry | MemberSessionTraceEntry;

export interface MemberSessionInternalEvent {
  id: string;
  type: "internal";
  createdAt: string;
  traceKind: Exclude<TaskTraceKind, "task-prompt">;
  kind: "tool-call" | "tool-result" | "reasoning" | "status" | "draft" | "completed" | "error" | "interrupted";
  title: string;
  content: string;
  streaming: boolean;
}

export interface MemberSessionToolEvent {
  id: string;
  type: "tool";
  createdAt: string;
  updatedAt: string;
  toolName: string;
  status: "running" | "completed";
  callContent?: string;
  resultContent?: string;
}

export interface MemberSessionRoomMessageEvent {
  id: string;
  type: "room-message";
  createdAt: string;
  message: MemberSessionMessageEntry;
}

export type MemberSessionExecutionEvent = MemberSessionInternalEvent | MemberSessionToolEvent;
export type MemberSessionActivityEvent = MemberSessionExecutionEvent | MemberSessionRoomMessageEvent;

export interface MemberSessionActivityEntry {
  id: string;
  type: "activity";
  createdAt: string;
  updatedAt: string;
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  prompt?: string;
  promptCreatedAt?: string;
  latestInternalEvent?: MemberSessionInternalEvent;
  roomReplyCount: number;
  events: MemberSessionActivityEvent[];
}

export type MemberSessionTimelineEntry = MemberSessionMessageEntry | MemberSessionActivityEntry;

function mapMemberHistoryEntry(entry: MemberHistoryEntry): MemberSessionMessageEntry {
  return {
    id: entry.message.id,
    type: "message",
    createdAt: entry.message.createdAt,
    message: entry.message,
    mentionedHandles: entry.mentionedHandles,
    quotedHandles: entry.quotedHandles,
    recipientHandles: entry.recipientHandles,
    handlerSummaries: entry.handlers,
    contextBadges: entry.contextBadges,
  };
}

function compareSessionEntries(left: MemberSessionEntry, right: MemberSessionEntry): number {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  if (left.type === right.type) {
    return left.id.localeCompare(right.id);
  }

  return left.type === "message" ? -1 : 1;
}

function compareTimelineEntries(left: MemberSessionTimelineEntry, right: MemberSessionTimelineEntry): number {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  if (left.type === right.type) {
    return left.id.localeCompare(right.id);
  }

  return left.type === "message" ? -1 : 1;
}

function compareActivityEvents(left: MemberSessionActivityEvent, right: MemberSessionActivityEvent): number {
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  if (createdAtOrder !== 0) {
    return createdAtOrder;
  }

  const getPriority = (entry: MemberSessionActivityEvent): number => {
    switch (entry.type) {
      case "internal":
        return 0;
      case "tool":
        return 1;
      case "room-message":
      default:
        return 2;
    }
  };

  const priorityOrder = getPriority(left) - getPriority(right);
  if (priorityOrder !== 0) {
    return priorityOrder;
  }

  if (left.type === right.type) {
    return left.id.localeCompare(right.id);
  }

  return left.id.localeCompare(right.id);
}

function findLatestTrace(
  entries: MemberSessionTraceEntry[],
  predicate: (entry: MemberSessionTraceEntry) => boolean,
): MemberSessionTraceEntry | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && predicate(entry)) {
      return entry;
    }
  }

  return undefined;
}

function isTaskRoomReply(
  entry: MemberSessionMessageEntry,
  member: TeamMember,
  taskIds: ReadonlySet<string>,
): boolean {
  return (
    entry.message.author.kind === "member"
    && entry.message.author.id === member.id
    && entry.message.transport === "group"
    && Boolean(entry.message.taskId)
    && taskIds.has(entry.message.taskId ?? "")
  );
}

function normalizeComparableContent(content?: string): string {
  return content?.trim().replace(/\s+/gu, " ") ?? "";
}

function isDuplicateContent(left?: string, right?: string): boolean {
  const normalizedLeft = normalizeComparableContent(left);
  const normalizedRight = normalizeComparableContent(right);

  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight;
}

function deriveIncrementalTraceContent(content: string, previousOutputContent?: string): string | undefined {
  if (!previousOutputContent) {
    return content;
  }

  if (content === previousOutputContent || isDuplicateContent(content, previousOutputContent)) {
    return undefined;
  }

  if (content.startsWith(previousOutputContent)) {
    const incrementalContent = content.slice(previousOutputContent.length).trimStart();
    return incrementalContent.length > 0 ? incrementalContent : undefined;
  }

  return content;
}

function classifyInternalEvent(entry: MemberSessionTraceEntry): MemberSessionInternalEvent["kind"] {
  if (entry.traceKind === "draft") {
    return "draft";
  }

  if (entry.traceKind === "completed") {
    return "completed";
  }

  if (entry.traceKind === "error") {
    return "error";
  }

  if (entry.traceKind === "interrupted") {
    return "interrupted";
  }

  if (/^Tool call/iu.test(entry.title)) {
    return "tool-call";
  }

  if (/^Tool (completed|result)/iu.test(entry.title)) {
    return "tool-result";
  }

  if (/^Reasoning$/iu.test(entry.title)) {
    return "reasoning";
  }

  if (/^Reasoning:/u.test(entry.content)) {
    return "reasoning";
  }

  if (/\(called\)$/u.test(entry.content)) {
    return "tool-call";
  }

  if (/\(completed\)$/u.test(entry.content)) {
    return "tool-result";
  }

  return "status";
}

function isReplyInternalKind(kind: MemberSessionInternalEvent["kind"]): kind is "draft" | "completed" {
  return kind === "draft" || kind === "completed";
}

function normalizeToolEventName(content: string): string {
  return content
    .replace(/^Tool:\s*/iu, "")
    .replace(/\s+\((called|completed)\)\s*$/iu, "")
    .trim();
}

function getToolEventName(event: MemberSessionInternalEvent): string {
  const normalizedContent = normalizeToolEventName(event.content);
  if (normalizedContent.length > 0) {
    return normalizedContent;
  }

  return event.title.replace(/^Tool\s+(call|completed|result)\s*/iu, "").replace(/^:\s*/u, "").trim() || "Tool";
}

function getActivityEventUpdatedAt(event: MemberSessionActivityEvent): string {
  return event.type === "tool" ? event.updatedAt : event.createdAt;
}

function findLatestActivityEvent(events: MemberSessionActivityEvent[]): MemberSessionActivityEvent | undefined {
  return [...events].sort((left, right) => getActivityEventUpdatedAt(left).localeCompare(getActivityEventUpdatedAt(right))).at(-1);
}

function hasMatchingRoomReply(entry: MemberSessionTraceEntry, taskMessages: MemberSessionMessageEntry[]): boolean {
  return taskMessages.some(
    (messageEntry) =>
      isDuplicateContent(messageEntry.message.content, entry.content),
  );
}

function buildInternalEvents(args: {
  traceEntries: MemberSessionTraceEntry[];
  taskMessages: MemberSessionMessageEntry[];
  taskStatus: TaskStatus;
}): MemberSessionInternalEvent[] {
  const { traceEntries, taskMessages, taskStatus } = args;
  const internalEvents: MemberSessionInternalEvent[] = [];
  let previousOutputContent: string | undefined;
  let replyGroupBaseOutputContent: string | undefined;

  for (const entry of traceEntries) {
    if (entry.traceKind === "task-prompt" || entry.traceKind === "task-started") {
      continue;
    }

    if (
      entry.traceKind === "completed"
      && (isDuplicateContent(entry.content, previousOutputContent) || hasMatchingRoomReply(entry, taskMessages))
    ) {
      const latestReplyEvent = internalEvents.at(-1);
      if (latestReplyEvent && isReplyInternalKind(latestReplyEvent.kind)) {
        latestReplyEvent.traceKind = "completed";
        latestReplyEvent.kind = "completed";
        latestReplyEvent.title = entry.title;
        latestReplyEvent.streaming = false;
      }
      previousOutputContent = entry.content;
      continue;
    }

    const kind = classifyInternalEvent(entry);
    if (isReplyInternalKind(kind)) {
      const latestReplyEvent = internalEvents.at(-1);
      const canMergeWithPreviousReply = Boolean(latestReplyEvent && isReplyInternalKind(latestReplyEvent.kind));
      const replyBaseOutputContent = canMergeWithPreviousReply ? replyGroupBaseOutputContent : previousOutputContent;
      const content = deriveIncrementalTraceContent(entry.content, replyBaseOutputContent);

      if (!content) {
        previousOutputContent = entry.content;
        continue;
      }

      if (latestReplyEvent && canMergeWithPreviousReply) {
        latestReplyEvent.traceKind = entry.traceKind;
        latestReplyEvent.kind = kind;
        latestReplyEvent.title = entry.title;
        latestReplyEvent.content = content;
        latestReplyEvent.streaming = entry.traceKind === "draft" && taskStatus === "running";
      } else {
        internalEvents.push({
          id: entry.id,
          type: "internal",
          createdAt: entry.createdAt,
          traceKind: entry.traceKind,
          kind,
          title: entry.title,
          content,
          streaming: entry.traceKind === "draft" && taskStatus === "running",
        });
        replyGroupBaseOutputContent = previousOutputContent;
      }

      previousOutputContent = entry.content;
      continue;
    }

    replyGroupBaseOutputContent = undefined;
    internalEvents.push({
      id: entry.id,
      type: "internal",
      createdAt: entry.createdAt,
      traceKind: entry.traceKind,
      kind,
      title: entry.title,
      content: entry.content,
      streaming: entry.traceKind === "draft" && taskStatus === "running",
    });

    if (kind === "error" || kind === "interrupted") {
      previousOutputContent = entry.content;
    }
  }

  return internalEvents;
}

function mergeToolExecutionEvents(internalEvents: MemberSessionInternalEvent[]): MemberSessionExecutionEvent[] {
  const executionEvents: MemberSessionExecutionEvent[] = [];
  const pendingToolEventIndexes = new Map<string, number[]>();

  for (const event of internalEvents) {
    if (event.kind !== "tool-call" && event.kind !== "tool-result") {
      executionEvents.push(event);
      continue;
    }

    const toolName = getToolEventName(event);
    const toolKey = toolName.toLowerCase();

    if (event.kind === "tool-call") {
      executionEvents.push({
        id: `tool-${event.id}`,
        type: "tool",
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
        toolName,
        status: "running",
        callContent: event.content,
      });
      const pendingIndexes = pendingToolEventIndexes.get(toolKey) ?? [];
      pendingIndexes.push(executionEvents.length - 1);
      pendingToolEventIndexes.set(toolKey, pendingIndexes);
      continue;
    }

    const pendingIndexes = pendingToolEventIndexes.get(toolKey);
    const pendingIndex = pendingIndexes?.at(-1);
    const pendingToolEvent = pendingIndex !== undefined ? executionEvents[pendingIndex] : undefined;

    if (pendingToolEvent && pendingToolEvent.type === "tool") {
      pendingToolEvent.status = "completed";
      pendingToolEvent.updatedAt = event.createdAt;
      pendingToolEvent.resultContent = event.content;
      pendingIndexes?.pop();
      if (!pendingIndexes || pendingIndexes.length === 0) {
        pendingToolEventIndexes.delete(toolKey);
      }
      continue;
    }

    executionEvents.push({
      id: `tool-${event.id}`,
      type: "tool",
      createdAt: event.createdAt,
      updatedAt: event.createdAt,
      toolName,
      status: "completed",
      resultContent: event.content,
    });
  }

  return executionEvents;
}

function buildActivityEntry(args: {
  traceEntries: MemberSessionTraceEntry[];
  taskMessages: MemberSessionMessageEntry[];
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
  taskStartedAt: string;
  taskUpdatedAt: string;
}): MemberSessionActivityEntry | undefined {
  const { traceEntries, taskMessages, taskId, taskTitle, taskStatus, taskStartedAt, taskUpdatedAt } = args;
  const promptTrace = findLatestTrace(traceEntries, (entry) => entry.traceKind === "task-prompt");
  const internalEvents = buildInternalEvents({
    traceEntries,
    taskMessages,
    taskStatus,
  });
  const executionEvents = mergeToolExecutionEvents(internalEvents);
  const roomMessageEvents: MemberSessionRoomMessageEvent[] = taskMessages.map((message) => ({
    id: `task-message-${message.id}`,
    type: "room-message",
    createdAt: message.createdAt,
    message,
  }));
  const events = [...executionEvents, ...roomMessageEvents].sort(compareActivityEvents);

  if (events.length === 0 && !promptTrace && taskStatus === "completed") {
    return undefined;
  }

  const latestActivityEvent = findLatestActivityEvent(events);
  const updatedAtCandidates = [
    taskUpdatedAt,
    promptTrace?.createdAt,
    latestActivityEvent ? getActivityEventUpdatedAt(latestActivityEvent) : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate));
  const updatedAt = [...updatedAtCandidates].sort((left, right) => left.localeCompare(right)).at(-1) ?? taskUpdatedAt;
  const latestInternalEvent = executionEvents.filter((event): event is MemberSessionInternalEvent => event.type === "internal").at(-1);

  return {
    id: `activity-${taskId}`,
    type: "activity",
    createdAt: events[0]?.createdAt ?? promptTrace?.createdAt ?? taskStartedAt,
    updatedAt,
    taskId,
    taskTitle,
    taskStatus,
    prompt: promptTrace?.content,
    promptCreatedAt: promptTrace?.createdAt,
    latestInternalEvent,
    roomReplyCount: roomMessageEvents.length,
    events,
  };
}

export function getMemberSessionEntries(snapshot: WorkspaceSnapshot, room: Room, member: TeamMember): MemberSessionEntry[] {
  const messageEntries: MemberSessionEntry[] = getMemberHistory(snapshot, room, member).map(mapMemberHistoryEntry);
  const traceEntries: MemberSessionEntry[] = getMemberTaskTraceGroups(snapshot, room, member).flatMap((group) =>
    group.entries.map((entry) => ({
      id: entry.id,
      type: "trace" as const,
      createdAt: entry.createdAt,
      traceKind: entry.kind,
      title: entry.title,
      content: entry.content,
      taskId: entry.taskId,
      taskTitle: group.task.title,
    })),
  );

  return [...messageEntries, ...traceEntries].sort(compareSessionEntries);
}

export function getMemberSessionTimelineEntries(
  snapshot: WorkspaceSnapshot,
  room: Room,
  member: TeamMember,
): MemberSessionTimelineEntry[] {
  const messageEntries = getMemberHistory(snapshot, room, member).map(mapMemberHistoryEntry);
  const taskGroups = getMemberTaskTraceGroups(snapshot, room, member);
  const taskIds = new Set(taskGroups.map((group) => group.task.id));
  const taskMessagesByTaskId = new Map<string, MemberSessionMessageEntry[]>();
  const standaloneMessageEntries: MemberSessionTimelineEntry[] = [];

  for (const entry of messageEntries) {
    if (isTaskRoomReply(entry, member, taskIds) && entry.message.taskId) {
      const taskMessages = taskMessagesByTaskId.get(entry.message.taskId) ?? [];
      taskMessagesByTaskId.set(entry.message.taskId, [...taskMessages, entry]);
      continue;
    }

    standaloneMessageEntries.push(entry);
  }

  const activityEntries = taskGroups
    .map((group) =>
      buildActivityEntry({
        traceEntries: group.entries.map((entry) => ({
          id: entry.id,
          type: "trace",
          createdAt: entry.createdAt,
          traceKind: entry.kind,
          title: entry.title,
          content: entry.content,
          taskId: entry.taskId,
          taskTitle: group.task.title,
        })),
        taskMessages: [...(taskMessagesByTaskId.get(group.task.id) ?? [])].sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
        taskId: group.task.id,
        taskTitle: group.task.title,
        taskStatus: group.task.status,
        taskStartedAt: group.task.startedAt,
        taskUpdatedAt: group.task.updatedAt,
      }),
    )
    .filter((entry): entry is MemberSessionActivityEntry => entry !== undefined);

  return [...standaloneMessageEntries, ...activityEntries].sort(compareTimelineEntries);
}
