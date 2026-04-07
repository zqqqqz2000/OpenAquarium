import { describe, expect, it } from "vitest";

import {
  DESKTOP_COLLAPSED_LEFT_PANEL_WIDTH,
  DEFAULT_SHELL_PANELS_STATE,
  getShellPanelsLayoutMode,
  getRoomGridColumns,
  parseShellPanelsState,
  resolveShellPanelsState,
  SHELL_PANELS_OVERLAY_BREAKPOINT,
  serializeShellPanelsState,
} from "@/lib/shell-panels";

describe("shell panels", () => {
  it("falls back to defaults for invalid persisted state", () => {
    expect(parseShellPanelsState(undefined)).toEqual(DEFAULT_SHELL_PANELS_STATE);
    expect(parseShellPanelsState("not-json")).toEqual(DEFAULT_SHELL_PANELS_STATE);
    expect(parseShellPanelsState(JSON.stringify({ leftCollapsed: "yes" }))).toEqual(DEFAULT_SHELL_PANELS_STATE);
  });

  it("round-trips a valid persisted state", () => {
    const state = {
      desktopLeftCollapsed: false,
      leftWidth: 320,
      overlayLeftCollapsed: true,
      desktopRightCollapsed: true,
      rightWidth: 408,
      overlayRightCollapsed: true,
    };

    expect(parseShellPanelsState(serializeShellPanelsState(state))).toEqual(state);
  });

  it("returns zero-width columns for a collapsed left panel", () => {
    expect(
      getRoomGridColumns({
        leftCollapsed: true,
        leftWidth: 304,
        rightCollapsed: false,
        rightWidth: 372,
      }, "overlay"),
    ).toEqual({
      leftPanel: "0rem",
      templateColumns: "minmax(0, 1fr)",
    });
  });

  it("migrates legacy leftCollapsed persistence to overlay only", () => {
    const parsed = parseShellPanelsState(
      JSON.stringify({
        leftCollapsed: true,
        leftWidth: 304,
        rightCollapsed: false,
        rightWidth: 372,
      }),
    );

    expect(resolveShellPanelsState(parsed, "desktop").leftCollapsed).toBe(false);
    expect(resolveShellPanelsState(parsed, "overlay").leftCollapsed).toBe(true);
  });

  it("uses overlay layout only below the compact breakpoint", () => {
    expect(getShellPanelsLayoutMode(SHELL_PANELS_OVERLAY_BREAKPOINT)).toBe("overlay");
    expect(getShellPanelsLayoutMode(SHELL_PANELS_OVERLAY_BREAKPOINT + 1)).toBe("desktop");
  });

  it("uses a single grid column in overlay mode", () => {
    expect(
      getRoomGridColumns(
        {
          leftCollapsed: false,
          leftWidth: 304,
          rightCollapsed: false,
          rightWidth: 372,
        },
        "overlay",
      ),
    ).toEqual({
      leftPanel: "304px",
      templateColumns: "minmax(0, 1fr)",
    });
  });

  it("keeps two columns in desktop mode", () => {
    expect(
      getRoomGridColumns(
        {
          leftCollapsed: false,
          leftWidth: 304,
          rightCollapsed: false,
          rightWidth: 372,
        },
        "desktop",
      ),
    ).toEqual({
      leftPanel: "304px",
      templateColumns: "304px minmax(0, 1fr)",
    });
  });

  it("keeps a restore rail visible when the desktop left panel is collapsed", () => {
    expect(
      getRoomGridColumns(
        {
          leftCollapsed: true,
          leftWidth: 304,
          rightCollapsed: false,
          rightWidth: 372,
        },
        "desktop",
      ),
    ).toEqual({
      leftPanel: `${DESKTOP_COLLAPSED_LEFT_PANEL_WIDTH}px`,
      templateColumns: `${DESKTOP_COLLAPSED_LEFT_PANEL_WIDTH}px minmax(0, 1fr)`,
    });
  });
});
