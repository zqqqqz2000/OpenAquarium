import type { ChatMessage, MessageVisibility, RoomMemberMessageFilter } from "@/domain/model";

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
  memberMessageFilter: RoomMemberMessageFilter = "all",
): boolean {
  if (!isVisibleRoomMessage(message) || message.transport === "direct") {
    return false;
  }

  if (memberMessageFilter === "only-members") {
    return message.author.kind === "member";
  }

  if (memberMessageFilter === "hide-members") {
    return message.author.kind !== "member";
  }

  return true;
}
