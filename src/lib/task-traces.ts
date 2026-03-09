import type { ChatMessage, MemberTask, Room, TaskTraceEntry, TeamMember, WorkspaceSnapshot } from "@/domain/model";

export interface MemberTaskTraceGroup {
  task: MemberTask;
  sourceMessage?: ChatMessage;
  entries: TaskTraceEntry[];
}

export function getMemberTaskTraceGroups(snapshot: WorkspaceSnapshot, room: Room, member: TeamMember): MemberTaskTraceGroup[] {
  return Object.values(snapshot.tasks)
    .filter((task) => task.roomId === room.id && task.memberId === member.id)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
    .map((task) => ({
      task,
      sourceMessage: snapshot.messages[task.sourceMessageId],
      entries: (snapshot.taskTraceOrderByTask[task.id] ?? [])
        .map((traceId) => snapshot.taskTraces[traceId])
        .filter((trace): trace is TaskTraceEntry => trace !== undefined)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    }));
}
