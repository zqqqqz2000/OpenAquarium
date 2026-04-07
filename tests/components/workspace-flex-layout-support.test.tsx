import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { Actions, DockLocation } from "flexlayout-react";
import { MessageSquare, Users } from "lucide-react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID,
  WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
  WorkspaceFlexLayoutSupport,
  allowWorkspaceFlexLayoutDrop,
  buildWorkspaceFlexLayoutModelJson,
  createWorkspaceFlexLayoutFactory,
  createWorkspaceFlexLayoutMetadata,
  createWorkspaceFlexLayoutModel,
  createWorkspaceFlexLayoutTabRenderer,
  interceptWorkspaceFlexLayoutAction,
} from "@/components/chat/workspace-flex-layout-support";

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

describe("workspace flex layout support spike", () => {
  it("builds a primary chat tabset plus a right-side utility tabset", () => {
    const model = createWorkspaceFlexLayoutModel({ defaultActivePanelId: "chat" });
    const primaryTabset = model.getNodeById(WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID);
    const rightTabset = model.getNodeById(WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID);
    const primaryLayoutNode = buildWorkspaceFlexLayoutModelJson().layout.children[0];
    const rightLayoutNode = buildWorkspaceFlexLayoutModelJson().layout.children[1];
    const rightTabComponents = Array.isArray((rightLayoutNode as { children?: Array<{ component?: string }> } | undefined)?.children)
      ? ((rightLayoutNode as { children: Array<{ component?: string }> }).children.map((child) => child.component))
      : [];
    const primaryTabComponents = Array.isArray((primaryLayoutNode as { children?: Array<{ component?: string }> } | undefined)?.children)
      ? ((primaryLayoutNode as { children: Array<{ component?: string }> }).children.map((child) => child.component))
      : [];

    expect(primaryTabset?.getType()).toBe("tabset");
    expect(primaryTabset?.getChildren()).toHaveLength(1);
    expect(rightTabset?.getType()).toBe("tabset");
    expect(rightTabset?.getChildren()).toHaveLength(3);
    expect(primaryLayoutNode?.type).toBe("tabset");
    expect(rightLayoutNode?.type).toBe("tabset");
    expect((rightLayoutNode as { enableTabWrap?: boolean }).enableTabWrap).toBe(true);
    expect(primaryTabComponents).toEqual(["workspace-primary"]);
    expect(rightTabComponents).toEqual([
      "members",
      "todo",
      "dashboard",
    ]);
  });

  it("maps node.getComponent to primary content and right panel content", () => {
    const model = createWorkspaceFlexLayoutModel({ defaultActivePanelId: "members" });
    const factory = createWorkspaceFlexLayoutFactory({
      primaryContent: <div data-testid="primary-content">primary</div>,
      panels: {
        chat: { title: "Chat", icon: MessageSquare, content: <div data-testid="chat-content">chat</div> },
        members: { title: "Members", icon: Users, content: <div data-testid="members-content">members</div> },
        todo: { title: "Todo", content: <div data-testid="todo-content">todo</div> },
        dashboard: { title: "Dashboard", content: <div data-testid="dashboard-content">dashboard</div> },
      },
    });

    const primaryNode = model.getNodeById("workspace-primary-tab") as Parameters<typeof factory>[0];
    const membersNode = model.getNodeById("workspace-members-tab") as Parameters<typeof factory>[0];

    render(
      <>
        {factory(primaryNode)}
        {factory(membersNode)}
      </>,
    );

    expect(screen.getByTestId("primary-content")).toBeInTheDocument();
    expect(screen.getByTestId("members-content")).toBeInTheDocument();
  });

  it("customizes tab headers and renders workspace plus right-side tabs", () => {
    const panels = {
      chat: { title: "Chat", icon: MessageSquare, content: <div data-testid="chat-panel-body">chat body</div> },
      members: { title: "Members", icon: Users, content: <div data-testid="members-panel-body">members body</div>, badge: <span>4</span> },
      todo: { title: "Todo", content: <div data-testid="todo-panel-body">todo body</div> },
      dashboard: { title: "Dashboard", content: <div data-testid="dashboard-panel-body">dashboard body</div> },
    };
    const metadata = createWorkspaceFlexLayoutMetadata(panels, "Workspace");
    const tabRenderer = createWorkspaceFlexLayoutTabRenderer(metadata);
    const model = createWorkspaceFlexLayoutModel({ defaultActivePanelId: "chat" });
    const membersNode = model.getNodeById("workspace-members-tab");
    const renderValues = { leading: undefined, content: "members", buttons: [] as ReactNode[] };

    tabRenderer(membersNode as Parameters<typeof tabRenderer>[0], renderValues);

    render(
      <>
        <div data-testid="custom-tab-leading">{renderValues.leading}</div>
        <div data-testid="custom-tab-content">{renderValues.content}</div>
        <WorkspaceFlexLayoutSupport primaryContent={<div>primary content</div>} panels={panels} />
      </>,
    );

    expect(screen.getByTestId("custom-tab-leading").querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("custom-tab-content")).toHaveTextContent("Members");
    expect(screen.getByTestId("custom-tab-content")).toHaveTextContent("4");
    expect(screen.getByTestId("workspace-flex-layout-support")).toBeInTheDocument();
    expect(screen.getAllByText("Workspace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Members").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Todo").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("allows non-border drops so the utility panes can split freely", () => {
    const model = createWorkspaceFlexLayoutModel({ defaultActivePanelId: "dashboard" });
    const dashboardTab = model.getNodeById("workspace-dashboard-tab");
    const rightTabset = model.getNodeById(WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID);
    const primaryTabset = model.getNodeById(WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID);
    const borderNode = { getType: () => "border" };

    expect(
      allowWorkspaceFlexLayoutDrop({
        dragNode: dashboardTab!,
        dropInfo: { index: 1, location: DockLocation.CENTER, node: rightTabset! } as never,
      }),
    ).toBe(true);
    expect(
      allowWorkspaceFlexLayoutDrop({
        dragNode: dashboardTab!,
        dropInfo: { index: -1, location: DockLocation.CENTER, node: rightTabset! } as never,
      }),
    ).toBe(true);
    expect(
      allowWorkspaceFlexLayoutDrop({
        dragNode: dashboardTab!,
        dropInfo: { index: 0, location: DockLocation.CENTER, node: primaryTabset! } as never,
      }),
    ).toBe(true);
    expect(
      allowWorkspaceFlexLayoutDrop({
        dragNode: dashboardTab!,
        dropInfo: { index: 0, location: DockLocation.LEFT, node: borderNode } as never,
      }),
    ).toBe(false);
    expect(
      interceptWorkspaceFlexLayoutAction({
        action: Actions.moveNode("workspace-dashboard-tab", WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID, DockLocation.CENTER, 1),
        model,
      }),
    ).toBeDefined();
    expect(
      interceptWorkspaceFlexLayoutAction({
        action: Actions.moveNode("workspace-dashboard-tab", WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID, DockLocation.CENTER, -1),
        model,
      }),
    ).toBeDefined();
    expect(
      interceptWorkspaceFlexLayoutAction({
        action: Actions.moveNode("workspace-dashboard-tab", WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID, DockLocation.CENTER, 0),
        model,
      }),
    ).toBeDefined();
  });
});
