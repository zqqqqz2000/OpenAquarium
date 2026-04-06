import type { TeamMember, WorkspaceSnapshot } from "@/domain/model";

export interface ResolvedDirectTarget {
  directMemberId?: string;
  directHumanId?: string;
  directToUser?: boolean;
}

const USER_HANDLE_ALIASES = new Set(["user", "you"]);

function normalizeHandle(value?: string): string {
  return value?.replace(/^[@>]+/u, "").trim().toLowerCase() ?? "";
}

function getActiveRoomMembers(snapshot: WorkspaceSnapshot, roomId: string): TeamMember[] {
  const room = snapshot.rooms[roomId];
  if (!room) {
    return [];
  }

  return room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .filter((member): member is TeamMember => Boolean(member) && !member.archivedAt);
}

function matchesRoleToken(member: TeamMember, normalizedRole: string): boolean {
  return [member.roleId, member.roleName, member.handle]
    .map((value) => normalizeHandle(value))
    .some((value) => value === normalizedRole);
}

function resolveExplicitRoleMemberId(snapshot: WorkspaceSnapshot, roomId: string, normalizedHandle: string): string | undefined {
  const [roleToken, explicitHandle] = normalizedHandle.split("/", 2);
  if (!roleToken || !explicitHandle) {
    return undefined;
  }

  const roomMembers = getActiveRoomMembers(snapshot, roomId);
  const explicitMember = roomMembers.find((member) => normalizeHandle(member.handle) === explicitHandle);
  if (!explicitMember || !matchesRoleToken(explicitMember, roleToken)) {
    return undefined;
  }

  return explicitMember.id;
}

export function resolveDirectTarget(snapshot: WorkspaceSnapshot, roomId: string, targetHandle?: string): ResolvedDirectTarget {
  const normalizedHandle = normalizeHandle(targetHandle);

  if (!normalizedHandle) {
    return {};
  }

  if (USER_HANDLE_ALIASES.has(normalizedHandle)) {
    return {
      directToUser: true,
    };
  }

  const roomMembers = getActiveRoomMembers(snapshot, roomId);
  const directMemberId = roomMembers.find((member) => normalizeHandle(member.handle) === normalizedHandle)?.id;

  if (directMemberId) {
    return { directMemberId };
  }

  const directRoleMemberId = resolveExplicitRoleMemberId(snapshot, roomId, normalizedHandle);
  if (directRoleMemberId) {
    return { directMemberId: directRoleMemberId };
  }

  const roomHumanIds = snapshot.humanOrderByRoom?.[roomId]
    ?? Object.values(snapshot.humans ?? {})
      .filter((human) => human.roomId === roomId && !human.archivedAt)
      .map((human) => human.id);
  const directHumanId = roomHumanIds.find((humanId) => {
    const human = snapshot.humans?.[humanId];
    return human?.roomId === roomId
      && !human.archivedAt
      && normalizeHandle(human.handle) === normalizedHandle;
  });

  return directHumanId ? { directHumanId } : {};
}
