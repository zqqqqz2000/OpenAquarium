import { isJsonObject, type JsonValue } from "@/lib/json";

export interface ShellPanelsState {
  leftCollapsed: boolean;
  leftWidth: number;
  rightCollapsed: boolean;
}

export const SHELL_PANELS_STORAGE_KEY = "openaquarium-shell-panels";

export const DEFAULT_SHELL_PANELS_STATE: ShellPanelsState = {
  leftCollapsed: false,
  leftWidth: 304,
  rightCollapsed: false,
};

export const MIN_LEFT_PANEL_WIDTH = 248;
export const MAX_LEFT_PANEL_WIDTH = 420;

export function clampLeftPanelWidth(value: number): number {
  return Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, Math.round(value)));
}

export function parseShellPanelsState(rawValue: string | null | undefined): ShellPanelsState {
  if (!rawValue) {
    return DEFAULT_SHELL_PANELS_STATE;
  }

  try {
    const parsed = JSON.parse(rawValue) as JsonValue;
    if (!isJsonObject(parsed)) {
      return DEFAULT_SHELL_PANELS_STATE;
    }

    return {
      leftCollapsed: parsed.leftCollapsed === true,
      leftWidth: typeof parsed.leftWidth === "number" ? clampLeftPanelWidth(parsed.leftWidth) : DEFAULT_SHELL_PANELS_STATE.leftWidth,
      rightCollapsed: parsed.rightCollapsed === true,
    };
  } catch {
    return DEFAULT_SHELL_PANELS_STATE;
  }
}

export function serializeShellPanelsState(state: ShellPanelsState): string {
  return JSON.stringify(state);
}

export function getRoomGridColumns(state: ShellPanelsState): { leftPanel: string } {
  return {
    leftPanel: state.leftCollapsed ? "0rem" : `${clampLeftPanelWidth(state.leftWidth)}px`,
  };
}
