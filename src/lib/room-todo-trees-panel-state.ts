import { isJsonObject, type JsonValue } from "@/lib/json";

export type RoomTodoTreesPanelStatusFilter = "all" | "active" | "blocked" | "done";
export type RoomTodoTreesPanelDensity = "comfortable" | "compact";
export type RoomTodoTreesPanelViewMode = "split" | "graph" | "outline";

export interface RoomTodoTreesPanelState {
  collapsedNodeIdsByFile: Record<string, string[]>;
  density: RoomTodoTreesPanelDensity;
  selectedFilePath?: string;
  selectedNodeIdByFile: Record<string, string | undefined>;
  statusFilter: RoomTodoTreesPanelStatusFilter;
  viewMode: RoomTodoTreesPanelViewMode;
  zoomedOutByFile: Record<string, boolean>;
}

export const DEFAULT_ROOM_TODO_TREES_PANEL_STATE: RoomTodoTreesPanelState = {
  collapsedNodeIdsByFile: {},
  density: "comfortable",
  selectedFilePath: undefined,
  selectedNodeIdByFile: {},
  statusFilter: "all",
  viewMode: "split",
  zoomedOutByFile: {},
};

export const ROOM_TODO_TREES_PANEL_STORAGE_KEY_PREFIX = "openaquarium-room-todo-panel";

function isStatusFilter(value: JsonValue | undefined): value is RoomTodoTreesPanelStatusFilter {
  return value === "all" || value === "active" || value === "blocked" || value === "done";
}

function isDensity(value: JsonValue | undefined): value is RoomTodoTreesPanelDensity {
  return value === "comfortable" || value === "compact";
}

function isViewMode(value: JsonValue | undefined): value is RoomTodoTreesPanelViewMode {
  return value === "split" || value === "graph" || value === "outline";
}

function parseCollapsedNodeIdsByFile(value: JsonValue | undefined): Record<string, string[]> {
  if (!isJsonObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([filePath, nodeIds]) => (
      Array.isArray(nodeIds)
        ? [[filePath, nodeIds.filter((nodeId): nodeId is string => typeof nodeId === "string")]]
        : []
    )),
  );
}

function parseSelectedNodeIdByFile(value: JsonValue | undefined): Record<string, string | undefined> {
  if (!isJsonObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([filePath, nodeId]) => (
      typeof nodeId === "string" || typeof nodeId === "undefined"
        ? [[filePath, nodeId]]
        : []
    )),
  );
}

function parseZoomedOutByFile(value: JsonValue | undefined): Record<string, boolean> {
  if (!isJsonObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([filePath, zoomedOut]) => (
      typeof zoomedOut === "boolean" ? [[filePath, zoomedOut]] : []
    )),
  );
}

export function getRoomTodoTreesPanelStorageKey(roomId: string): string {
  return `${ROOM_TODO_TREES_PANEL_STORAGE_KEY_PREFIX}:${roomId}`;
}

export function parseRoomTodoTreesPanelState(
  rawValue: string | null | undefined,
): RoomTodoTreesPanelState {
  if (!rawValue) {
    return DEFAULT_ROOM_TODO_TREES_PANEL_STATE;
  }

  try {
    const parsed = JSON.parse(rawValue) as JsonValue;
    if (!isJsonObject(parsed)) {
      return DEFAULT_ROOM_TODO_TREES_PANEL_STATE;
    }

    return {
      collapsedNodeIdsByFile: parseCollapsedNodeIdsByFile(parsed.collapsedNodeIdsByFile),
      density: isDensity(parsed.density)
        ? parsed.density
        : DEFAULT_ROOM_TODO_TREES_PANEL_STATE.density,
      selectedFilePath:
        typeof parsed.selectedFilePath === "string"
          ? parsed.selectedFilePath
          : DEFAULT_ROOM_TODO_TREES_PANEL_STATE.selectedFilePath,
      selectedNodeIdByFile: parseSelectedNodeIdByFile(parsed.selectedNodeIdByFile),
      statusFilter: isStatusFilter(parsed.statusFilter)
        ? parsed.statusFilter
        : DEFAULT_ROOM_TODO_TREES_PANEL_STATE.statusFilter,
      viewMode: isViewMode(parsed.viewMode)
        ? parsed.viewMode
        : DEFAULT_ROOM_TODO_TREES_PANEL_STATE.viewMode,
      zoomedOutByFile: parseZoomedOutByFile(parsed.zoomedOutByFile),
    };
  } catch {
    return DEFAULT_ROOM_TODO_TREES_PANEL_STATE;
  }
}

export function serializeRoomTodoTreesPanelState(
  state: RoomTodoTreesPanelState,
): string {
  return JSON.stringify(state);
}

export function getInitialRoomTodoTreesPanelState(
  roomId: string,
): RoomTodoTreesPanelState {
  if (typeof window === "undefined") {
    return DEFAULT_ROOM_TODO_TREES_PANEL_STATE;
  }

  return parseRoomTodoTreesPanelState(
    window.localStorage.getItem(getRoomTodoTreesPanelStorageKey(roomId)),
  );
}