import { Outlet } from "@tanstack/react-router";

import { WorkspaceStoreProvider } from "@/store/workspace-store-provider";

export function RootLayout() {
  return (
    <WorkspaceStoreProvider>
      <Outlet />
    </WorkspaceStoreProvider>
  );
}
