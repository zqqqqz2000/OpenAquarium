import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageSquare, Users, FolderKanban, BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Model } from "flexlayout-react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkspaceFlexLayout,
  updateWorkspaceFlexLayoutModelJsonPresentation,
} from "@/components/chat/workspace-flex-layout";
import {
  WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID,
  WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
  buildWorkspaceFlexLayoutModelJson,
} from "@/components/chat/workspace-flex-layout-support";

function createMockDomRect(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
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
  it("removes fixed right-tabset width constraints from the persisted model json", () => {
    const modelJson = buildWorkspaceFlexLayoutModelJson({
      primaryTabTitle: "Chat",
      rightTabsetWidth: 420,
    });
    const rightTabset = modelJson.layout.children.find(
      (child) => child.type === "tabset" && child.id === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
    );

    if (rightTabset?.type !== "tabset") {
      throw new Error("Expected the right root child to be a tabset");
    }

    (rightTabset as { maxWidth?: number }).maxWidth = 420;
    const nextModelJson = updateWorkspaceFlexLayoutModelJsonPresentation({
      modelJson,
      primaryTabTitle: "Workspace Chat",
    });
    const nextRightTabset = nextModelJson.layout.children.find(
      (child) => child.type === "tabset" && child.id === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
    );
    const primaryTabset = nextModelJson.layout.children.find(
      (child) => child.type === "tabset" && child.id === WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID,
    );
    const primaryTab = primaryTabset?.type === "tabset"
      ? (primaryTabset.children?.[0] as { type?: string; name?: string } | undefined)
      : undefined;

    expect(nextRightTabset?.type).toBe("tabset");
    expect((nextRightTabset as { minWidth?: number }).minWidth).toBeUndefined();
    expect((nextRightTabset as { maxWidth?: number }).maxWidth).toBeUndefined();
    expect(primaryTab?.type).toBe("tab");
    expect(primaryTab?.name).toBe("Workspace Chat");
  });

  it("keeps the full desktop flexlayout visible even if collapsed flags are set", async () => {
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => createMockDomRect(1024, 768));

    const { container } = render(
      <WorkspaceFlexLayout
        layoutKey="room-a"
        leftCollapsed
        leftPanelWidth={304}
        rightCollapsed
        rightPanelWidth={420}
        panels={{
          projects: {
            id: "projects",
            title: "Projects",
            icon: FolderKanban,
            content: <div>projects content</div>,
          },
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

    try {
      expect(screen.getByTestId("workspace-flex-layout")).toBeInTheDocument();
      expect(screen.getByTestId("workspace-flex-layout")).toHaveClass("relative", "h-full");
      expect(container.querySelector(".flexlayout__layout")).not.toBeNull();
      expect(container.querySelectorAll(".flexlayout__tabset").length).toBe(3);
      expect(screen.getAllByText("Chat").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Projects").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Members").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
      await waitFor(() => {
        expect(screen.getByText("projects content")).toBeInTheDocument();
        expect(screen.getByText("chat content")).toBeInTheDocument();
        expect(screen.getByText("members content")).toBeInTheDocument();
      });
    } finally {
      getBoundingClientRectSpy.mockRestore();
    }
  });

  it("does not rebuild the desktop model when the right utility tab changes and the parent rerenders", async () => {
    const user = userEvent.setup();
    const getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(() => createMockDomRect(1024, 768));
    const modelFromJsonSpy = vi.spyOn(Model, "fromJson");
    const chatMountSpy = vi.fn();

    function ChatContent() {
      useEffect(() => {
        chatMountSpy();
      }, []);

      return <div>chat content</div>;
    }

    function Harness() {
      const [membersBadgeCount, setMembersBadgeCount] = useState(4);

      return (
        <>
          <button type="button" onClick={() => setMembersBadgeCount((current) => current + 1)}>
            rerender layout
          </button>
          <WorkspaceFlexLayout
            layoutKey="room-b"
            leftCollapsed={false}
            leftPanelWidth={304}
            rightCollapsed={false}
            rightPanelWidth={420}
            panels={{
              projects: {
                id: "projects",
                title: "Projects",
                icon: FolderKanban,
                content: <div>projects content</div>,
              },
              chat: {
                id: "chat",
                title: "Chat",
                icon: MessageSquare,
                content: <ChatContent />,
              },
              members: {
                id: "members",
                title: "Members",
                icon: Users,
                badge: <span>{membersBadgeCount}</span>,
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
          />
        </>
      );
    }

    const { container } = render(<Harness />);

    try {
      await waitFor(() => {
        expect(screen.getByText("chat content")).toBeInTheDocument();
      });
      expect(chatMountSpy).toHaveBeenCalledTimes(1);
      expect(modelFromJsonSpy).toHaveBeenCalledTimes(1);

      const todoTabButton = [...container.querySelectorAll(".flexlayout__tab_button")]
        .find((element) => element.textContent?.includes("Todo"));
      if (!(todoTabButton instanceof HTMLElement)) {
        throw new Error("Expected a Todo tab button");
      }

      await user.click(todoTabButton);
      await user.click(screen.getByRole("button", { name: "rerender layout" }));

      expect(chatMountSpy).toHaveBeenCalledTimes(1);
      expect(modelFromJsonSpy).toHaveBeenCalledTimes(1);
    } finally {
      modelFromJsonSpy.mockRestore();
      getBoundingClientRectSpy.mockRestore();
    }
  });
});
