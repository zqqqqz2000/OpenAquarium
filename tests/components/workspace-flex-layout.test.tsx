import { render, screen } from "@testing-library/react";
import { MessageSquare, Users, FolderKanban, BarChart3 } from "lucide-react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceFlexLayout } from "@/components/chat/workspace-flex-layout";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

describe("WorkspaceFlexLayout", () => {
  it("renders desktop layout with FlexLayout and one right-side tabset", () => {
    const { container } = render(
      <WorkspaceFlexLayout
        collapsed={false}
        layoutKey="room-a"
        panelWidth={420}
        panels={{
          chat: {
            id: "chat",
            title: "Chat",
            icon: MessageSquare,
            content: <div>chat content</div>,
          },
          members: {
            id: "members",
            title: "Members",
            icon: Users,
            content: <div>members content</div>,
          },
          todo: {
            id: "todo",
            title: "Todo",
            icon: FolderKanban,
            content: <div>todo content</div>,
          },
          dashboard: {
            id: "dashboard",
            title: "Dashboard",
            icon: BarChart3,
            content: <div>dashboard content</div>,
          },
        }}
      />,
    );

    expect(screen.getByTestId("workspace-flex-layout")).toBeInTheDocument();
    expect(container.querySelector(".flexlayout__layout")).not.toBeNull();
    expect(container.querySelectorAll(".flexlayout__tabset").length).toBe(2);
    expect(screen.getAllByText("Chat").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Members").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });
});