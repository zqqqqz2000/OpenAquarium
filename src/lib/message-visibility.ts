import type { ChatMessage, MemberId, MessageVisibility } from "@/domain/model";

export function resolveMessageVisibility(message: ChatMessage): MessageVisibility {
  if (message.transport === "watch-digest") {
    return "internal";
  }

  if (message.visibility) {
    return message.visibility;
  }

  if (message.author.kind === "member" && message.taskId) {
    return "internal";
  }

  return "public";
}

export function isVisibleRoomMessage(message: ChatMessage): boolean {
  return resolveMessageVisibility(message) === "public";
}

export function isVisibleMainRoomMessage(
  message: ChatMessage,
  visibleMemberIds?: ReadonlySet<MemberId>,
): boolean {
  if (!isVisibleRoomMessage(message) || message.transport === "direct") {
    return false;
  }

  if (message.author.kind !== "member") {
    return true;
  }

  if (!visibleMemberIds) {
    return true;
  }

  return visibleMemberIds.has(message.author.id);
}
