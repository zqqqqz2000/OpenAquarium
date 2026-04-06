import { createElement, isValidElement, useMemo, type ElementType, type ReactNode } from "react";

import type { LucideIcon } from "lucide-react";
import {
  Actions,
  Layout,
  Model,
  type Action,
  type DropInfo,
  type IJsonModel,
  type ITabRenderValues,
  type Node,
  type TabNode,
} from "flexlayout-react";

import { cn } from "@/lib/utils";

export type WorkspaceFlexLayoutPanelId = "chat" | "members" | "todo" | "dashboard";

type PanelIcon = LucideIcon | ReactNode;

export interface WorkspaceFlexLayoutSupportPanel {
  badge?: ReactNode;
  content: ReactNode;
  icon?: PanelIcon;
  title: string;
}

interface WorkspaceFlexLayoutModelOptions {
  defaultActivePanelId?: WorkspaceFlexLayoutPanelId;
  primaryTabTitle?: string;
  rightTabsetWidth?: number;
}

interface WorkspaceFlexLayoutMetadata {
  badge?: ReactNode;
  icon?: ReactNode;
  title: string;
}

export const WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT = "workspace-primary";
export const WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID = "workspace-primary-tabset";
export const WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID = "workspace-primary-tab";
export const WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID = "workspace-right-tabset";

export const workspaceFlexLayoutRightPanelOrder: WorkspaceFlexLayoutPanelId[] = [
  "chat",
  "members",
  "todo",
  "dashboard",
];

function renderPanelIcon(icon?: PanelIcon): ReactNode {
  if (!icon) {
    return undefined;
  }

  if (isValidElement(icon)) {
    return icon;
  }

  if (typeof icon === "string" || typeof icon === "number") {
    return icon;
  }

  return createElement(icon as ElementType, { size: 14, "aria-hidden": true });
}

function getWorkspacePanelComponent(node: Node): WorkspaceFlexLayoutPanelId | undefined {
  if (node.getType() !== "tab") {
    return undefined;
  }

  const component = (node as TabNode).getComponent();
  return workspaceFlexLayoutRightPanelOrder.includes(component as WorkspaceFlexLayoutPanelId)
    ? (component as WorkspaceFlexLayoutPanelId)
    : undefined;
}

function isWorkspaceRightTabMoveAction(action: Action, model: Model): boolean {
  if (action.type !== Actions.MOVE_NODE) {
    return false;
  }

  const fromNodeId = typeof action.data.fromNode === "string" ? action.data.fromNode : undefined;
  const toNodeId = typeof action.data.toNode === "string" ? action.data.toNode : undefined;
  const location = typeof action.data.location === "string" ? action.data.location : undefined;
  const index = typeof action.data.index === "number" ? action.data.index : -1;

  if (!fromNodeId || !toNodeId || location !== "center" || index < 0) {
    return false;
  }

  const fromNode = model.getNodeById(fromNodeId);
  const toNode = model.getNodeById(toNodeId);
  const fromParent = fromNode?.getParent();

  return Boolean(
    fromNode
      && getWorkspacePanelComponent(fromNode) !== undefined
      && fromParent?.getId() === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID
      && toNode?.getId() === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
  );
}

export function allowWorkspaceFlexLayoutDrop(args: {
  dragNode: Node;
  dropInfo: DropInfo;
}): boolean {
  const { dragNode, dropInfo } = args;
  const dragPanelId = getWorkspacePanelComponent(dragNode);

  if (!dragPanelId) {
    return false;
  }

  return (
    dragNode.getParent()?.getId() === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID
    && dropInfo.node.getType() === "tabset"
    && dropInfo.location.getName() === "center"
    && dropInfo.node.getId() === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID
    && dropInfo.index >= 0
  );
}

export function interceptWorkspaceFlexLayoutAction(args: {
  action: Action;
  model: Model;
}): Action | undefined {
  const { action, model } = args;

  if (action.type !== Actions.MOVE_NODE) {
    return action;
  }

  return isWorkspaceRightTabMoveAction(action, model) ? action : undefined;
}

export function configureWorkspaceFlexLayoutModel(model: Model): Model {
  model.setOnAllowDrop((dragNode, dropInfo) => allowWorkspaceFlexLayoutDrop({ dragNode, dropInfo }));
  return model;
}

export function buildWorkspaceFlexLayoutModelJson(
  options: WorkspaceFlexLayoutModelOptions = {},
): IJsonModel {
  const {
    defaultActivePanelId = "chat",
    primaryTabTitle = "Workspace",
    rightTabsetWidth,
  } = options;
  const selectedIndex = Math.max(0, workspaceFlexLayoutRightPanelOrder.indexOf(defaultActivePanelId));

  return {
    global: {
      enableEdgeDock: false,
      splitterEnableHandle: true,
      tabEnableClose: false,
      tabSetEnableDivide: false,
      tabSetEnableDrag: false,
      tabSetEnableClose: false,
      tabSetEnableDrop: false,
    },
    borders: [],
    layout: {
      type: "row",
      weight: 100,
      children: [
        {
          type: "tabset",
          id: WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID,
          weight: 68,
          enableDivide: false,
          enableDrag: false,
          enableDrop: false,
          selected: 0,
          children: [
            {
              type: "tab",
              id: WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID,
              name: primaryTabTitle,
              component: WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT,
              enableClose: false,
              enableDrag: false,
            },
          ],
        },
        {
          type: "tabset",
          id: WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
          weight: 32,
          enableDivide: false,
          enableDrag: false,
          enableDrop: true,
          enableTabWrap: true,
          minWidth: rightTabsetWidth,
          maxWidth: rightTabsetWidth,
          selected: selectedIndex,
          children: workspaceFlexLayoutRightPanelOrder.map((panelId) => ({
            type: "tab",
            id: `workspace-${panelId}-tab`,
            name: panelId,
            component: panelId,
            enableClose: false,
            enableDrag: true,
          })),
        },
      ],
    },
  };
}

export function createWorkspaceFlexLayoutModel(
  options: WorkspaceFlexLayoutModelOptions = {},
): Model {
  return configureWorkspaceFlexLayoutModel(Model.fromJson(buildWorkspaceFlexLayoutModelJson(options)));
}

export function createWorkspaceFlexLayoutMetadata(
  panels: Record<WorkspaceFlexLayoutPanelId, WorkspaceFlexLayoutSupportPanel>,
  primaryTabTitle = "Workspace",
): Record<string, WorkspaceFlexLayoutMetadata> {
  return {
    [WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT]: {
      title: primaryTabTitle,
    },
    ...Object.fromEntries(
      workspaceFlexLayoutRightPanelOrder.map((panelId) => [
        panelId,
        {
          title: panels[panelId].title,
          icon: renderPanelIcon(panels[panelId].icon),
          badge: panels[panelId].badge,
        },
      ]),
    ),
  };
}

export function createWorkspaceFlexLayoutFactory(args: {
  panels: Record<WorkspaceFlexLayoutPanelId, WorkspaceFlexLayoutSupportPanel>;
  primaryContent: ReactNode;
}): (node: TabNode) => ReactNode {
  const { panels, primaryContent } = args;

  return (node: TabNode): ReactNode => {
    const component = node.getComponent();

    if (component === WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT) {
      return primaryContent;
    }

    if (!component || !workspaceFlexLayoutRightPanelOrder.includes(component as WorkspaceFlexLayoutPanelId)) {
      return null;
    }

    return panels[component as WorkspaceFlexLayoutPanelId]?.content ?? null;
  };
}

export function createWorkspaceFlexLayoutTabRenderer(
  metadataByComponent: Record<string, WorkspaceFlexLayoutMetadata>,
): (node: TabNode, renderValues: ITabRenderValues) => void {
  return (node: TabNode, renderValues: ITabRenderValues): void => {
    const metadata = metadataByComponent[node.getComponent() ?? ""];
    if (!metadata) {
      return;
    }

    renderValues.leading = metadata.icon ?? renderValues.leading;
    renderValues.content = (
      <span className="inline-flex items-center gap-2">
        <span>{metadata.title}</span>
        {metadata.badge ? <span className="shrink-0">{metadata.badge}</span> : null}
      </span>
    );
  };
}

export function WorkspaceFlexLayoutSupport(props: {
  className?: string;
  defaultActivePanelId?: WorkspaceFlexLayoutPanelId;
  panels: Record<WorkspaceFlexLayoutPanelId, WorkspaceFlexLayoutSupportPanel>;
  primaryContent: ReactNode;
  primaryTabTitle?: string;
}) {
  const {
    className,
    defaultActivePanelId = "chat",
    panels,
    primaryContent,
    primaryTabTitle = "Workspace",
  } = props;
  const model = useMemo(
    () => createWorkspaceFlexLayoutModel({ defaultActivePanelId, primaryTabTitle }),
    [defaultActivePanelId, primaryTabTitle],
  );
  const metadataByComponent = useMemo(
    () => createWorkspaceFlexLayoutMetadata(panels, primaryTabTitle),
    [panels, primaryTabTitle],
  );
  const factory = useMemo(
    () => createWorkspaceFlexLayoutFactory({ panels, primaryContent }),
    [panels, primaryContent],
  );
  const onRenderTab = useMemo(
    () => createWorkspaceFlexLayoutTabRenderer(metadataByComponent),
    [metadataByComponent],
  );

  return (
    <div
      data-testid="workspace-flex-layout-support"
      className={cn(
        "flexlayout__theme_light dark:flexlayout__theme_dark h-full min-h-[24rem] min-w-0 overflow-hidden",
        className,
      )}
    >
      <Layout
        model={model}
        factory={factory}
        onAction={(action) => interceptWorkspaceFlexLayoutAction({ action, model })}
        onRenderTab={onRenderTab}
      />
    </div>
  );
}
