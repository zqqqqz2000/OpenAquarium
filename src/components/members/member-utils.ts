import type { MemberTask, Room, TaskTraceEntry, TaskTraceKind, TeamMember, WatchSubscription, WorkspaceSnapshot } from "@/domain/model";
import { summarizePrompt } from "@/lib/utils";

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
  sourcePreview?: string;
  statusLine: string;
}

const PROGRESS_TRACE_KINDS: ReadonlySet<TaskTraceKind> = new Set(["task-started", "status", "draft", "completed", "error", "interrupted"]);

export function getMemberActivitySummary(snapshot: WorkspaceSnapshot, member: TeamMember): MemberActivitySummary {
  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;

  if (!activeTask) {
    return {
      statusLine: member.acceptsDirectMessages ? "Direct open" : "Direct closed",
    };
  }

  const latestTrace = [...(snapshot.taskTraceOrderByTask[activeTask.id] ?? [])]
    .reverse()
    .map((traceId) => snapshot.taskTraces[traceId])
    .find((trace): trace is TaskTraceEntry => Boolean(trace) && PROGRESS_TRACE_KINDS.has(trace.kind));
  const sourcePreview = snapshot.messages[activeTask.sourceMessageId]?.content;
  const progressPreview = latestTrace ? summarizePrompt(latestTrace.content, 140) : undefined;

  return {
    activeTask,
    latestTrace,
    sourcePreview,
    statusLine: progressPreview ?? "Waiting for the next visible step.",
  };
}
