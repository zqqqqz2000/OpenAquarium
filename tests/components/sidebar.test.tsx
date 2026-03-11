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
  ThemeToggle: () => <div data-testid="theme-toggle" />,
}));

import { Sidebar } from "@/components/layout/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { AppThemeProvider } from "@/theme/theme-provider";

describe("Sidebar", () => {
  it("keeps templates collapsed by default and scrolls the expanded list", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    render(
      <AppThemeProvider>
        <TooltipProvider>
          <Sidebar
            collapsed={false}
            projects={[]}
            roomsByProject={{}}
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
        </TooltipProvider>
      </AppThemeProvider>,
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

    render(
      <AppThemeProvider>
        <TooltipProvider>
          <Sidebar
            collapsed={false}
            projects={project ? [project] : []}
            roomsByProject={project ? { [project.id]: [room] } : {}}
            templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
            connected
            loading={false}
            onDeleteProject={onDeleteProject}
            onDeleteRoom={onDeleteRoom}
            onDeleteTemplate={onDeleteTemplate}
            onResizeStart={vi.fn()}
            onOpenTemplate={vi.fn()}
            onOpenTemplateStudio={vi.fn()}
          />
        </TooltipProvider>
      </AppThemeProvider>,
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

    render(
      <AppThemeProvider>
        <TooltipProvider>
          <Sidebar
            collapsed={false}
            projects={[project]}
            roomsByProject={{ [project.id]: [longRoom] }}
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
        </TooltipProvider>
      </AppThemeProvider>,
    );

    const roomLink = screen.getByText(longRoom.name).closest("a");
    if (!roomLink) {
      throw new Error("Expected room link");
    }

    const roomTextBlock = roomLink.querySelector("span.min-w-0.flex-1");
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
});
