import { useEffect, useState, type ReactNode } from "react";

import type { WorkspaceSnapshot } from "@/domain/model";
import type { WorkspaceAuthState } from "@/lib/runtime-client";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";
import { WorkspaceStoreContext } from "@/store/workspace-store-context";
import { createWorkspaceRemoteStore } from "@/store/workspace-remote-store";

function getAuthSessionToken(auth: WorkspaceAuthState): string | undefined {
  return auth.authenticated ? auth.sessionToken : undefined;
}

export function WorkspaceStoreProvider(props: { children: ReactNode; initialSnapshot?: WorkspaceSnapshot }) {
  const [client] = useState(() => new WorkspaceRuntimeClient());
  const [store] = useState(() => createWorkspaceRemoteStore(client));
  const [connectionSessionToken, setConnectionSessionToken] = useState<string | undefined>(() => client.getSessionToken());

  useEffect(() => {
    void store.getState().hydrate();
  }, [store]);

  useEffect(() => store.subscribe((state, previousState) => {
    const nextToken = getAuthSessionToken(state.auth);
    const previousToken = getAuthSessionToken(previousState.auth);
    if (nextToken !== previousToken) {
      setConnectionSessionToken(nextToken);
    }
  }), [store]);

  useEffect(() => client.connect(
    (payload) => {
      store.getState().replaceRemoteState(payload);
    },
    (connected) => {
      store.getState().setConnected(connected);
    },
  ), [client, connectionSessionToken, store]);

  return <WorkspaceStoreContext.Provider value={store}>{props.children}</WorkspaceStoreContext.Provider>;
}
