import { useEffect, useState, type ReactNode } from "react";

import type { WorkspaceSnapshot } from "@/domain/model";
import { WorkspaceStoreContext } from "@/store/workspace-store-context";
import { createWorkspaceRemoteStore } from "@/store/workspace-remote-store";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";

export function WorkspaceStoreProvider(props: { children: ReactNode; initialSnapshot?: WorkspaceSnapshot }) {
  const [client] = useState(() => new WorkspaceRuntimeClient());
  const [store] = useState(() => createWorkspaceRemoteStore(client));

  useEffect(() => {
    void store.getState().hydrate();
    return client.connect(
      (snapshot) => {
        store.getState().replaceSnapshot(snapshot);
      },
      (connected) => {
        store.getState().setConnected(connected);
      },
    );
  }, [client, store]);

  return <WorkspaceStoreContext.Provider value={store}>{props.children}</WorkspaceStoreContext.Provider>;
}
