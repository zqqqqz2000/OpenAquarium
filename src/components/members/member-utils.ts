import type { Room, WatchSubscription, WorkspaceSnapshot } from "@/domain/model";

export function getWatcherForMember(
  room: Room,
  snapshot: WorkspaceSnapshot,
  memberId: string,
): WatchSubscription | undefined {
  return room.watcherIds
    .map((watcherId) => snapshot.watchers[watcherId])
    .find((candidate): candidate is WatchSubscription => candidate?.memberId === memberId);
}
