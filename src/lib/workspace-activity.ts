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

function applyTimestamp(summary: MutableRoomActivitySummary, value: string | undefined): void {
  if (!value) {
    return;
  }

  const parsed = parseTimestamp(value);
  if (parsed <= summary.updatedAtMs) {
    return;
  }

  summary.updatedAt = value;
  summary.updatedAtMs = parsed;
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
      const updatedAtMs = parseTimestamp(room.createdAt);
      return [
        room.id,
        {
          room,
          updatedAt: room.createdAt,
          updatedAtMs,
          hasRunning: false,
          runningCount: 0,
        } satisfies MutableRoomActivitySummary,
      ];
    }),
  ) as Record<string, MutableRoomActivitySummary>;

  Object.entries(snapshot.messageOrderByRoom).forEach(([roomId, messageIds]) => {
    const activity = roomActivityById[roomId];
    if (!activity) {
      return;
    }

    messageIds.forEach((messageId) => {
      applyTimestamp(activity, snapshot.messages[messageId]?.createdAt);
    });
  });

  Object.values(snapshot.tasks).forEach((task) => {
    const activity = roomActivityById[task.roomId];
    if (!activity) {
      return;
    }

    applyTimestamp(activity, task.startedAt);
    applyTimestamp(activity, task.updatedAt);

    if (task.status === "running") {
      activity.hasRunning = true;
      activity.runningCount += 1;
    }
  });

  Object.values(snapshot.taskTraces).forEach((trace) => {
    const activity = roomActivityById[trace.roomId];
    if (!activity) {
      return;
    }

    applyTimestamp(activity, trace.createdAt);
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
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
      const projectCreatedAtMs = parseTimestamp(project.createdAt);
      const latestRoom = rooms[0];

      return {
        project,
        rooms,
        updatedAt: latestRoom?.updatedAt ?? project.createdAt,
        updatedAtMs: Math.max(latestRoom?.updatedAtMs ?? 0, projectCreatedAtMs),
        hasRunning: rooms.some((room) => room.hasRunning),
        runningCount: rooms.reduce((count, room) => count + room.runningCount, 0),
      } satisfies ProjectActivitySummary;
    })
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
}
