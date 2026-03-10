import { useEffect, useState } from "react";

import {
  DEFAULT_SHELL_PANELS_STATE,
  parseShellPanelsState,
  serializeShellPanelsState,
  SHELL_PANELS_STORAGE_KEY,
  type ShellPanelsState,
} from "@/lib/shell-panels";

function getInitialShellPanelsState(): ShellPanelsState {
  if (typeof window === "undefined") {
    return DEFAULT_SHELL_PANELS_STATE;
  }

  const persisted = window.localStorage.getItem(SHELL_PANELS_STORAGE_KEY);
  if (!persisted) {
    return window.innerWidth <= 860
      ? {
          ...DEFAULT_SHELL_PANELS_STATE,
          leftCollapsed: true,
          rightCollapsed: true,
        }
      : DEFAULT_SHELL_PANELS_STATE;
  }

  return parseShellPanelsState(persisted);
}

export function useShellPanels() {
  const [panels, setPanels] = useState<ShellPanelsState>(getInitialShellPanelsState);

  useEffect(() => {
    window.localStorage.setItem(SHELL_PANELS_STORAGE_KEY, serializeShellPanelsState(panels));
  }, [panels]);

  return {
    leftCollapsed: panels.leftCollapsed,
    leftWidth: panels.leftWidth,
    rightCollapsed: panels.rightCollapsed,
    toggleLeftCollapsed: () =>
      setPanels((current) => ({
        ...current,
        leftCollapsed: !current.leftCollapsed,
      })),
    toggleRightCollapsed: () =>
      setPanels((current) => ({
        ...current,
        rightCollapsed: !current.rightCollapsed,
      })),
    setLeftWidth: (leftWidth: number) =>
      setPanels((current) => ({
        ...current,
        leftWidth,
      })),
  };
}
