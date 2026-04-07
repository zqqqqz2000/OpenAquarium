import { isJsonObject, type JsonValue } from "@/lib/json";

export interface ShellPanelsState {
  leftCollapsed: boolean;
  leftWidth: number;
  rightCollapsed: boolean;
  rightWidth: number;
}

export interface PersistedShellPanelsState {
  desktopLeftCollapsed: boolean;
  leftWidth: number;
  overlayLeftCollapsed: boolean;
  desktopRightCollapsed: boolean;
  rightWidth: number;
  overlayRightCollapsed: boolean;
}

export type ShellPanelsLayoutMode = "desktop" | "overlay";

export const SHELL_PANELS_STORAGE_KEY = "openaquarium-shell-panels";
export const SHELL_PANELS_OVERLAY_BREAKPOINT = 768;
export const DESKTOP_COLLAPSED_LEFT_PANEL_WIDTH = 56;

export const DEFAULT_SHELL_PANELS_STATE: PersistedShellPanelsState = {
  desktopLeftCollapsed: false,
  leftWidth: 304,
  overlayLeftCollapsed: true,
  desktopRightCollapsed: false,
  rightWidth: 372,
  overlayRightCollapsed: true,
};

export const MIN_LEFT_PANEL_WIDTH = 248;
export const MAX_LEFT_PANEL_WIDTH = 420;
export const MIN_RIGHT_PANEL_WIDTH = 280;
export const MAX_RIGHT_PANEL_WIDTH = 520;

export function clampLeftPanelWidth(value: number): number {
  return Math.min(MAX_LEFT_PANEL_WIDTH, Math.max(MIN_LEFT_PANEL_WIDTH, Math.round(value)));
}

export function clampRightPanelWidth(value: number): number {
  return Math.min(MAX_RIGHT_PANEL_WIDTH, Math.max(MIN_RIGHT_PANEL_WIDTH, Math.round(value)));
}

export function parseShellPanelsState(rawValue: string | null | undefined): PersistedShellPanelsState {
  if (!rawValue) {
    return DEFAULT_SHELL_PANELS_STATE;
  }

  try {
    const parsed = JSON.parse(rawValue) as JsonValue;
    if (!isJsonObject(parsed)) {
      return DEFAULT_SHELL_PANELS_STATE;
    }

    return {
      desktopLeftCollapsed: parsed.desktopLeftCollapsed === true,
      leftWidth: typeof parsed.leftWidth === "number" ? clampLeftPanelWidth(parsed.leftWidth) : DEFAULT_SHELL_PANELS_STATE.leftWidth,
      overlayLeftCollapsed:
        parsed.overlayLeftCollapsed === true
          || (parsed.overlayLeftCollapsed !== false && parsed.leftCollapsed === true)
          || (parsed.overlayLeftCollapsed !== false
            && parsed.leftCollapsed !== false
            && DEFAULT_SHELL_PANELS_STATE.overlayLeftCollapsed),
      desktopRightCollapsed:
        parsed.desktopRightCollapsed === true
          || (parsed.desktopRightCollapsed !== false && parsed.rightCollapsed === true),
      rightWidth: typeof parsed.rightWidth === "number" ? clampRightPanelWidth(parsed.rightWidth) : DEFAULT_SHELL_PANELS_STATE.rightWidth,
      overlayRightCollapsed:
        parsed.overlayRightCollapsed === true
          || (parsed.overlayRightCollapsed !== false && parsed.rightCollapsed === true)
          || (parsed.overlayRightCollapsed !== false
            && parsed.rightCollapsed !== false
            && DEFAULT_SHELL_PANELS_STATE.overlayRightCollapsed),
    };
  } catch {
    return DEFAULT_SHELL_PANELS_STATE;
  }
}

export function serializeShellPanelsState(state: PersistedShellPanelsState): string {
  return JSON.stringify(state);
}

export function resolveShellPanelsState(
  persistedState: PersistedShellPanelsState,
  layoutMode: ShellPanelsLayoutMode,
): ShellPanelsState {
  return {
    leftCollapsed: layoutMode === "overlay" ? persistedState.overlayLeftCollapsed : persistedState.desktopLeftCollapsed,
    leftWidth: persistedState.leftWidth,
    rightCollapsed: layoutMode === "overlay" ? persistedState.overlayRightCollapsed : persistedState.desktopRightCollapsed,
    rightWidth: persistedState.rightWidth,
  };
}

export function getShellPanelsLayoutMode(viewportWidth: number): ShellPanelsLayoutMode {
  return viewportWidth <= SHELL_PANELS_OVERLAY_BREAKPOINT ? "overlay" : "desktop";
}

export function getRoomGridColumns(
  state: ShellPanelsState,
  layoutMode: ShellPanelsLayoutMode = "desktop",
): { leftPanel: string; templateColumns: string } {
  const leftPanel = state.leftCollapsed
    ? layoutMode === "overlay"
      ? "0rem"
      : `${DESKTOP_COLLAPSED_LEFT_PANEL_WIDTH}px`
    : `${clampLeftPanelWidth(state.leftWidth)}px`;

  return {
    leftPanel,
    templateColumns: layoutMode === "overlay" ? "minmax(0, 1fr)" : `${leftPanel} minmax(0, 1fr)`,
  };
}
