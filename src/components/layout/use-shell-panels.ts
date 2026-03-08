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

  return parseShellPanelsState(window.localStorage.getItem(SHELL_PANELS_STORAGE_KEY));
}

export function useShellPanels() {
  const [panels, setPanels] = useState<ShellPanelsState>(getInitialShellPanelsState);

  useEffect(() => {
    window.localStorage.setItem(SHELL_PANELS_STORAGE_KEY, serializeShellPanelsState(panels));
  }, [panels]);

  return {
    leftCollapsed: panels.leftCollapsed,
    leftWidth: panels.leftWidth,
    toggleLeftCollapsed: () =>
      setPanels((current) => ({
        ...current,
        leftCollapsed: !current.leftCollapsed,
      })),
    setLeftWidth: (leftWidth: number) =>
      setPanels((current) => ({
        ...current,
        leftWidth,
      })),
  };
}
