import { Outlet } from "@tanstack/react-router";

import { WorkspaceStoreProvider } from "@/store/workspace-store-provider";
import { UiThemeProvider } from "@/theme/ui-theme-provider";

export function RootLayout() {
  return (
    <UiThemeProvider>
      <WorkspaceStoreProvider>
        <Outlet />
      </WorkspaceStoreProvider>
    </UiThemeProvider>
  );
}
