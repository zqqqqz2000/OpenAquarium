import { describe, expect, it } from "vitest";

import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildRoomWatcherPauseSummaryById, getRoomWatcherPauseSummary } from "@/lib/watcher-state";

describe("watcher-state", () => {
  it("counts only enabled watchers paused until activity", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const watcherIds = room.watcherIds;

    if (watcherIds.length < 2) {
      throw new Error("Expected at least two seeded watchers");
    }

    snapshot.watchers[watcherIds[0]] = {
      ...snapshot.watchers[watcherIds[0]],
      enabled: true,
      pausedUntilActivity: true,
    };
    snapshot.watchers[watcherIds[1]] = {
      ...snapshot.watchers[watcherIds[1]],
      enabled: false,
      pausedUntilActivity: true,
    };

    expect(getRoomWatcherPauseSummary(snapshot, room)).toEqual({
      enabledCount: 1,
      pausedUntilActivityCount: 1,
    });
  });

  it("builds pause summaries for every room", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const watcherId = room.watcherIds[0];

    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    snapshot.watchers[watcherId] = {
      ...snapshot.watchers[watcherId],
      enabled: true,
      pausedUntilActivity: true,
    };

    const summaries = buildRoomWatcherPauseSummaryById(snapshot);

    expect(summaries[room.id]).toEqual({
      enabledCount: 2,
      pausedUntilActivityCount: 1,
    });
  });
});
