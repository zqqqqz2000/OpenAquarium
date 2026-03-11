import type { AccentTone, Room, WorkspaceSnapshot } from "@/domain/model";

export interface RoomTeamSummary {
  sourceTemplateId: string;
  name: string;
  description: string;
  accentTone: AccentTone;
}

function resolveFallbackAccentTone(snapshot: WorkspaceSnapshot, room: Room): AccentTone {
  const activeMemberAccentTone = room.memberIds
    .map((memberId) => snapshot.members[memberId]?.accentTone)
    .find((accentTone): accentTone is AccentTone => Boolean(accentTone));

  return activeMemberAccentTone ?? "paper";
}

export function resolveRoomTeamSummary(snapshot: WorkspaceSnapshot, room: Room): RoomTeamSummary {
  const template = snapshot.templates[room.templateId];

  return {
    sourceTemplateId: room.templateId,
    name: room.teamName?.trim() || template?.name || "Room team",
    description: room.teamDescription?.trim() || template?.description || "Room-scoped team configuration.",
    accentTone: room.teamAccentTone ?? template?.accentTone ?? resolveFallbackAccentTone(snapshot, room),
  };
}
