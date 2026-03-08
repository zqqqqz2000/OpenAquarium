import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { RootLayout } from "@/app/root-layout";
import { WorkspaceScreen } from "@/components/layout/workspace-screen";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <WorkspaceScreen />,
});

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/rooms/$roomId",
  component: () => {
    const params = roomRoute.useParams();
    return <WorkspaceScreen projectId={params.projectId} roomId={params.roomId} />;
  },
});

const memberStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/rooms/$roomId/members/$memberId",
  component: () => {
    const params = memberStudioRoute.useParams();
    return <WorkspaceScreen projectId={params.projectId} roomId={params.roomId} memberId={params.memberId} />;
  },
});

const routeTree = rootRoute.addChildren([indexRoute, roomRoute, memberStudioRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
