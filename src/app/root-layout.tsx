import { useMatchRoute } from "@tanstack/react-router";

import { WorkspaceScreen } from "@/components/layout/workspace-screen";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { WorkspaceStoreProvider } from "@/store/workspace-store-provider";
import { AppThemeProvider } from "@/theme/theme-provider";

function WorkspaceRouteView() {
  const matchRoute = useMatchRoute();
  const memberParams = matchRoute({
    to: "/projects/$projectId/rooms/$roomId/members/$memberId",
  });
  const roomParams = matchRoute({
    to: "/projects/$projectId/rooms/$roomId",
  });

  if (memberParams) {
    return (
      <WorkspaceScreen
        projectId={memberParams.projectId}
        roomId={memberParams.roomId}
        memberId={memberParams.memberId}
      />
    );
  }

  if (roomParams) {
    return (
      <WorkspaceScreen
        projectId={roomParams.projectId}
        roomId={roomParams.roomId}
      />
    );
  }

  return <WorkspaceScreen />;
}

export function RootLayout() {
  return (
    <WorkspaceStoreProvider>
      <I18nProvider>
        <AppThemeProvider>
          <TooltipProvider delayDuration={120}>
            <WorkspaceRouteView />
            <Toaster position="top-right" richColors closeButton />
          </TooltipProvider>
        </AppThemeProvider>
      </I18nProvider>
    </WorkspaceStoreProvider>
  );
}
