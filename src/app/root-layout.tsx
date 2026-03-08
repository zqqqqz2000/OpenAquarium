import { Outlet } from "@tanstack/react-router";

import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceStoreProvider } from "@/store/workspace-store-provider";
import { AppThemeProvider } from "@/theme/theme-provider";

export function RootLayout() {
  return (
    <WorkspaceStoreProvider>
      <AppThemeProvider>
        <TooltipProvider delayDuration={120}>
          <Outlet />
        </TooltipProvider>
      </AppThemeProvider>
    </WorkspaceStoreProvider>
  );
}
