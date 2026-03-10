import type { ChatMessage, TeamMember } from "@/domain/model";
import type { ContextBadge, MessageHandlerSummary } from "@/lib/message-feed";
import type { MessageBubbleProps } from "@/components/chat/message-bubble";

function equalStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalHandlerSummaries(left: MessageHandlerSummary[], right: MessageHandlerSummary[]): boolean {
  return (
    left.length === right.length &&
    left.every((handler, index) => {
      const candidate = right[index];
      return (
        candidate !== undefined &&
        handler.taskId === candidate.taskId &&
        handler.memberId === candidate.memberId &&
        handler.handle === candidate.handle &&
        handler.name === candidate.name &&
        handler.title === candidate.title &&
        handler.status === candidate.status
      );
    })
  );
}

function equalContextBadges(left: ContextBadge[], right: ContextBadge[]): boolean {
  return (
    left.length === right.length &&
    left.every((badge, index) => {
      const candidate = right[index];
      return candidate !== undefined && badge.id === candidate.id && badge.label === candidate.label && badge.tone === candidate.tone;
    })
  );
}

function equalMessage(left: ChatMessage, right: ChatMessage): boolean {
  return (
    left.id === right.id &&
    left.roomId === right.roomId &&
    left.author.kind === right.author.kind &&
    left.author.id === right.author.id &&
    left.author.label === right.author.label &&
    left.content === right.content &&
    left.createdAt === right.createdAt &&
    left.transport === right.transport &&
    left.status === right.status &&
    left.taskId === right.taskId &&
    equalStringArray(left.mentionedMemberIds, right.mentionedMemberIds) &&
    equalStringArray(left.quotedMemberIds ?? [], right.quotedMemberIds ?? []) &&
    equalStringArray(left.recipientMemberIds, right.recipientMemberIds)
  );
}

function equalAuthorMember(left?: TeamMember, right?: TeamMember): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.name === right.name &&
    left.handle === right.handle &&
    left.accentTone === right.accentTone &&
    left.status === right.status
  );
}

export function areMessageBubblePropsEqual(previous: MessageBubbleProps, next: MessageBubbleProps): boolean {
  return (
    equalMessage(previous.message, next.message) &&
    equalAuthorMember(previous.authorMember, next.authorMember) &&
    equalStringArray(previous.mentionedHandles ?? [], next.mentionedHandles ?? []) &&
    equalStringArray(previous.quotedHandles ?? [], next.quotedHandles ?? []) &&
    equalStringArray(previous.recipientHandles ?? [], next.recipientHandles ?? []) &&
    equalHandlerSummaries(previous.handlerSummaries ?? [], next.handlerSummaries ?? []) &&
    equalContextBadges(previous.contextBadges ?? [], next.contextBadges ?? [])
  );
}
