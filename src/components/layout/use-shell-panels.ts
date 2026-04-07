import { useEffect, useState } from "react";

import {
  DEFAULT_SHELL_PANELS_STATE,
  getShellPanelsLayoutMode,
  parseShellPanelsState,
  resolveShellPanelsState,
  serializeShellPanelsState,
  SHELL_PANELS_STORAGE_KEY,
  type ShellPanelsLayoutMode,
  type PersistedShellPanelsState,
  type ShellPanelsState,
} from "@/lib/shell-panels";

function getInitialShellPanelsLayoutMode(): ShellPanelsLayoutMode {
  if (typeof window === "undefined") {
    return "desktop";
  }

  return getShellPanelsLayoutMode(window.innerWidth);
}

function getInitialShellPanelsState(): PersistedShellPanelsState {
  if (typeof window === "undefined") {
    return DEFAULT_SHELL_PANELS_STATE;
  }

  const persisted = window.localStorage.getItem(SHELL_PANELS_STORAGE_KEY);
  if (!persisted) {
    return DEFAULT_SHELL_PANELS_STATE;
  }

  return parseShellPanelsState(persisted);
}

export function useShellPanels() {
  const [panels, setPanels] = useState<PersistedShellPanelsState>(getInitialShellPanelsState);
  const [layoutMode, setLayoutMode] = useState<ShellPanelsLayoutMode>(getInitialShellPanelsLayoutMode);
  const resolvedPanels: ShellPanelsState = resolveShellPanelsState(panels, layoutMode);

  useEffect(() => {
    window.localStorage.setItem(SHELL_PANELS_STORAGE_KEY, serializeShellPanelsState(panels));
  }, [panels]);

  useEffect(() => {
    const handleResize = (): void => {
      setLayoutMode(getInitialShellPanelsLayoutMode());
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return {
    layoutMode,
    leftCollapsed: resolvedPanels.leftCollapsed,
    leftWidth: resolvedPanels.leftWidth,
    rightCollapsed: resolvedPanels.rightCollapsed,
    rightWidth: resolvedPanels.rightWidth,
    toggleLeftCollapsed: () =>
      setPanels((current) => ({
        ...current,
        ...(layoutMode === "overlay"
          ? {
              overlayLeftCollapsed: !resolveShellPanelsState(current, layoutMode).leftCollapsed,
            }
          : {
              desktopLeftCollapsed: !resolveShellPanelsState(current, layoutMode).leftCollapsed,
            }),
      })),
    toggleRightCollapsed: () =>
      setPanels((current) => ({
        ...current,
        ...(layoutMode === "overlay"
          ? {
              overlayRightCollapsed: !resolveShellPanelsState(current, layoutMode).rightCollapsed,
            }
          : {
              desktopRightCollapsed: !resolveShellPanelsState(current, layoutMode).rightCollapsed,
            }),
      })),
    setLeftWidth: (leftWidth: number) =>
      setPanels((current) => ({
        ...current,
        leftWidth,
      })),
    setRightWidth: (rightWidth: number) =>
      setPanels((current) => ({
        ...current,
        rightWidth,
      })),
  };
}
