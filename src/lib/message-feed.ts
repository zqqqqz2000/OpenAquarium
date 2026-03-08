import type { ChatMessage, MemberTask, Room, TaskStatus, TeamMember, WorkspaceSnapshot } from "@/domain/model";

export type FeedTone = "paper" | "postit" | "blueprint" | "correction";

export interface MessageHandlerSummary {
  taskId: string;
  memberId: string;
  handle: string;
  name: string;
  title: string;
  status: TaskStatus;
}

export interface ContextBadge {
  id: string;
  label: string;
  tone: FeedTone;
}

export interface MemberHistoryEntry {
  message: ChatMessage;
  mentionedHandles: string[];
  recipientHandles: string[];
  handlers: MessageHandlerSummary[];
  contextBadges: ContextBadge[];
}

function uniqueHandles(handles: string[]): string[] {
  return [...new Set(handles.filter(Boolean))];
}

function buildHandlerSummary(snapshot: WorkspaceSnapshot, task: MemberTask): MessageHandlerSummary | undefined {
  const member = snapshot.members[task.memberId];
  if (!member) {
    return undefined;
  }

  return {
    taskId: task.id,
    memberId: member.id,
    handle: member.handle,
    name: member.name,
    title: task.title,
    status: task.status,
  };
}

function collectHandlers(snapshot: WorkspaceSnapshot, predicate: (task: MemberTask) => boolean): MessageHandlerSummary[] {
  return Object.values(snapshot.tasks)
    .filter(predicate)
    .map((task) => buildHandlerSummary(snapshot, task))
    .filter((task): task is MessageHandlerSummary => task !== undefined)
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
}

function buildContextBadge(id: string, label: string, tone: FeedTone): ContextBadge {
  return {
    id,
    label,
    tone,
  };
}

export function getMessageMentionHandles(snapshot: WorkspaceSnapshot, message: ChatMessage): string[] {
  return uniqueHandles(
    message.mentionedMemberIds.map((memberId) => snapshot.members[memberId]?.handle).filter((handle): handle is string => Boolean(handle)),
  );
}

export function getMessageRecipientHandles(
  snapshot: WorkspaceSnapshot,
  room: Room,
  message: ChatMessage,
): string[] {
  if (message.transport === "direct" || message.transport === "watch-digest") {
    return uniqueHandles(
      message.recipientMemberIds
        .filter((memberId) => room.memberIds.includes(memberId))
        .map((memberId) => snapshot.members[memberId]?.handle)
        .filter((handle): handle is string => Boolean(handle)),
    );
  }

  const mentionedHandles = getMessageMentionHandles(snapshot, message);
  if (mentionedHandles.length > 0) {
    return mentionedHandles;
  }

  if (message.author.kind === "user") {
    const entryMember = snapshot.members[room.entryMemberId];
    return entryMember ? [entryMember.handle] : [];
  }

  return [];
}

export function getMessageHandlers(snapshot: WorkspaceSnapshot, message: ChatMessage): MessageHandlerSummary[] {
  return collectHandlers(
    snapshot,
    (task) => task.roomId === message.roomId && task.sourceMessageId === message.id,
  );
}

export function getMemberHistory(snapshot: WorkspaceSnapshot, room: Room, member: TeamMember): MemberHistoryEntry[] {
  const handlerBySourceMessageId = new Map<string, MessageHandlerSummary[]>();
  const ownTaskByDraftMessageId = new Map<string, MessageHandlerSummary>();

  collectHandlers(
    snapshot,
    (task) => task.roomId === room.id && task.memberId === member.id,
  ).forEach((handler) => {
    const task = snapshot.tasks[handler.taskId];
    const nextHandlers = handlerBySourceMessageId.get(task.sourceMessageId) ?? [];
    handlerBySourceMessageId.set(task.sourceMessageId, [...nextHandlers, handler]);
    if (task.draftMessageId) {
      ownTaskByDraftMessageId.set(task.draftMessageId, handler);
    }
  });

  return (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .map((message) => {
      const contextBadges: ContextBadge[] = [];
      const ownHandlers = handlerBySourceMessageId.get(message.id) ?? [];
      const ownDraftHandler = ownTaskByDraftMessageId.get(message.id);
      const mentioned = message.mentionedMemberIds.includes(member.id);
      const directed = message.recipientMemberIds.includes(member.id);
      const authoredByMember = message.author.kind === "member" && message.author.id === member.id;

      if (ownHandlers.length > 0) {
        contextBadges.push(buildContextBadge("accepted", "Accepted", "blueprint"));
      }

      if (message.transport === "watch-digest" && directed) {
        contextBadges.push(buildContextBadge("watch-digest", "Watch digest", "correction"));
      } else if (message.transport === "direct" && directed) {
        contextBadges.push(buildContextBadge("direct", "Direct inbox", "postit"));
      }

      if (mentioned) {
        contextBadges.push(buildContextBadge("mentioned", "Mentioned", "postit"));
      }

      if (authoredByMember) {
        contextBadges.push(
          buildContextBadge(
            ownDraftHandler ? "reply" : "authored",
            ownDraftHandler && message.status === "streaming" ? "Draft reply" : "Reply",
            ownDraftHandler && message.status === "streaming" ? "correction" : "paper",
          ),
        );
      }

      if (contextBadges.length === 0) {
        return undefined;
      }

      return {
        message,
        mentionedHandles: getMessageMentionHandles(snapshot, message),
        recipientHandles: getMessageRecipientHandles(snapshot, room, message),
        handlers: ownHandlers.length > 0 ? ownHandlers : ownDraftHandler ? [ownDraftHandler] : [],
        contextBadges: [...new Map(contextBadges.map((badge) => [badge.id, badge])).values()],
      } satisfies MemberHistoryEntry;
    })
    .filter((entry): entry is MemberHistoryEntry => entry !== undefined);
}
