import type { WorkspaceSnapshot } from "@/domain/model";

export interface ResolvedDirectTarget {
  directMemberId?: string;
  directToUser?: boolean;
}

const USER_HANDLE_ALIASES = new Set(["user", "you"]);

export function resolveDirectTarget(snapshot: WorkspaceSnapshot, roomId: string, targetHandle?: string): ResolvedDirectTarget {
  const normalizedHandle = targetHandle?.replace(/^@/u, "").trim().toLowerCase();

  if (!normalizedHandle) {
    return {};
  }

  if (USER_HANDLE_ALIASES.has(normalizedHandle)) {
    return {
      directToUser: true,
    };
  }

  const room = snapshot.rooms[roomId];
  const directMemberId = room?.memberIds.find((memberId) => snapshot.members[memberId]?.handle.toLowerCase() === normalizedHandle);

  return directMemberId ? { directMemberId } : {};
}
