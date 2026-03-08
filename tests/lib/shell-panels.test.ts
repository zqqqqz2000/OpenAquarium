import { describe, expect, it } from "vitest";

import {
  DEFAULT_SHELL_PANELS_STATE,
  getRoomGridColumns,
  parseShellPanelsState,
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
      leftCollapsed: true,
      rightCollapsed: false,
    };

    expect(parseShellPanelsState(serializeShellPanelsState(state))).toEqual(state);
  });

  it("returns zero-width columns for collapsed panels", () => {
    expect(
      getRoomGridColumns({
        leftCollapsed: true,
        rightCollapsed: false,
      }),
    ).toEqual({
      leftPanel: "0rem",
      rightPanel: "minmax(19rem, 21rem)",
    });
  });
});
