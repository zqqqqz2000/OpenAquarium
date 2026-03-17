import type {
  ChatMessage,
  MemberTask,
  Room,
  TaskTraceEntry,
  TaskTraceKind,
  TeamMember,
  WatchSubscription,
  WorkspaceSnapshot,
} from "@/domain/model";
import { isVisibleMainRoomMessage } from "@/lib/message-visibility";
import { summarizeLastLine, summarizePrompt } from "@/lib/utils";

export function getWatcherForMember(
  room: Room,
  snapshot: WorkspaceSnapshot,
  memberId: string,
): WatchSubscription | undefined {
  return room.watcherIds
    .map((watcherId) => snapshot.watchers[watcherId])
    .find(
      (candidate): candidate is WatchSubscription =>
        candidate?.memberId === memberId,
    );
}

export interface MemberActivitySummary {
  activeTask?: MemberTask;
  latestTrace?: TaskTraceEntry;
  latestMessage?: ChatMessage;
  latestContentPreview?: string;
  sourcePreview?: string;
  statusLine: string;
}

const PROGRESS_TRACE_KINDS: ReadonlySet<TaskTraceKind> = new Set([
  "task-started",
  "status",
  "draft",
  "completed",
  "error",
  "interrupted",
]);
const GENERIC_DYNAMIC_TOOL_NAMES = new Set([
  "acp.acp_provider_agent_dynamic_tool",
  "acp_provider_agent_dynamic_tool",
]);

interface ParsedToolTrace {
  toolCallId?: string;
  toolName: string;
}

function findLatestMemberRoomMessage(
  snapshot: WorkspaceSnapshot,
  roomId: string,
  memberId: string,
): ChatMessage | undefined {
  return [...(snapshot.messageOrderByRoom[roomId] ?? [])]
    .reverse()
    .map((messageId) => snapshot.messages[messageId])
    .find(
      (message): message is ChatMessage =>
        Boolean(message) &&
        message.author.kind === "member" &&
        message.author.id === memberId &&
        isVisibleMainRoomMessage(message),
    );
}

function isGenericDynamicToolName(toolName: string): boolean {
  return GENERIC_DYNAMIC_TOOL_NAMES.has(toolName.trim().toLowerCase());
}

function extractToolCallId(title: string): string | undefined {
  const titleMatch = title.match(/\[([^\]]+)\]\s*$/u);
  return titleMatch?.[1]?.trim() || undefined;
}

function normalizeToolName(content: string): string {
  return content
    .replace(/^Tool:\s*/iu, "")
    .replace(/\s+\((called|completed|running)\)\s*$/iu, "")
    .trim();
}

function parseToolTrace(trace: TaskTraceEntry): ParsedToolTrace | undefined {
  const normalizedContent = normalizeToolName(trace.content);
  if (normalizedContent.length === 0) {
    return undefined;
  }

  if (/^Tool\s+(call|completed|running)\b/iu.test(trace.title)) {
    return {
      toolCallId: extractToolCallId(trace.title),
      toolName: normalizedContent,
    };
  }

  if (/\((called|completed|running)\)\s*$/iu.test(trace.content)) {
    return {
      toolName: normalizedContent,
    };
  }

  return undefined;
}

function findPreviousMeaningfulToolName(
  traceEntries: TaskTraceEntry[],
  traceIndex: number,
  toolCallId?: string,
): string | undefined {
  for (let index = traceIndex - 1; index >= 0; index -= 1) {
    const traceEntry = traceEntries[index];
    if (!traceEntry) {
      continue;
    }

    const candidate = parseToolTrace(traceEntry);
    if (!candidate) {
      continue;
    }

    if (
      toolCallId &&
      candidate.toolCallId &&
      candidate.toolCallId !== toolCallId
    ) {
      continue;
    }

    if (!isGenericDynamicToolName(candidate.toolName)) {
      return candidate.toolName;
    }
  }

  return undefined;
}

function summarizeTracePreview(
  traceEntries: TaskTraceEntry[],
  traceIndex: number,
): string | undefined {
  const trace = traceEntries[traceIndex];
  if (!trace) {
    return undefined;
  }

  const reasoningMatch = /^Reasoning:(.*)$/su.exec(trace.content);
  if (reasoningMatch?.[1]) {
    const reasoningSummary = summarizeLastLine(reasoningMatch[1], 120);
    return reasoningSummary.length > 0 ? reasoningSummary : undefined;
  }

  const parsedToolTrace = parseToolTrace(trace);
  if (parsedToolTrace) {
    const resolvedToolName = isGenericDynamicToolName(parsedToolTrace.toolName)
      ? findPreviousMeaningfulToolName(
          traceEntries,
          traceIndex,
          parsedToolTrace.toolCallId,
        )
      : parsedToolTrace.toolName;

    return resolvedToolName
      ? summarizePrompt(resolvedToolName, 120)
      : undefined;
  }

  const contentSummary = summarizeLastLine(trace.content, 120);
  return contentSummary.length > 0 ? contentSummary : undefined;
}

function findLatestTaskActivityPreview(
  snapshot: WorkspaceSnapshot,
  taskId: string,
): string | undefined {
  const traceEntries = (snapshot.taskTraceOrderByTask[taskId] ?? [])
    .map((traceId) => snapshot.taskTraces[traceId])
    .filter(
      (trace): trace is TaskTraceEntry =>
        Boolean(trace) && PROGRESS_TRACE_KINDS.has(trace.kind),
    );

  for (let index = traceEntries.length - 1; index >= 0; index -= 1) {
    const preview = summarizeTracePreview(traceEntries, index);
    if (preview) {
      return preview;
    }
  }

  return undefined;
}

export function getMemberActivitySummary(
  snapshot: WorkspaceSnapshot,
  member: TeamMember,
): MemberActivitySummary {
  const activeTask = member.activeTaskId
    ? snapshot.tasks[member.activeTaskId]
    : undefined;
  const latestMessage = findLatestMemberRoomMessage(
    snapshot,
    member.roomId,
    member.id,
  );

  if (!activeTask) {
    return {
      latestMessage,
      latestContentPreview: latestMessage
        ? summarizeLastLine(latestMessage.content, 120)
        : undefined,
      statusLine: latestMessage
        ? summarizeLastLine(latestMessage.content, 120)
        : "No recent visible update.",
    };
  }

  const latestTrace = [...(snapshot.taskTraceOrderByTask[activeTask.id] ?? [])]
    .reverse()
    .map((traceId) => snapshot.taskTraces[traceId])
    .find(
      (trace): trace is TaskTraceEntry =>
        Boolean(trace) && PROGRESS_TRACE_KINDS.has(trace.kind),
    );
  const sourcePreview = snapshot.messages[activeTask.sourceMessageId]?.content;
  const progressPreview = findLatestTaskActivityPreview(
    snapshot,
    activeTask.id,
  );
  const latestContentPreview =
    progressPreview ??
    (latestMessage ? summarizeLastLine(latestMessage.content, 120) : undefined);

  return {
    activeTask,
    latestTrace,
    latestMessage,
    latestContentPreview,
    sourcePreview,
    statusLine: progressPreview ?? "Waiting for the next visible step.",
  };
}
