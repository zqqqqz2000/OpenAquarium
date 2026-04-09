import { isJsonObject, type JsonValue } from "@/lib/json";

export type RoomTodoTreesPanelStatusFilter = "all" | "active" | "blocked" | "done";

export interface RoomTodoTreesPanelState {
  selectedFilePath?: string;
  selectedNodeIdByFile: Record<string, string | undefined>;
  statusFilter: RoomTodoTreesPanelStatusFilter;
}

export const DEFAULT_ROOM_TODO_TREES_PANEL_STATE: RoomTodoTreesPanelState = {
  selectedFilePath: undefined,
  selectedNodeIdByFile: {},
  statusFilter: "all",
};

export const ROOM_TODO_TREES_PANEL_STORAGE_KEY_PREFIX = "openaquarium-room-todo-panel";

function isStatusFilter(value: JsonValue | undefined): value is RoomTodoTreesPanelStatusFilter {
  return value === "all" || value === "active" || value === "blocked" || value === "done";
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
      selectedFilePath:
        typeof parsed.selectedFilePath === "string"
          ? parsed.selectedFilePath
          : DEFAULT_ROOM_TODO_TREES_PANEL_STATE.selectedFilePath,
      selectedNodeIdByFile: parseSelectedNodeIdByFile(parsed.selectedNodeIdByFile),
      statusFilter: isStatusFilter(parsed.statusFilter)
        ? parsed.statusFilter
        : DEFAULT_ROOM_TODO_TREES_PANEL_STATE.statusFilter,
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
