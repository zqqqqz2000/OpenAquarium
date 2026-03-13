import type { Project, Room, WorkspaceSnapshot } from "@/domain/model";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export interface RoomActivitySummary {
  room: Room;
  updatedAt: string;
  updatedAtMs: number;
  hasRunning: boolean;
  runningCount: number;
}

export interface ProjectActivitySummary {
  project: Project;
  rooms: RoomActivitySummary[];
  updatedAt: string;
  updatedAtMs: number;
  hasRunning: boolean;
  runningCount: number;
}

interface MutableRoomActivitySummary extends RoomActivitySummary {}

function parseTimestamp(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatRelativeActivityShort(timestamp: string, referenceTimeMs = Date.now()): string {
  const updatedAtMs = parseTimestamp(timestamp);
  if (updatedAtMs <= 0) {
    return "--";
  }

  const deltaMs = Math.max(0, referenceTimeMs - updatedAtMs);
  if (deltaMs < HOUR_MS) {
    return `${Math.max(1, Math.floor(deltaMs / MINUTE_MS))}m`;
  }

  if (deltaMs < DAY_MS) {
    return `${Math.floor(deltaMs / HOUR_MS)}h`;
  }

  if (deltaMs < WEEK_MS) {
    return `${Math.floor(deltaMs / DAY_MS)}d`;
  }

  return `${Math.floor(deltaMs / WEEK_MS)}w`;
}

export function buildProjectActivitySummaries(snapshot: WorkspaceSnapshot): ProjectActivitySummary[] {
  const roomActivityById = Object.fromEntries(
    Object.values(snapshot.rooms).map((room) => {
      const updatedAt = room.updatedAt ?? room.createdAt;
      const updatedAtMs = parseTimestamp(updatedAt);
      return [
        room.id,
        {
          room,
          updatedAt,
          updatedAtMs,
          hasRunning: false,
          runningCount: 0,
        } satisfies MutableRoomActivitySummary,
      ];
    }),
  ) as Record<string, MutableRoomActivitySummary>;

  Object.values(snapshot.tasks).forEach((task) => {
    const activity = roomActivityById[task.roomId];
    if (!activity || task.status !== "running") {
      return;
    }

    activity.hasRunning = true;
    activity.runningCount += 1;
  });

  Object.values(snapshot.members).forEach((member) => {
    if (member.status !== "running") {
      return;
    }

    const activity = roomActivityById[member.roomId];
    if (!activity) {
      return;
    }

    activity.hasRunning = true;
    activity.runningCount = Math.max(activity.runningCount, 1);
  });

  return snapshot.projectOrder
    .map((projectId) => snapshot.projects[projectId])
    .filter((project): project is Project => Boolean(project))
    .map((project) => {
      const rooms = (snapshot.roomOrderByProject[project.id] ?? [])
        .map((roomId) => roomActivityById[roomId])
        .filter((room): room is MutableRoomActivitySummary => Boolean(room))
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.room.name.localeCompare(right.room.name));
      const projectUpdatedAt = project.updatedAt ?? project.createdAt;
      const projectUpdatedAtMs = parseTimestamp(projectUpdatedAt);

      return {
        project,
        rooms,
        updatedAt: projectUpdatedAt,
        updatedAtMs: projectUpdatedAtMs,
        hasRunning: rooms.some((room) => room.hasRunning),
        runningCount: rooms.reduce((count, room) => count + room.runningCount, 0),
      } satisfies ProjectActivitySummary;
    })
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs || left.project.name.localeCompare(right.project.name));
}
