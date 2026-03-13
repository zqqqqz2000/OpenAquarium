import type { MemberId, Room, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { isVisibleMainRoomMessage } from "@/lib/message-visibility";

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

export function resolveTemplateVisibleMemberBlueprintIds(template?: TeamTemplate): string[] {
  if (!template) {
    return [];
  }

  const allBlueprintIds = template.members.map((member) => member.id);
  if (!template.defaultVisibleMemberBlueprintIds) {
    return allBlueprintIds;
  }

  const allowedBlueprintIds = new Set(allBlueprintIds);
  return dedupeIds(template.defaultVisibleMemberBlueprintIds.filter((memberId) => allowedBlueprintIds.has(memberId)));
}

export function resolveRoomVisibleMemberIds(
  snapshot: WorkspaceSnapshot,
  room: Room,
  template?: TeamTemplate,
): MemberId[] {
  const activeMemberIds = new Set(room.memberIds);

  if (room.visibleMemberIds) {
    return dedupeIds(room.visibleMemberIds.filter((memberId) => activeMemberIds.has(memberId)));
  }

  const visibleBlueprintIds = new Set(resolveTemplateVisibleMemberBlueprintIds(template));
  return room.memberIds.filter((memberId) => {
    const member = snapshot.members[memberId];
    return member ? visibleBlueprintIds.has(member.blueprintId) : false;
  });
}

export function resolveRoomVisibleMemberIdSet(
  snapshot: WorkspaceSnapshot,
  room: Room,
  template?: TeamTemplate,
): ReadonlySet<MemberId> {
  return new Set(resolveRoomVisibleMemberIds(snapshot, room, template));
}

export function countUnreadRoomMemberMessages(snapshot: WorkspaceSnapshot, room: Room, template?: TeamTemplate): number {
  const visibleMemberIds = resolveRoomVisibleMemberIdSet(snapshot, room, template);
  const lastReadAt = room.lastReadMemberMessageAt ?? room.createdAt;

  return (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is NonNullable<typeof message> => Boolean(message))
    .filter((message) => message.createdAt > lastReadAt)
    .filter((message) => message.author.kind === "member")
    .filter((message) => isVisibleMainRoomMessage(message, visibleMemberIds))
    .length;
}
