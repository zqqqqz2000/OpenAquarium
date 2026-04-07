import { createElement, isValidElement, useMemo, type ElementType, type ReactNode } from "react";

import type { LucideIcon } from "lucide-react";
import {
  Layout,
  Model,
  type Action,
  type DropInfo,
  type IJsonModel,
  type IJsonRowNode,
  type IJsonTabNode,
  type IJsonTabSetNode,
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

interface WorkspaceFlexLayoutSplitWeights {
  primary: number;
  right: number;
}

export const WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT = "workspace-primary";
export const WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID = "workspace-primary-tabset";
export const WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID = "workspace-primary-tab";
export const WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID = "workspace-right-tabset";

export const workspaceFlexLayoutPanelOrder: WorkspaceFlexLayoutPanelId[] = [
  "chat",
  "members",
  "todo",
  "dashboard",
];

export const workspaceFlexLayoutRightPanelOrder: WorkspaceFlexLayoutPanelId[] = [
  "members",
  "todo",
  "dashboard",
];

type WorkspaceFlexLayoutJsonNode = IJsonRowNode | IJsonTabSetNode | IJsonTabNode;

function buildWorkspaceFlexLayoutTabId(
  panelId: WorkspaceFlexLayoutPanelId,
): string {
  return panelId === "chat"
    ? WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID
    : `workspace-${panelId}-tab`;
}

function getWorkspaceFlexLayoutComponentForPanelId(
  panelId: WorkspaceFlexLayoutPanelId,
): string {
  return panelId === "chat" ? WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT : panelId;
}

export function getWorkspaceFlexLayoutPanelIdFromComponent(
  component: string | undefined,
): WorkspaceFlexLayoutPanelId | undefined {
  if (component === WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT || component === "chat") {
    return "chat";
  }

  return workspaceFlexLayoutRightPanelOrder.includes(component as WorkspaceFlexLayoutPanelId)
    ? (component as WorkspaceFlexLayoutPanelId)
    : undefined;
}

function buildWorkspaceFlexLayoutTabNode(
  panelId: WorkspaceFlexLayoutPanelId,
): IJsonTabNode {
  return {
    type: "tab",
    id: buildWorkspaceFlexLayoutTabId(panelId),
    name: panelId,
    component: getWorkspaceFlexLayoutComponentForPanelId(panelId),
    enableClose: false,
    enableDrag: true,
  };
}

function getWorkspaceFlexLayoutSplitWeights(
  rightTabsetWidth?: number,
): WorkspaceFlexLayoutSplitWeights {
  if (typeof rightTabsetWidth !== "number" || !Number.isFinite(rightTabsetWidth)) {
    return { primary: 68, right: 32 };
  }

  const clampedRightWidth = Math.min(520, Math.max(280, Math.round(rightTabsetWidth)));
  const primaryBaselineWidth = 780;
  const rightWeight = Math.min(
    45,
    Math.max(24, Math.round((clampedRightWidth / (primaryBaselineWidth + clampedRightWidth)) * 100)),
  );

  return {
    primary: 100 - rightWeight,
    right: rightWeight,
  };
}

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

  return getWorkspaceFlexLayoutPanelIdFromComponent((node as TabNode).getComponent());
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

  return dropInfo.node.getType() !== "border";
}

export function interceptWorkspaceFlexLayoutAction(args: {
  action: Action;
  model: Model;
}): Action | undefined {
  return args.action;
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
  const splitWeights = getWorkspaceFlexLayoutSplitWeights(rightTabsetWidth);

  return {
    global: {
      enableEdgeDock: true,
      splitterEnableHandle: true,
      tabEnableClose: false,
      tabSetEnableDeleteWhenEmpty: true,
      tabSetEnableDivide: true,
      tabSetEnableDrag: true,
      tabSetEnableClose: false,
      tabSetEnableDrop: true,
    },
    borders: [],
    layout: {
      type: "row",
      weight: 100,
      children: [
        {
          type: "tabset",
          id: WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID,
          weight: splitWeights.primary,
          enableDivide: true,
          enableDrag: true,
          enableDrop: true,
          selected: 0,
          children: [
            {
              ...buildWorkspaceFlexLayoutTabNode("chat"),
              name: primaryTabTitle,
            },
          ],
        },
        {
          type: "tabset",
          id: WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
          weight: splitWeights.right,
          enableDivide: true,
          enableDrag: true,
          enableDrop: true,
          enableTabWrap: true,
          selected: selectedIndex,
          children: workspaceFlexLayoutRightPanelOrder.map((panelId) =>
            buildWorkspaceFlexLayoutTabNode(panelId),
          ),
        },
      ],
    },
  };
}

function cloneWorkspaceFlexLayoutModelJson(modelJson: IJsonModel): IJsonModel {
  return JSON.parse(JSON.stringify(modelJson)) as IJsonModel;
}

function normalizeWorkspaceFlexLayoutJsonNode(
  node: WorkspaceFlexLayoutJsonNode | undefined,
  seenPanelIds: Set<WorkspaceFlexLayoutPanelId>,
): WorkspaceFlexLayoutJsonNode | undefined {
  if (!node) {
    return undefined;
  }

  if (node.type === "tab") {
    const panelId = getWorkspaceFlexLayoutPanelIdFromComponent(node.component);
    if (!panelId || seenPanelIds.has(panelId)) {
      return undefined;
    }

    seenPanelIds.add(panelId);
    return {
      ...node,
      id: buildWorkspaceFlexLayoutTabId(panelId),
      name: typeof node.name === "string" && node.name.length > 0 ? node.name : panelId,
      component: getWorkspaceFlexLayoutComponentForPanelId(panelId),
      enableClose: false,
      enableDrag: true,
    } satisfies IJsonTabNode;
  }

  if (node.type === "tabset") {
    const children = (node.children ?? [])
      .map((child) => normalizeWorkspaceFlexLayoutJsonNode(child, seenPanelIds))
      .filter((child): child is IJsonTabNode => child?.type === "tab");

    if (children.length === 0) {
      return undefined;
    }

    const selected = typeof node.selected === "number"
      ? Math.max(0, Math.min(node.selected, children.length - 1))
      : 0;

    return {
      ...node,
      type: "tabset",
      enableDivide: true,
      enableDrag: true,
      enableDrop: true,
      enableTabWrap: true,
      children,
      selected,
    } satisfies IJsonTabSetNode;
  }

  const children = (node.children ?? [])
    .map((child) => normalizeWorkspaceFlexLayoutJsonNode(child, seenPanelIds))
    .filter((child): child is IJsonRowNode | IJsonTabSetNode => (
      child?.type === "row" || child?.type === "tabset"
    ));

  if (children.length === 0) {
    return undefined;
  }

  return {
    ...node,
    type: "row",
    children,
  } satisfies IJsonRowNode;
}

function collectWorkspaceFlexLayoutTabsets(
  node: WorkspaceFlexLayoutJsonNode,
): IJsonTabSetNode[] {
  if (node.type === "tabset") {
    return [node];
  }

  if (node.type !== "row") {
    return [];
  }

  return node.children.flatMap((child) => collectWorkspaceFlexLayoutTabsets(child));
}

export function sanitizeWorkspaceFlexLayoutModelJson(args: {
  modelJson: IJsonModel;
  primaryTabTitle?: string;
  rightTabsetWidth?: number;
}): IJsonModel {
  const { modelJson, primaryTabTitle = "Workspace", rightTabsetWidth } = args;
  const seenPanelIds = new Set<WorkspaceFlexLayoutPanelId>();
  const splitWeights = getWorkspaceFlexLayoutSplitWeights(rightTabsetWidth);
  const normalizedLayout = normalizeWorkspaceFlexLayoutJsonNode(
    cloneWorkspaceFlexLayoutModelJson(modelJson).layout,
    seenPanelIds,
  );

  if (!normalizedLayout || normalizedLayout.type !== "row") {
    return buildWorkspaceFlexLayoutModelJson({
      primaryTabTitle,
      rightTabsetWidth,
    });
  }

  const nextModelJson: IJsonModel = {
    global: {
      enableEdgeDock: true,
      splitterEnableHandle: true,
      tabEnableClose: false,
      tabSetEnableDeleteWhenEmpty: true,
      tabSetEnableDivide: true,
      tabSetEnableDrag: true,
      tabSetEnableClose: false,
      tabSetEnableDrop: true,
      ...(modelJson.global ?? {}),
    },
    borders: Array.isArray(modelJson.borders) ? modelJson.borders : [],
    layout: normalizedLayout,
  };

  const tabsets = collectWorkspaceFlexLayoutTabsets(nextModelJson.layout);
  const primaryTabset = tabsets.find((tabset) => tabset.id === WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID)
    ?? tabsets[0];
  const rightTabset = tabsets.find((tabset) => tabset.id === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID)
    ?? tabsets.find((tabset) => tabset !== primaryTabset)
    ?? primaryTabset;

  if (!primaryTabset || !rightTabset) {
    return buildWorkspaceFlexLayoutModelJson({
      primaryTabTitle,
      rightTabsetWidth,
    });
  }

  workspaceFlexLayoutPanelOrder.forEach((panelId) => {
    if (seenPanelIds.has(panelId)) {
      return;
    }

    const targetTabset = panelId === "chat" ? primaryTabset : rightTabset;
    targetTabset.children = [
      ...targetTabset.children,
      buildWorkspaceFlexLayoutTabNode(panelId),
    ];
    seenPanelIds.add(panelId);
  });

  const primaryTab = primaryTabset.children.find(
    (child) => child.id === WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID,
  );
  if (primaryTab) {
    primaryTab.name = primaryTabTitle;
  }

  if (rightTabset.id === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID) {
    delete rightTabset.minWidth;
    delete rightTabset.maxWidth;
    rightTabset.weight = splitWeights.right;
  }

  if (primaryTabset.id === WORKSPACE_FLEXLAYOUT_PRIMARY_TABSET_ID) {
    primaryTabset.weight = splitWeights.primary;
  }

  return nextModelJson;
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
