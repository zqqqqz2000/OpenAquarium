import type { WorkspaceSnapshot } from "@/domain/model";
import { compactWorkspaceSnapshot, type WorkspaceSnapshotCompactionLimits } from "./workspace-snapshot-compact";

export const DEFAULT_TRANSPORT_SNAPSHOT_LIMITS: WorkspaceSnapshotCompactionLimits = {
  maxMessagesPerRoom: 240,
  maxCompletedTasksPerRoom: 24,
  maxCompletedTaskTraces: 8,
  maxRunningTaskStatusTraces: 12,
  maxMessageContentChars: 4_000,
  maxTraceContentChars: 8_000,
};

export function buildTransportSnapshot(
  snapshot: WorkspaceSnapshot,
  limits: WorkspaceSnapshotCompactionLimits = DEFAULT_TRANSPORT_SNAPSHOT_LIMITS,
): WorkspaceSnapshot {
  return compactWorkspaceSnapshot(snapshot, limits);
}
