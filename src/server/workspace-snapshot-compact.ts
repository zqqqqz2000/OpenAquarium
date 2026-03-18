import type { MessageId, RoomId, TaskId, WorkspaceSnapshot } from "@/domain/model";
import { isVisibleRoomMessage } from "@/lib/message-visibility";
import { normalizeWatcherCursorState } from "@/server/watcher-cursor-normalization";

export interface WorkspaceSnapshotCompactionLimits {
  maxMessagesPerRoom: number;
  maxCompletedTasksPerRoom: number;
  maxCompletedTaskTraces: number;
  maxRunningTaskStatusTraces: number;
  maxMessageContentChars: number;
  maxTraceContentChars: number;
}

export const DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS: WorkspaceSnapshotCompactionLimits = {
  maxMessagesPerRoom: 240,
  maxCompletedTasksPerRoom: 160,
  maxCompletedTaskTraces: 24,
  maxRunningTaskStatusTraces: 40,
  maxMessageContentChars: 20_000,
  maxTraceContentChars: 24_000,
};

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function sortTaskIdsByUpdatedAt(taskIds: TaskId[], snapshot: WorkspaceSnapshot): TaskId[] {
  return [...taskIds].sort((left, right) => {
    const leftUpdatedAt = Date.parse(snapshot.tasks[left]?.updatedAt ?? "");
    const rightUpdatedAt = Date.parse(snapshot.tasks[right]?.updatedAt ?? "");
    return rightUpdatedAt - leftUpdatedAt;
  });
}

function retainRecentCompletedTasksByRoom(
  snapshot: WorkspaceSnapshot,
  limits: WorkspaceSnapshotCompactionLimits,
  retainedTaskIds: Set<TaskId>,
): void {
  const completedTaskIdsByRoom = new Map<RoomId, TaskId[]>();

  Object.values(snapshot.tasks).forEach((task) => {
    if (task.status !== "completed") {
      return;
    }

    const roomTaskIds = completedTaskIdsByRoom.get(task.roomId) ?? [];
    roomTaskIds.push(task.id);
    completedTaskIdsByRoom.set(task.roomId, roomTaskIds);
  });

  completedTaskIdsByRoom.forEach((taskIds) => {
    sortTaskIdsByUpdatedAt(taskIds, snapshot)
      .slice(0, limits.maxCompletedTasksPerRoom)
      .forEach((taskId) => retainedTaskIds.add(taskId));
  });
}

function buildRetainedTranscriptMessageIds(
  snapshot: WorkspaceSnapshot,
  limits: WorkspaceSnapshotCompactionLimits,
): {
  retainedMessageIds: Set<MessageId>;
  messageOrderByRoom: Record<RoomId, MessageId[]>;
} {
  const retainedMessageIds = new Set<MessageId>();
  const messageOrderByRoom: Record<RoomId, MessageId[]> = {};

  Object.entries(snapshot.messageOrderByRoom).forEach(([roomId, messageIds]) => {
    const validMessageIds = dedupeIds(messageIds).filter((messageId) => {
      const message = snapshot.messages[messageId];
      return message?.roomId === roomId && isVisibleRoomMessage(message);
    });
    const recentMessageIds = validMessageIds.slice(-limits.maxMessagesPerRoom);
    messageOrderByRoom[roomId] = recentMessageIds;
    recentMessageIds.forEach((messageId) => retainedMessageIds.add(messageId));
  });

  return {
    retainedMessageIds,
    messageOrderByRoom,
  };
}

function buildRetainedTaskIds(
  snapshot: WorkspaceSnapshot,
  limits: WorkspaceSnapshotCompactionLimits,
  retainedTranscriptMessageIds: Set<MessageId>,
): Set<TaskId> {
  const retainedTaskIds = new Set<TaskId>();

  Object.values(snapshot.members).forEach((member) => {
    if (member.activeTaskId) {
      retainedTaskIds.add(member.activeTaskId);
    }
  });

  Object.values(snapshot.tasks).forEach((task) => {
    if (task.status !== "completed") {
      retainedTaskIds.add(task.id);
      return;
    }

    if (
      retainedTranscriptMessageIds.has(task.sourceMessageId)
      || (task.draftMessageId ? retainedTranscriptMessageIds.has(task.draftMessageId) : false)
    ) {
      retainedTaskIds.add(task.id);
    }
  });

  retainedTranscriptMessageIds.forEach((messageId) => {
    const message = snapshot.messages[messageId];
    if (message.taskId) {
      retainedTaskIds.add(message.taskId);
    }
  });

  retainRecentCompletedTasksByRoom(snapshot, limits, retainedTaskIds);
  return retainedTaskIds;
}

function buildRetainedMessageIdsForTasks(
  snapshot: WorkspaceSnapshot,
  retainedTaskIds: Set<TaskId>,
  retainedTranscriptMessageIds: Set<MessageId>,
): Set<MessageId> {
  const retainedMessageIds = new Set<MessageId>(retainedTranscriptMessageIds);

  retainedTaskIds.forEach((taskId) => {
    const task = snapshot.tasks[taskId];
    if (!task) {
      return;
    }

    retainedMessageIds.add(task.sourceMessageId);
    if (task.draftMessageId) {
      const taskMessage = snapshot.messages[task.draftMessageId];
      if (taskMessage && isVisibleRoomMessage(taskMessage)) {
        retainedMessageIds.add(task.draftMessageId);
      }
    }
  });

  return retainedMessageIds;
}

function compactTaskTraceIdsForTask(
  taskId: TaskId,
  snapshot: WorkspaceSnapshot,
  limits: WorkspaceSnapshotCompactionLimits,
): string[] {
  const traceIds = snapshot.taskTraceOrderByTask[taskId] ?? [];
  const task = snapshot.tasks[taskId];

  if (!task) {
    return [];
  }

  if (task.status === "running") {
    const nonStatusTraceIds = traceIds.filter((traceId) => snapshot.taskTraces[traceId]?.kind !== "status");
    const statusTraceIds = traceIds.filter((traceId) => snapshot.taskTraces[traceId]?.kind === "status");
    return dedupeIds([
      ...nonStatusTraceIds,
      ...statusTraceIds.slice(-limits.maxRunningTaskStatusTraces),
    ]);
  }

  return traceIds.slice(-limits.maxCompletedTaskTraces);
}

function truncateContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  const truncatedChars = content.length - maxChars;
  return `${content.slice(0, maxChars)}\n\n[truncated ${truncatedChars} chars]`;
}

function compactMessages(
  snapshot: WorkspaceSnapshot,
  retainedMessageIds: Set<MessageId>,
  limits: WorkspaceSnapshotCompactionLimits,
): WorkspaceSnapshot["messages"] {
  return Object.fromEntries(
    Object.entries(snapshot.messages)
      .filter(([messageId]) => retainedMessageIds.has(messageId))
      .map(([messageId, message]) => [
        messageId,
        {
          ...message,
          content: truncateContent(message.content, limits.maxMessageContentChars),
        },
      ]),
  );
}

function compactTaskTraces(
  snapshot: WorkspaceSnapshot,
  retainedTaskIds: Set<TaskId>,
  retainedTraceIds: Set<string>,
  limits: WorkspaceSnapshotCompactionLimits,
): WorkspaceSnapshot["taskTraces"] {
  return Object.fromEntries(
    Object.entries(snapshot.taskTraces)
      .filter(([traceId, trace]) => retainedTraceIds.has(traceId) && retainedTaskIds.has(trace.taskId))
      .map(([traceId, trace]) => [
        traceId,
        {
          ...trace,
          content: truncateContent(trace.content, limits.maxTraceContentChars),
        },
      ]),
  );
}

function normalizeWatcherCursor(
  snapshot: WorkspaceSnapshot,
  messages: WorkspaceSnapshot["messages"],
  roomMessageOrder: Record<RoomId, MessageId[]>,
): WorkspaceSnapshot["watchers"] {
  return Object.fromEntries(
    Object.entries(snapshot.watchers).map(([watcherId, watcher]) => {
      const roomMessageIds = roomMessageOrder[watcher.roomId] ?? [];

      return [
        watcherId,
        normalizeWatcherCursorState(watcher, roomMessageIds, messages),
      ];
    }),
  );
}

export function compactWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  limits: WorkspaceSnapshotCompactionLimits = DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS,
): WorkspaceSnapshot {
  const { retainedMessageIds: retainedTranscriptMessageIds, messageOrderByRoom } = buildRetainedTranscriptMessageIds(
    snapshot,
    limits,
  );
  const retainedTaskIds = buildRetainedTaskIds(snapshot, limits, retainedTranscriptMessageIds);
  const retainedMessageIds = buildRetainedMessageIdsForTasks(snapshot, retainedTaskIds, retainedTranscriptMessageIds);

  const compactedTasks = Object.fromEntries(
    Object.entries(snapshot.tasks).filter(([taskId]) => retainedTaskIds.has(taskId)),
  );
  const compactedMessages = compactMessages(snapshot, retainedMessageIds, limits);
  const compactedTraceOrderByTask = Object.fromEntries(
    Object.keys(compactedTasks)
      .map((taskId) => [taskId, compactTaskTraceIdsForTask(taskId, snapshot, limits)] as const)
      .filter(([, traceIds]) => traceIds.length > 0),
  );
  const retainedTraceIds = new Set(
    Object.values(compactedTraceOrderByTask)
      .flat()
      .filter((traceId): traceId is string => Boolean(traceId)),
  );
  const compactedTaskTraces = compactTaskTraces(snapshot, retainedTaskIds, retainedTraceIds, limits);

  return {
    ...snapshot,
    messages: compactedMessages,
    messageOrderByRoom,
    tasks: compactedTasks,
    taskTraces: compactedTaskTraces,
    taskTraceOrderByTask: compactedTraceOrderByTask,
    watchers: normalizeWatcherCursor(snapshot, compactedMessages, messageOrderByRoom),
  };
}
