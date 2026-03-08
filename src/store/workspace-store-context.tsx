import { createContext, useContext } from "react";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";

import type { WorkspaceRemoteStoreState } from "@/store/workspace-remote-store";

export const WorkspaceStoreContext = createContext<StoreApi<WorkspaceRemoteStoreState> | null>(null);

export function useWorkspaceStore<T>(selector: (state: WorkspaceRemoteStoreState) => T): T {
  const store = useContext(WorkspaceStoreContext);

  if (!store) {
    throw new Error("WorkspaceStoreProvider is missing");
  }

  return useStore(store, selector);
}
