import type { Room, TaskTraceKind, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import type { ContextBadge, MemberHistoryEntry, MessageHandlerSummary } from "@/lib/message-feed";
import { getMemberHistory } from "@/lib/message-feed";
import { getMemberTaskTraceGroups } from "@/lib/task-traces";

export interface MemberSessionMessageEntry {
  id: string;
  type: "message";
  createdAt: string;
  message: MemberHistoryEntry["message"];
  mentionedHandles: string[];
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

export function getMemberSessionEntries(snapshot: WorkspaceSnapshot, room: Room, member: TeamMember): MemberSessionEntry[] {
  const messageEntries: MemberSessionEntry[] = getMemberHistory(snapshot, room, member).map((entry) => ({
    id: entry.message.id,
    type: "message",
    createdAt: entry.message.createdAt,
    message: entry.message,
    mentionedHandles: entry.mentionedHandles,
    recipientHandles: entry.recipientHandles,
    handlerSummaries: entry.handlers,
    contextBadges: entry.contextBadges,
  }));
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
