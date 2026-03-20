import type { Room, WatchSubscription, WorkspaceSnapshot } from "@/domain/model";

export interface RoomWatcherPauseSummary {
  enabledCount: number;
  pausedUntilActivityCount: number;
}

function isEnabledWatcher(watcher: WatchSubscription | undefined): watcher is WatchSubscription {
  return watcher?.enabled === true;
}

export function getRoomWatcherPauseSummary(
  snapshot: WorkspaceSnapshot,
  room: Room,
): RoomWatcherPauseSummary {
  const enabledWatchers = room.watcherIds
    .map((watcherId) => snapshot.watchers[watcherId])
    .filter(isEnabledWatcher);

  return {
    enabledCount: enabledWatchers.length,
    pausedUntilActivityCount: enabledWatchers.filter((watcher) => watcher.pausedUntilActivity === true).length,
  };
}

export function buildRoomWatcherPauseSummaryById(
  snapshot: WorkspaceSnapshot,
): Record<string, RoomWatcherPauseSummary> {
  return Object.fromEntries(
    Object.values(snapshot.rooms).map((room) => [room.id, getRoomWatcherPauseSummary(snapshot, room)]),
  ) as Record<string, RoomWatcherPauseSummary>;
}
