import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useShellPanels } from "@/components/layout/use-shell-panels";
import { SHELL_PANELS_STORAGE_KEY } from "@/lib/shell-panels";

const storage = new Map<string, string>();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      storage.delete(key);
    }),
    clear: vi.fn(() => {
      storage.clear();
    }),
  },
});

describe("useShellPanels", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("does not keep the desktop left sidebar collapsed when restoring legacy overlay state", () => {
    storage.set(
      SHELL_PANELS_STORAGE_KEY,
      JSON.stringify({
        leftCollapsed: true,
        leftWidth: 304,
        rightCollapsed: false,
        rightWidth: 372,
      }),
    );

    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
      writable: true,
    });

    const { result } = renderHook(() => useShellPanels());

    expect(result.current.layoutMode).toBe("desktop");
    expect(result.current.leftCollapsed).toBe(false);
  });

  it("ignores collapse toggles in desktop mode", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
      writable: true,
    });

    const { result } = renderHook(() => useShellPanels());

    act(() => {
      result.current.toggleLeftCollapsed();
      result.current.toggleRightCollapsed();
    });

    expect(result.current.layoutMode).toBe("desktop");
    expect(result.current.leftCollapsed).toBe(false);
    expect(result.current.rightCollapsed).toBe(false);
  });
});
