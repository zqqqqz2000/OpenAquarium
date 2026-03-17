import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { RootLayout } from "@/app/root-layout";

const rootRoute = createRootRoute({
  component: RootLayout,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => null,
});

const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/rooms/$roomId",
  component: () => null,
});

const memberStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects/$projectId/rooms/$roomId/members/$memberId",
  component: () => null,
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
