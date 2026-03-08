export interface ShellPanelsState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

export const SHELL_PANELS_STORAGE_KEY = "openaquarium-shell-panels";

export const DEFAULT_SHELL_PANELS_STATE: ShellPanelsState = {
  leftCollapsed: false,
  rightCollapsed: false,
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseShellPanelsState(rawValue: string | null | undefined): ShellPanelsState {
  if (!rawValue) {
    return DEFAULT_SHELL_PANELS_STATE;
  }

  try {
    const parsed: unknown = JSON.parse(rawValue);
    if (!isObjectRecord(parsed)) {
      return DEFAULT_SHELL_PANELS_STATE;
    }

    return {
      leftCollapsed: parsed.leftCollapsed === true,
      rightCollapsed: parsed.rightCollapsed === true,
    };
  } catch {
    return DEFAULT_SHELL_PANELS_STATE;
  }
}

export function serializeShellPanelsState(state: ShellPanelsState): string {
  return JSON.stringify(state);
}

export function getRoomGridColumns(state: ShellPanelsState): { leftPanel: string; rightPanel: string } {
  return {
    leftPanel: state.leftCollapsed ? "0rem" : "minmax(17rem, 19rem)",
    rightPanel: state.rightCollapsed ? "0rem" : "minmax(19rem, 21rem)",
  };
}
