import type { ChatMessage, MessageVisibility } from "@/domain/model";

export function resolveMessageVisibility(message: ChatMessage): MessageVisibility {
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

export function isVisibleMainRoomMessage(message: ChatMessage): boolean {
  return isVisibleRoomMessage(message) && message.transport !== "direct";
}
