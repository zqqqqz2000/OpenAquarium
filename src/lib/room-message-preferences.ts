import type { Room, RoomMemberMessageFilter, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { isVisibleMainRoomMessage } from "@/lib/message-visibility";

export const DEFAULT_ROOM_MEMBER_MESSAGE_FILTER: RoomMemberMessageFilter = "all";

export function resolveTemplateRoomMemberMessageFilter(template?: TeamTemplate): RoomMemberMessageFilter {
  return template?.defaultRoomMemberMessageFilter ?? DEFAULT_ROOM_MEMBER_MESSAGE_FILTER;
}

export function resolveRoomMemberMessageFilter(room: Room, template?: TeamTemplate): RoomMemberMessageFilter {
  return room.memberMessageFilter ?? resolveTemplateRoomMemberMessageFilter(template);
}

export function countUnreadRoomMemberMessages(snapshot: WorkspaceSnapshot, room: Room, template?: TeamTemplate): number {
  const roomFilter = resolveRoomMemberMessageFilter(room, template);
  const lastReadAt = room.lastReadMemberMessageAt ?? room.createdAt;

  return (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is NonNullable<typeof message> => Boolean(message))
    .filter((message) => message.createdAt > lastReadAt)
    .filter((message) => message.author.kind === "member")
    .filter((message) => isVisibleMainRoomMessage(message, roomFilter))
    .length;
}
