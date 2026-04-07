import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: (props: { children?: ReactNode; className?: string; onClick?: () => void }) => (
    <a className={props.className} onClick={props.onClick}>
      {props.children}
    </a>
  ),
}));

vi.mock("@/components/projects/create-project-dialog", () => ({
  CreateProjectDialog: () => <div data-testid="create-project-dialog" />,
}));

vi.mock("@/components/projects/create-room-dialog", () => ({
  CreateRoomDialog: () => <div data-testid="create-room-dialog" />,
}));

vi.mock("@/components/theme/theme-toggle", () => ({
  ThemeToggle: (props: { mode?: string; className?: string }) => <div data-testid="theme-toggle" data-mode={props.mode} className={props.className} />,
}));

vi.mock("@/components/theme/locale-toggle", () => ({
  LocaleToggle: (props: { mode?: string; className?: string }) => <div data-testid="locale-toggle" data-mode={props.mode} className={props.className} />,
}));

import { Sidebar } from "@/components/layout/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/lib/i18n";
import { RECOMMENDED_DEV_RUNTIME_COMMAND } from "@/lib/runtime-dev";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildProjectActivitySummaries } from "@/lib/workspace-activity";
import { AppThemeProvider } from "@/theme/theme-provider";

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: vi.fn().mockImplementation(() => ({
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function buildSidebarData(snapshot: ReturnType<typeof createSeedWorkspace>) {
  const projectSummaries = buildProjectActivitySummaries(snapshot);

  return {
    projects: projectSummaries.map((summary) => summary.project),
    roomsByProject: Object.fromEntries(projectSummaries.map((summary) => [summary.project.id, summary.rooms.map((room) => room.room)])),
    projectActivityById: Object.fromEntries(projectSummaries.map((summary) => [summary.project.id, summary])),
    roomActivityById: Object.fromEntries(
      projectSummaries.flatMap((summary) => summary.rooms.map((roomSummary) => [roomSummary.room.id, roomSummary])),
    ),
  };
}

function buildSidebarViewState(snapshot: ReturnType<typeof createSeedWorkspace>) {
  const sidebarData = buildSidebarData(snapshot);

  return {
    ...sidebarData,
    projectUnreadCountById: Object.fromEntries(sidebarData.projects.map((project) => [project.id, 0])),
    roomUnreadCountById: Object.fromEntries(
      Object.values(sidebarData.roomsByProject)
        .flat()
        .map((room) => [room.id, 0]),
    ),
    projectRunningMembersById: Object.fromEntries(sidebarData.projects.map((project) => [project.id, []])),
    roomRunningMembersById: Object.fromEntries(Object.keys(sidebarData.roomActivityById).map((roomId) => [roomId, []])),
  };
}

function renderSidebar(node: ReactNode) {
  return render(
    <I18nProvider>
      <AppThemeProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </AppThemeProvider>
    </I18nProvider>,
  );
}

describe("Sidebar", () => {
  it("recommends the watch runtime command when offline", () => {
    const snapshot = createSeedWorkspace();
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected={false}
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(screen.getByText(RECOMMENDED_DEV_RUNTIME_COMMAND)).toBeInTheDocument();
  });

  it("uses compact header toggles instead of full-width sidebar controls", () => {
    const snapshot = createSeedWorkspace();
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(screen.getByTestId("theme-toggle")).toHaveAttribute("data-mode", "compact");
    expect(screen.getByTestId("locale-toggle")).toHaveAttribute("data-mode", "compact");
  });

  it("keeps the desktop projects sidebar stacked above the workspace", () => {
    const snapshot = createSeedWorkspace();
    const sidebarData = buildSidebarViewState(snapshot);
    const { container } = renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(container.querySelector("aside")).toHaveClass("z-20");
    expect(container.querySelector("aside")).toHaveClass("shrink-0");
    expect(container.querySelector("aside")).not.toHaveClass("absolute");
  });

  it("switches the projects sidebar to overlay positioning only when requested", () => {
    const snapshot = createSeedWorkspace();
    const sidebarData = buildSidebarViewState(snapshot);
    const { container } = renderSidebar(
      <Sidebar
        collapsed={false}
        overlay
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(container.querySelector("aside")).toHaveClass("absolute");
    expect(container.querySelector("aside")).toHaveClass("shadow-2xl");
  });

  it("keeps a visible restore rail when the desktop projects sidebar is collapsed", () => {
    const snapshot = createSeedWorkspace();
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed
        onToggleCollapsed={vi.fn()}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Show projects sidebar" })).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("keeps templates collapsed by default and scrolls the expanded list", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("sidebar-templates-scroll")).not.toBeInTheDocument();

    expect(screen.getByText("Team templates")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand team templates" }));

    expect(screen.getByTestId("sidebar-templates-scroll")).toHaveClass("max-h-[min(18rem,30vh)]");
    expect(screen.getByTestId("sidebar-templates-scroll")).toHaveClass("overflow-y-auto");
    expect(screen.getByRole("button", { name: "Collapse team templates" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open team template studio" })).toBeInTheDocument();
  });

  it("confirms deletion for projects, rooms, and templates from the sidebar", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }
    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    const onDeleteProject = vi.fn();
    const onDeleteRoom = vi.fn();
    const onDeleteTemplate = vi.fn();
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={project ? sidebarData.projects.filter((candidate) => candidate.id === project.id) : []}
        roomsByProject={project ? { [project.id]: sidebarData.roomsByProject[project.id] ?? [] } : {}}
        projectActivityById={project ? { [project.id]: sidebarData.projectActivityById[project.id] } : {}}
        roomActivityById={room ? { [room.id]: sidebarData.roomActivityById[room.id] } : {}}
        projectUnreadCountById={project ? { [project.id]: 0 } : {}}
        roomUnreadCountById={room ? { [room.id]: 0 } : {}}
        projectRunningMembersById={project ? { [project.id]: [] } : {}}
        roomRunningMembersById={room ? { [room.id]: [] } : {}}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={onDeleteProject}
        onDeleteRoom={onDeleteRoom}
        onDeleteTemplate={onDeleteTemplate}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    await user.click(screen.getByRole("button", { name: `Delete ${project.name}` }));
    await user.click(screen.getByRole("button", { name: `Delete ${project.name}` }));
    expect(onDeleteProject).toHaveBeenCalledWith(project.id);

    await user.click(screen.getByRole("button", { name: `Delete ${room.name}` }));
    await user.click(screen.getByRole("button", { name: `Delete ${room.name}` }));
    expect(onDeleteRoom).toHaveBeenCalledWith(room.id);

    await user.click(screen.getByRole("button", { name: "Expand team templates" }));
    await user.click(screen.getByRole("button", { name: "Delete Incident Pod" }));
    await user.click(screen.getByRole("button", { name: "Delete Incident Pod" }));
    expect(onDeleteTemplate).toHaveBeenCalledWith("template-incident-pod");
  });

  it("keeps room and template action icons from shrinking when titles are long", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    const longRoom = {
      ...room,
      name: "今天有什么热门的github Trending 有什么和llm相关的热门项目",
    };
    snapshot.rooms[room.id] = longRoom;
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    const roomLink = screen.getByText(longRoom.name).closest("a");
    if (!roomLink) {
      throw new Error("Expected room link");
    }

    const roomTextBlock = roomLink.querySelector(".min-w-0");
    expect(roomTextBlock).toBeTruthy();

    const roomActionIcon = roomLink.querySelector("svg.lucide-message-square-share");
    expect(roomActionIcon).toBeNull();

    await user.click(screen.getByRole("button", { name: "Expand team templates" }));

    const templateButton = screen.getByRole("button", {
      name: /Product Pod .*适合产品探索和 coding agent 协作/,
    });
    const templateTextBlock = templateButton.querySelector("span.min-w-0.flex-1");
    expect(templateTextBlock).toBeTruthy();

    const templateBadge = templateButton.querySelector("[data-slot='badge']");
    expect(templateBadge).toHaveClass("shrink-0");
  });

  it("shows updated metadata and status while hiding the raw project path", () => {
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    snapshot.projects[projectId] = {
      ...project,
      path: "/tmp/openaquarium/demo-path",
    };
    const firstTaskId = Object.keys(snapshot.tasks)[0];
    const entryMember = snapshot.members[room.entryMemberId];
    if (!firstTaskId || !entryMember) {
      throw new Error("Expected seeded task and entry member");
    }

    snapshot.tasks[firstTaskId] = {
      ...snapshot.tasks[firstTaskId],
      status: "running",
    };
    snapshot.members[room.entryMemberId] = {
      ...entryMember,
      status: "running",
    };
    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    expect(screen.queryByText("/tmp/openaquarium/demo-path")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Updated /).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/running/i).length).toBeGreaterThan(0);
  });

  it("keeps the existing active room styling when the room is not running", () => {
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
        collapsed={false}
        projects={sidebarData.projects}
        roomsByProject={sidebarData.roomsByProject}
        projectActivityById={sidebarData.projectActivityById}
        roomActivityById={sidebarData.roomActivityById}
        projectUnreadCountById={sidebarData.projectUnreadCountById}
        roomUnreadCountById={sidebarData.roomUnreadCountById}
        projectRunningMembersById={sidebarData.projectRunningMembersById}
        roomRunningMembersById={sidebarData.roomRunningMembersById}
        activeProjectId={project.id}
        activeRoomId={room.id}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        connected
        loading={false}
        onDeleteProject={vi.fn()}
        onDeleteRoom={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onResizeStart={vi.fn()}
        onOpenTemplate={vi.fn()}
        onOpenTemplateStudio={vi.fn()}
      />,
    );

    const roomCard = screen.getByText(room.name).closest("div.rounded-xl");
    expect(roomCard).toBeTruthy();
    expect(roomCard).toHaveClass("border-ring");
    expect(roomCard).not.toHaveClass("ring-1");
  });

  it("uses the room watcher button itself as the hold status indicator", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    snapshot.rooms[roomId] = {
      ...room,
      watchersSuspended: true,
    };
    const sidebarData = buildSidebarViewState(snapshot);
    const onToggleRoomWatcherSuspension = vi.fn();

    renderSidebar(
      <Sidebar
            collapsed={false}
            projects={sidebarData.projects}
            roomsByProject={sidebarData.roomsByProject}
            projectActivityById={sidebarData.projectActivityById}
            roomActivityById={sidebarData.roomActivityById}
            projectUnreadCountById={sidebarData.projectUnreadCountById}
            roomUnreadCountById={sidebarData.roomUnreadCountById}
            projectRunningMembersById={sidebarData.projectRunningMembersById}
            roomRunningMembersById={sidebarData.roomRunningMembersById}
            activeProjectId={project.id}
            activeRoomId={room.id}
            templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
            connected
            loading={false}
            onDeleteProject={vi.fn()}
            onDeleteRoom={vi.fn()}
            onToggleRoomWatcherSuspension={onToggleRoomWatcherSuspension}
            onDeleteTemplate={vi.fn()}
            onResizeStart={vi.fn()}
            onOpenTemplate={vi.fn()}
            onOpenTemplateStudio={vi.fn()}
          />
    );

    expect(screen.queryByText("Watch hold")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Resume watcher execution for ${room.name}` })).toHaveAttribute("data-variant", "secondary");

    await user.click(screen.getByRole("button", { name: `Resume watcher execution for ${room.name}` }));

    expect(onToggleRoomWatcherSuspension).toHaveBeenCalledWith(room.id);
  });

  it("shows watcher pause-until-activity separately from room-level watch hold", () => {
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
            collapsed={false}
            projects={sidebarData.projects}
            roomsByProject={sidebarData.roomsByProject}
            projectActivityById={sidebarData.projectActivityById}
            roomActivityById={sidebarData.roomActivityById}
            roomWatcherPauseById={{
              [room.id]: {
                enabledCount: 1,
                pausedUntilActivityCount: 1,
              },
            }}
            projectUnreadCountById={sidebarData.projectUnreadCountById}
            roomUnreadCountById={sidebarData.roomUnreadCountById}
            projectRunningMembersById={sidebarData.projectRunningMembersById}
            roomRunningMembersById={sidebarData.roomRunningMembersById}
            activeProjectId={project.id}
            activeRoomId={room.id}
            templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
            connected
            loading={false}
            onDeleteProject={vi.fn()}
            onDeleteRoom={vi.fn()}
            onDeleteTemplate={vi.fn()}
            onResizeStart={vi.fn()}
            onOpenTemplate={vi.fn()}
            onOpenTemplateStudio={vi.fn()}
          />
    );

    expect(screen.getByLabelText("Watcher paused until activity")).toBeInTheDocument();
    expect(screen.queryByText("Watch hold")).not.toBeInTheDocument();
  });

  it("preserves the active focus ring when a room is running", () => {
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const project = snapshot.projects[projectId];
    const room = snapshot.rooms[roomId];
    if (!project || !room) {
      throw new Error("Expected seeded project and room");
    }

    const firstTaskId = Object.keys(snapshot.tasks)[0];
    const entryMember = snapshot.members[room.entryMemberId];
    if (!firstTaskId || !entryMember) {
      throw new Error("Expected seeded task and entry member");
    }

    snapshot.tasks[firstTaskId] = {
      ...snapshot.tasks[firstTaskId],
      status: "running",
    };
    snapshot.members[room.entryMemberId] = {
      ...entryMember,
      status: "running",
    };

    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
            collapsed={false}
            projects={sidebarData.projects}
            roomsByProject={sidebarData.roomsByProject}
            projectActivityById={sidebarData.projectActivityById}
            roomActivityById={sidebarData.roomActivityById}
            projectUnreadCountById={sidebarData.projectUnreadCountById}
            roomUnreadCountById={sidebarData.roomUnreadCountById}
            projectRunningMembersById={sidebarData.projectRunningMembersById}
            roomRunningMembersById={sidebarData.roomRunningMembersById}
            activeProjectId={project.id}
            activeRoomId={room.id}
            templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
            connected
            loading={false}
            onDeleteProject={vi.fn()}
            onDeleteRoom={vi.fn()}
            onDeleteTemplate={vi.fn()}
            onResizeStart={vi.fn()}
            onOpenTemplate={vi.fn()}
            onOpenTemplateStudio={vi.fn()}
          />
    );

    const roomCard = screen.getByText(room.name).closest("div.rounded-xl");
    expect(roomCard).toBeTruthy();
    expect(roomCard).toHaveClass("border-[color:var(--tone-blueprint-border)]/75");
    expect(roomCard).toHaveClass("bg-[color:var(--tone-blueprint-surface)]/70");
    expect(roomCard).toHaveClass("ring-1");
    expect(roomCard).toHaveClass("ring-ring");
  });

  it("keeps sidebar running badges on the shared compact spec", () => {
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const room = snapshot.rooms[roomId];
    if (!room) {
      throw new Error("Expected seeded room");
    }

    const firstTaskId = Object.keys(snapshot.tasks)[0];
    const entryMember = snapshot.members[room.entryMemberId];
    if (!firstTaskId || !entryMember) {
      throw new Error("Expected seeded task and entry member");
    }

    snapshot.tasks[firstTaskId] = {
      ...snapshot.tasks[firstTaskId],
      status: "running",
    };
    snapshot.members[room.entryMemberId] = {
      ...entryMember,
      status: "running",
    };

    const sidebarData = buildSidebarViewState(snapshot);

    renderSidebar(
      <Sidebar
            collapsed={false}
            projects={sidebarData.projects}
            roomsByProject={sidebarData.roomsByProject}
            projectActivityById={sidebarData.projectActivityById}
            roomActivityById={sidebarData.roomActivityById}
            projectUnreadCountById={sidebarData.projectUnreadCountById}
            roomUnreadCountById={sidebarData.roomUnreadCountById}
            projectRunningMembersById={sidebarData.projectRunningMembersById}
            roomRunningMembersById={sidebarData.roomRunningMembersById}
            activeProjectId={projectId}
            activeRoomId={roomId}
            templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
            connected
            loading={false}
            onDeleteProject={vi.fn()}
            onDeleteRoom={vi.fn()}
            onDeleteTemplate={vi.fn()}
            onResizeStart={vi.fn()}
            onOpenTemplate={vi.fn()}
            onOpenTemplateStudio={vi.fn()}
          />
    );

    screen.getAllByText(/running|ready/i)
      .map((element) => element.closest("[data-slot='badge']"))
      .filter((badge): badge is HTMLElement => badge instanceof HTMLElement)
      .forEach((badge) => {
        expect(badge).toHaveClass("h-6");
        expect(badge).not.toHaveClass("h-7");
      });
  });

  it("opens members from a room running hover card without the room link swallowing the click", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    const roomId = snapshot.selection.roomId;
    if (!projectId || !roomId) {
      throw new Error("Expected seeded project and room ids");
    }

    const room = snapshot.rooms[roomId];
    const project = snapshot.projects[projectId];
    const runningMember = room ? snapshot.members[room.entryMemberId] : undefined;
    if (!room || !project || !runningMember) {
      throw new Error("Expected seeded project, room, and member");
    }

    snapshot.members[runningMember.id] = {
      ...runningMember,
      status: "running",
    };
    const sidebarData = buildSidebarViewState(snapshot);
    const onOpenMember = vi.fn();

    renderSidebar(
      <Sidebar
            collapsed={false}
            projects={sidebarData.projects}
            roomsByProject={sidebarData.roomsByProject}
            projectActivityById={sidebarData.projectActivityById}
            roomActivityById={sidebarData.roomActivityById}
            projectUnreadCountById={sidebarData.projectUnreadCountById}
            roomUnreadCountById={sidebarData.roomUnreadCountById}
            projectRunningMembersById={{ [project.id]: [] }}
            roomRunningMembersById={{
              [room.id]: [
                {
                  roomId: room.id,
                  memberId: runningMember.id,
                  memberName: runningMember.name,
                  memberHandle: runningMember.handle,
                  latestContentPreview: "最新一条运行摘要",
                },
              ],
            }}
            activeProjectId={project.id}
            activeRoomId={room.id}
            templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
            connected
            loading={false}
            onDeleteProject={vi.fn()}
            onDeleteRoom={vi.fn()}
            onDeleteTemplate={vi.fn()}
            onResizeStart={vi.fn()}
            onOpenMember={onOpenMember}
            onOpenTemplate={vi.fn()}
            onOpenTemplateStudio={vi.fn()}
          />
    );

    const roomCard = screen.getByText(room.name).closest("div.rounded-xl");
    if (!roomCard) {
      throw new Error("Expected room card");
    }

    const runningTrigger = roomCard.querySelector('[aria-label="Show running members"]');
    if (!(runningTrigger instanceof HTMLElement)) {
      throw new Error("Expected running trigger");
    }

    await user.hover(runningTrigger);
    await user.click(await screen.findByRole("button", { name: /@lead/i }));

    expect(onOpenMember).toHaveBeenCalledWith(project.id, room.id, runningMember.id);
  });
});
