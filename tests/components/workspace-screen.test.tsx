import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigateMock, sidebarMock, chatPaneMock, useShellPanelsMock, workspaceState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  sidebarMock: vi.fn((_: Record<string, unknown>) => <div data-testid="sidebar-mock" />),
  chatPaneMock: vi.fn((props: { projectsPanelContent?: ReactNode }) => (
    <div data-testid="chat-pane-mock">{props.projectsPanelContent}</div>
  )),
  useShellPanelsMock: vi.fn(),
  workspaceState: {
    snapshot: undefined as unknown,
    auth: { required: false, authenticated: false } as any,
    globalConfig: {},
    loading: false,
    connected: true,
    error: undefined,
    login: vi.fn(),
    logout: vi.fn(),
    updateMe: vi.fn(),
    listManagedUsers: vi.fn(),
    createManagedUser: vi.fn(),
    updateManagedUser: vi.fn(),
    setManagedProjectMembership: vi.fn(),
    deleteProject: vi.fn(),
    deleteRoom: vi.fn(),
    deleteTemplate: vi.fn(),
    createWorkspaceAccount: vi.fn(),
    setActiveAccount: vi.fn(),
    selectRoom: vi.fn(),
    selectMember: vi.fn(),
    runWatcher: vi.fn(),
    toggleRoomWatcherSuspension: vi.fn(),
    updateMemberConfig: vi.fn(),
    updateRoomSettings: vi.fn(),
    updateRoomTeam: vi.fn(),
    updateTemplate: vi.fn(),
    updateGlobalConfig: vi.fn(),
    replaceRemoteState: vi.fn(),
    setEntryMember: vi.fn(),
    upsertWatcher: vi.fn(),
    sendUserMessage: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: (props: Record<string, unknown>) => sidebarMock(props),
}));

vi.mock("@/components/chat/chat-pane", () => ({
  ChatPane: (props: { projectsPanelContent?: ReactNode }) => chatPaneMock(props),
}));

vi.mock("@/components/layout/use-shell-panels", () => ({
  useShellPanels: () => useShellPanelsMock(),
}));

vi.mock("@/components/members/member-studio-dialog", () => ({
  MemberStudioDialog: () => null,
}));

vi.mock("@/components/rooms/room-team-dialog", () => ({
  RoomTeamDialog: () => null,
}));

vi.mock("@/components/templates/template-studio-dialog", () => ({
  TemplateStudioDialog: () => null,
}));

vi.mock("@/store/workspace-store-context", () => ({
  useWorkspaceStore: <T,>(selector: (state: typeof workspaceState) => T) => selector(workspaceState),
}));

import { WorkspaceScreen } from "@/components/layout/workspace-screen";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

function createAuthenticatedAuth(required = true) {
  return {
    required,
    authenticated: true as const,
    createdUser: false,
    sessionToken: "session-token",
    session: {
      id: "session_1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    user: {
      id: "user_1",
      handle: "alice",
      displayName: "Alice",
      isAdmin: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [],
  };
}

describe("WorkspaceScreen", () => {
  afterEach(() => {
    vi.clearAllMocks();
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.auth = { required: false, authenticated: false };
    workspaceState.loading = false;
  });

  it("passes the desktop collapsed state through to the projects sidebar", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.auth = createAuthenticatedAuth();
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: true,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    render(<WorkspaceScreen />);

    expect(sidebarMock).toHaveBeenCalled();
    expect(sidebarMock.mock.calls[0]?.[0]).toMatchObject({
      collapsed: true,
      overlay: false,
    });
  });

  it("does not override the room-grid viewport height with inline sizing", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.auth = createAuthenticatedAuth();
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: false,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    const { container } = render(<WorkspaceScreen />);
    const roomGrid = container.querySelector(".room-grid");

    expect(roomGrid).toBeTruthy();
    expect(roomGrid?.getAttribute("style")).toContain("--oa-left-panel");
    expect(roomGrid?.getAttribute("style")).not.toContain("height:");
    expect(roomGrid?.getAttribute("style")).not.toContain("min-height:");
  });

  it("shows the login gate whenever the user is not authenticated", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.auth = { required: false, authenticated: false };
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: false,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    render(<WorkspaceScreen />);

    expect(screen.getByText("Sign in to OpenAquarium")).toBeInTheDocument();
    expect(sidebarMock).not.toHaveBeenCalled();
    expect(chatPaneMock).not.toHaveBeenCalled();
  });

  it("keeps unauthenticated room deep links on the auth gate without rendering the workspace", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.loading = false;
    workspaceState.auth = { required: false, authenticated: false };
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: false,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    render(<WorkspaceScreen projectId="project_123" roomId="room_456" />);

    expect(screen.getByText("Sign in to OpenAquarium")).toBeInTheDocument();
    expect(chatPaneMock).not.toHaveBeenCalled();
    expect(sidebarMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("shows a bootstrap screen while auth state is still loading", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.loading = true;
    workspaceState.auth = { required: false, authenticated: false };
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: false,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    render(<WorkspaceScreen />);

    expect(screen.getByText("Restoring session…")).toBeInTheDocument();
    expect(chatPaneMock).not.toHaveBeenCalled();
    expect(sidebarMock).not.toHaveBeenCalled();
  });

  it("hides the legacy active-human controls once auth is the active entry model", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.auth = createAuthenticatedAuth(true);
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: false,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    render(<WorkspaceScreen />);

    expect(chatPaneMock).toHaveBeenCalled();
    expect(chatPaneMock.mock.calls[0]?.[0]).toMatchObject({
      onCreateWorkspaceAccount: undefined,
      onSetActiveAccount: undefined,
      topBarSecondaryContent: expect.anything(),
    });
  });

  it("also hides the legacy active-human controls for authenticated optional-auth sessions", () => {
    workspaceState.snapshot = createSeedWorkspace();
    workspaceState.auth = createAuthenticatedAuth(false);
    useShellPanelsMock.mockReturnValue({
      layoutMode: "desktop",
      leftCollapsed: false,
      leftWidth: 304,
      rightCollapsed: false,
      rightWidth: 372,
      toggleLeftCollapsed: vi.fn(),
      toggleRightCollapsed: vi.fn(),
      setLeftWidth: vi.fn(),
      setRightWidth: vi.fn(),
    });

    render(<WorkspaceScreen />);

    expect(chatPaneMock).toHaveBeenCalled();
    expect(chatPaneMock.mock.calls[0]?.[0]).toMatchObject({
      onCreateWorkspaceAccount: undefined,
      onSetActiveAccount: undefined,
    });
  });
});
