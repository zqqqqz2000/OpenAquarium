import type { ChatMessage, MemberTask, Room, TaskTraceEntry, TaskTraceKind, TeamMember, WatchSubscription, WorkspaceSnapshot } from "@/domain/model";
import { isVisibleMainRoomMessage } from "@/lib/message-visibility";
import { summarizeLastLine } from "@/lib/utils";

export function getWatcherForMember(
  room: Room,
  snapshot: WorkspaceSnapshot,
  memberId: string,
): WatchSubscription | undefined {
  return room.watcherIds
    .map((watcherId) => snapshot.watchers[watcherId])
    .find((candidate): candidate is WatchSubscription => candidate?.memberId === memberId);
}

export interface MemberActivitySummary {
  activeTask?: MemberTask;
  latestTrace?: TaskTraceEntry;
  latestMessage?: ChatMessage;
  latestContentPreview?: string;
  sourcePreview?: string;
  statusLine: string;
}

const PROGRESS_TRACE_KINDS: ReadonlySet<TaskTraceKind> = new Set(["task-started", "status", "draft", "completed", "error", "interrupted"]);

function findLatestMemberRoomMessage(snapshot: WorkspaceSnapshot, roomId: string, memberId: string): ChatMessage | undefined {
  return [...(snapshot.messageOrderByRoom[roomId] ?? [])]
    .reverse()
    .map((messageId) => snapshot.messages[messageId])
    .find((message): message is ChatMessage =>
      Boolean(message)
      && message.author.kind === "member"
      && message.author.id === memberId
      && isVisibleMainRoomMessage(message),
    );
}

export function getMemberActivitySummary(snapshot: WorkspaceSnapshot, member: TeamMember): MemberActivitySummary {
  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
  const latestMessage = findLatestMemberRoomMessage(snapshot, member.roomId, member.id);

  if (!activeTask) {
    return {
      latestMessage,
      latestContentPreview: latestMessage ? summarizeLastLine(latestMessage.content, 120) : undefined,
      statusLine: latestMessage ? summarizeLastLine(latestMessage.content, 120) : "No recent visible update.",
    };
  }

  const latestTrace = [...(snapshot.taskTraceOrderByTask[activeTask.id] ?? [])]
    .reverse()
    .map((traceId) => snapshot.taskTraces[traceId])
    .find((trace): trace is TaskTraceEntry => Boolean(trace) && PROGRESS_TRACE_KINDS.has(trace.kind));
  const sourcePreview = snapshot.messages[activeTask.sourceMessageId]?.content;
  const progressPreview = latestTrace ? summarizeLastLine(latestTrace.content, 140) : undefined;
  const latestContentPreview = summarizeLastLine(latestTrace?.content ?? latestMessage?.content ?? "", 120) || undefined;

  return {
    activeTask,
    latestTrace,
    latestMessage,
    latestContentPreview,
    sourcePreview,
    statusLine: progressPreview ?? "Waiting for the next visible step.",
  };
}
