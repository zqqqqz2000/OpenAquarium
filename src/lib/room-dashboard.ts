import type { MemberTask, Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";

export interface RoomDashboardMemberSummary {
  memberId: string;
  handle: string;
  name: string;
  status: TeamMember["status"];
  completedTaskCount: number;
  runningTaskCount: number;
  interruptedTaskCount: number;
  totalTaskCount: number;
  roomReplyCount: number;
  totalDurationMs: number;
  averageDurationMs?: number;
  lastTaskStartedAt?: string;
  lastTaskUpdatedAt?: string;
}

export interface RoomDashboardTaskSpan {
  taskId: string;
  memberId: string;
  memberHandle: string;
  memberName: string;
  taskTitle: string;
  focusMessageId?: string;
  status: MemberTask["status"];
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  offsetRatio: number;
  spanRatio: number;
  order: number;
}

export interface RoomDashboardMetrics {
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  interruptedTasks: number;
  totalRoomReplies: number;
  averageTaskDurationMs?: number;
  memberSummaries: RoomDashboardMemberSummary[];
  executionTimeline: RoomDashboardTaskSpan[];
}

function toTimestamp(value: string): number {
  return new Date(value).getTime();
}

function computeTaskDurationMs(task: MemberTask): number {
  return Math.max(0, toTimestamp(task.updatedAt) - toTimestamp(task.startedAt));
}

export function formatDurationLabel(durationMs?: number): string {
  if (typeof durationMs !== "number" || Number.isNaN(durationMs)) {
    return "n/a";
  }

  if (durationMs < 1_000) {
    return "<1s";
  }

  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours}h ${restMinutes}m`;
}

export function buildRoomDashboardMetrics(
  snapshot: WorkspaceSnapshot,
  room: Room,
  members: TeamMember[],
): RoomDashboardMetrics {
  const roomTaskEntries = Object.values(snapshot.tasks)
    .filter((task) => task.roomId === room.id && room.memberIds.includes(task.memberId))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const roomMessages = (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message) => Boolean(message));
  const visibleRoomMessages = roomMessages.filter((message) => message.transport === "group" && message.visibility !== "internal");
  const focusMessageIdByTaskId = visibleRoomMessages.reduce<Record<string, string>>((mapping, message) => {
    if (!message.taskId || mapping[message.taskId]) {
      return mapping;
    }

    mapping[message.taskId] = message.id;
    return mapping;
  }, {});
  const replyCountByMemberId = roomMessages.reduce<Record<string, number>>((counts, message) => {
    if (message.author.kind === "member" && room.memberIds.includes(message.author.id) && message.transport === "group") {
      counts[message.author.id] = (counts[message.author.id] ?? 0) + 1;
    }

    return counts;
  }, {});
  const totalDurationMs = roomTaskEntries.reduce((sum, task) => sum + computeTaskDurationMs(task), 0);
  const minStartedAt = roomTaskEntries[0]?.startedAt;
  const maxUpdatedAt = roomTaskEntries.at(-1)?.updatedAt;
  const timelineDurationMs = minStartedAt && maxUpdatedAt ? Math.max(1, toTimestamp(maxUpdatedAt) - toTimestamp(minStartedAt)) : 1;

  const memberSummaries = members
    .map<RoomDashboardMemberSummary>((member) => {
      const memberTasks = roomTaskEntries.filter((task) => task.memberId === member.id);
      const memberCompletedTasks = memberTasks.filter((task) => task.status === "completed");
      const memberDurationMs = memberCompletedTasks.reduce((sum, task) => sum + computeTaskDurationMs(task), 0);

      return {
        memberId: member.id,
        handle: member.handle,
        name: member.name,
        status: member.status,
        completedTaskCount: memberCompletedTasks.length,
        runningTaskCount: memberTasks.filter((task) => task.status === "running").length,
        interruptedTaskCount: memberTasks.filter((task) => task.status === "interrupted").length,
        totalTaskCount: memberTasks.length,
        roomReplyCount: replyCountByMemberId[member.id] ?? 0,
        totalDurationMs: memberDurationMs,
        averageDurationMs: memberCompletedTasks.length > 0 ? memberDurationMs / memberCompletedTasks.length : undefined,
        lastTaskStartedAt: memberTasks.at(-1)?.startedAt,
        lastTaskUpdatedAt: memberTasks.at(-1)?.updatedAt,
      };
    })
    .sort((left, right) => {
      if (right.completedTaskCount !== left.completedTaskCount) {
        return right.completedTaskCount - left.completedTaskCount;
      }

      if (right.totalTaskCount !== left.totalTaskCount) {
        return right.totalTaskCount - left.totalTaskCount;
      }

      return left.handle.localeCompare(right.handle);
    });

  const executionTimeline = roomTaskEntries.map<RoomDashboardTaskSpan>((task, index) => {
    const taskDurationMs = computeTaskDurationMs(task);
    const member = snapshot.members[task.memberId];
    const offsetMs = minStartedAt ? Math.max(0, toTimestamp(task.startedAt) - toTimestamp(minStartedAt)) : 0;

    return {
      taskId: task.id,
      memberId: task.memberId,
      memberHandle: member?.handle ?? task.memberId,
      memberName: member?.name ?? task.memberId,
      taskTitle: task.title,
      focusMessageId: focusMessageIdByTaskId[task.id] ?? task.sourceMessageId,
      status: task.status,
      startedAt: task.startedAt,
      updatedAt: task.updatedAt,
      durationMs: taskDurationMs,
      offsetRatio: offsetMs / timelineDurationMs,
      spanRatio: Math.max(taskDurationMs / timelineDurationMs, 0.04),
      order: index + 1,
    };
  });

  return {
    totalTasks: roomTaskEntries.length,
    completedTasks: roomTaskEntries.filter((task) => task.status === "completed").length,
    runningTasks: roomTaskEntries.filter((task) => task.status === "running").length,
    interruptedTasks: roomTaskEntries.filter((task) => task.status === "interrupted").length,
    totalRoomReplies: Object.values(replyCountByMemberId).reduce((sum, count) => sum + count, 0),
    averageTaskDurationMs: roomTaskEntries.length > 0 ? totalDurationMs / roomTaskEntries.length : undefined,
    memberSummaries,
    executionTimeline,
  };
}
