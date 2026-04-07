import {
  useEffect,
  useMemo,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import type { LucideIcon } from "lucide-react";
import {
  Layout,
  Model,
  type Action,
  type IJsonModel,
  type IJsonRowNode,
  type IJsonTabNode,
  type IJsonTabSetNode,
  type ITabRenderValues,
  type TabNode,
  type TabSetNode,
} from "flexlayout-react";

import { cn } from "@/lib/utils";
import {
  WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT,
  WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID,
  WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
  buildWorkspaceFlexLayoutModelJson,
  configureWorkspaceFlexLayoutModel,
  interceptWorkspaceFlexLayoutAction,
  sanitizeWorkspaceFlexLayoutModelJson,
  workspaceFlexLayoutPanelOrder,
  workspaceFlexLayoutRightPanelOrder,
} from "@/components/chat/workspace-flex-layout-support";

export type WorkspacePanelId = "projects" | "chat" | "members" | "todo" | "dashboard";

interface WorkspacePanelDefinition {
  badge?: ReactNode;
  content: ReactNode;
  icon: LucideIcon;
  id: WorkspacePanelId;
  title: string;
}

const workspaceActivePanelIdByKey = new Map<string, WorkspacePanelId>();
const workspaceDesktopModelJsonByKey = new Map<string, IJsonModel>();

function useMediaQuery(query: string): boolean {
  const getMatches = (): boolean => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }

    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(query);
    const handleChange = (): void => {
      setMatches(mediaQueryList.matches);
    };

    handleChange();
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

function isWorkspacePanelId(value: string | undefined): value is WorkspacePanelId {
  return workspaceFlexLayoutPanelOrder.includes(value as WorkspacePanelId);
}

function renderFlexLayoutTabContent(panel: WorkspacePanelDefinition): ReactNode {
  return (
    <div
      data-workspace-panel-id={panel.id}
      className="h-full min-h-0 min-w-0 overflow-hidden bg-card"
    >
      {panel.content}
    </div>
  );
}

function cloneModelJson(modelJson: IJsonModel): IJsonModel {
  return JSON.parse(JSON.stringify(modelJson)) as IJsonModel;
}

type WorkspaceFlexLayoutJsonNode = IJsonRowNode | IJsonTabSetNode | IJsonTabNode;

function isWorkspaceFlexLayoutTabNode(
  node: WorkspaceFlexLayoutJsonNode | undefined,
): node is IJsonTabNode {
  return node?.type === "tab";
}

function isWorkspaceFlexLayoutTabSetNode(
  node: WorkspaceFlexLayoutJsonNode | undefined,
): node is IJsonTabSetNode {
  return node?.type === "tabset";
}

function updateWorkspaceFlexLayoutJsonNodePresentation(args: {
  node: WorkspaceFlexLayoutJsonNode | undefined;
  primaryTabTitle: string;
}): void {
  const { node, primaryTabTitle } = args;

  if (!node) {
    return;
  }

  if (isWorkspaceFlexLayoutTabNode(node)) {
    if (
      node.id === WORKSPACE_FLEXLAYOUT_PRIMARY_TAB_ID
      || node.component === WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT
      || node.component === "chat"
    ) {
      node.name = primaryTabTitle;
    }

    return;
  }

  if (isWorkspaceFlexLayoutTabSetNode(node) && node.id === WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID) {
    delete node.minWidth;
    delete node.maxWidth;
  }

  if (!isWorkspaceFlexLayoutTabSetNode(node) && node.type !== "row") {
    return;
  }

  if (!Array.isArray(node.children)) {
    return;
  }

  node.children.forEach((child) => {
    updateWorkspaceFlexLayoutJsonNodePresentation({
      node: child as WorkspaceFlexLayoutJsonNode,
      primaryTabTitle,
    });
  });
}

export function updateWorkspaceFlexLayoutModelJsonPresentation(args: {
  modelJson: IJsonModel;
  primaryTabTitle: string;
}): IJsonModel {
  const { modelJson, primaryTabTitle } = args;
  const nextModelJson = cloneModelJson(modelJson);

  updateWorkspaceFlexLayoutJsonNodePresentation({
    node: nextModelJson.layout,
    primaryTabTitle,
  });

  return sanitizeWorkspaceFlexLayoutModelJson({
    modelJson: nextModelJson,
    primaryTabTitle,
  });
}

function createWorkspaceDesktopModel(args: {
  activePanelId: WorkspacePanelId;
  leftCollapsed: boolean;
  leftPanelWidth: number;
  modelJson?: IJsonModel;
  primaryTabTitle: string;
  rightCollapsed: boolean;
  rightPanelWidth: number;
}): Model {
  const {
    activePanelId,
    leftCollapsed,
    leftPanelWidth,
    modelJson,
    primaryTabTitle,
    rightCollapsed,
    rightPanelWidth,
  } = args;
  const nextModelJson = sanitizeWorkspaceFlexLayoutModelJson({
    modelJson: modelJson ?? buildWorkspaceFlexLayoutModelJson({
      defaultActivePanelId: activePanelId,
      includeProjectsPanel: !leftCollapsed,
      includeRightPanel: !rightCollapsed,
      leftTabsetWidth: leftPanelWidth,
      primaryTabTitle,
      rightTabsetWidth: rightPanelWidth,
    }),
    includeProjectsPanel: !leftCollapsed,
    includeRightPanel: !rightCollapsed,
    leftTabsetWidth: leftPanelWidth,
    primaryTabTitle,
    rightTabsetWidth: rightPanelWidth,
  });

  return configureWorkspaceFlexLayoutModel(Model.fromJson(nextModelJson));
}

export function WorkspaceFlexLayout(props: {
  layoutKey: string;
  leftCollapsed: boolean;
  leftPanelWidth?: number;
  onRightResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  panels: Record<WorkspacePanelId, WorkspacePanelDefinition>;
  rightCollapsed: boolean;
  rightPanelWidth?: number;
}) {
  const {
    layoutKey,
    leftCollapsed,
    leftPanelWidth = 304,
    onRightResizeStart,
    panels,
    rightCollapsed,
    rightPanelWidth = 372,
  } = props;
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [activePanelId, setActivePanelId] = useState<WorkspacePanelId>(
    () => workspaceActivePanelIdByKey.get(layoutKey) ?? "chat",
  );
  const [model, setModel] = useState<Model>(() =>
    createWorkspaceDesktopModel({
      activePanelId: workspaceActivePanelIdByKey.get(layoutKey) ?? "chat",
      leftCollapsed,
      leftPanelWidth,
      modelJson: workspaceDesktopModelJsonByKey.get(layoutKey),
      primaryTabTitle: panels.chat.title,
      rightCollapsed,
      rightPanelWidth,
    }),
  );

  useEffect(() => {
    setActivePanelId(workspaceActivePanelIdByKey.get(layoutKey) ?? "chat");
    setModel(
      createWorkspaceDesktopModel({
        activePanelId: workspaceActivePanelIdByKey.get(layoutKey) ?? "chat",
        leftCollapsed,
        leftPanelWidth,
        modelJson: workspaceDesktopModelJsonByKey.get(layoutKey),
        primaryTabTitle: panels.chat.title,
        rightCollapsed,
        rightPanelWidth,
      }),
    );
  }, [layoutKey, leftCollapsed, leftPanelWidth, panels.chat.title, rightCollapsed, rightPanelWidth]);

  useEffect(() => {
    workspaceActivePanelIdByKey.set(layoutKey, activePanelId);
  }, [activePanelId, layoutKey]);

  const orderedMobilePanels = useMemo(
    () => (rightCollapsed ? (["chat"] satisfies WorkspacePanelId[]) : (["chat", ...workspaceFlexLayoutRightPanelOrder] satisfies WorkspacePanelId[])),
    [rightCollapsed],
  );

  useEffect(() => {
    if (!orderedMobilePanels.includes(activePanelId)) {
      setActivePanelId(orderedMobilePanels[0] ?? "chat");
    }
  }, [activePanelId, orderedMobilePanels]);

  const factory = useMemo(
    () =>
      (node: TabNode): ReactNode => {
        const component = node.getComponent();

        if (component === WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT) {
          return renderFlexLayoutTabContent(panels.chat);
        }

        if (!isWorkspacePanelId(component)) {
          return null;
        }

        return renderFlexLayoutTabContent(panels[component]);
      },
    [panels],
  );
  const onRenderTab = useMemo(
    () =>
      (node: TabNode, renderValues: ITabRenderValues): void => {
        const component = node.getComponent();
        const panel = isWorkspacePanelId(component) ? panels[component] : undefined;

        if (!panel) {
          return;
        }

        renderValues.leading = <panel.icon aria-hidden size={14} />;
        renderValues.content = (
          <span className="workspace-flex-layout-tab-label inline-flex items-center gap-2">
            <span className="workspace-flex-layout-tab-title">{panel.title}</span>
            {panel.badge ? (
              <span className="workspace-flex-layout-tab-badge shrink-0">{panel.badge}</span>
            ) : null}
          </span>
        );
      },
    [panels],
  );
  const handleAction = useMemo(
    () =>
      (action: Action): Action | undefined => interceptWorkspaceFlexLayoutAction({ action, model }),
    [model],
  );

  const handleModelChange = (nextModel: Model): void => {
    workspaceDesktopModelJsonByKey.set(layoutKey, nextModel.toJson());

    const rightTabset = nextModel.getNodeById(WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID);
    if (rightTabset?.getType() !== "tabset") {
      return;
    }

    const selectedNode = (rightTabset as TabSetNode).getSelectedNode();
    const component = (selectedNode as TabNode | undefined)?.getComponent();

    if (isWorkspacePanelId(component)) {
      setActivePanelId(component);
    }
  };

  if (isMobile) {
    const activePanel = panels[activePanelId];

    return (
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="-mx-1 flex shrink-0 gap-0 overflow-x-auto px-1 pb-1">
          {orderedMobilePanels.map((panelId) => {
            const panel = panels[panelId];
            const Icon = panel.icon;
            const selected = panelId === activePanelId;
            const isFirstTab = panelId === orderedMobilePanels[0];

            return (
              <button
                key={panelId}
                type="button"
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 border-0 px-3 py-2 text-sm font-medium transition-colors",
                  isFirstTab ? "" : "border-l border-border/70",
                  selected
                    ? "bg-muted text-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
                onClick={() => setActivePanelId(panelId)}
              >
                <Icon size={16} />
                <span>{panel.title}</span>
              </button>
            );
          })}
        </div>
        <section
          data-workspace-panel-id={activePanel.id}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-sm"
        >
          <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <activePanel.icon size={16} />
              <p className="m-0 truncate text-sm font-semibold tracking-tight">{activePanel.title}</p>
            </div>
            {activePanel.badge ? <div className="shrink-0">{activePanel.badge}</div> : null}
          </header>
          <div className="min-h-0 flex-1 overflow-hidden p-3">{activePanel.content}</div>
        </section>
      </div>
    );
  }

  if (leftCollapsed && rightCollapsed) {
    return (
      <section
        data-workspace-panel-id={panels.chat.id}
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-sm"
      >
        <div className="min-h-0 flex-1 overflow-hidden p-3">{panels.chat.content}</div>
      </section>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 gap-3 overflow-hidden">
      <div
        data-testid="workspace-flex-layout"
        className={cn(
          "workspace-flex-layout-shell relative flexlayout__theme_light dark:flexlayout__theme_dark flex h-full min-h-0 min-w-0 flex-1 overflow-hidden border border-border/70 bg-card shadow-sm",
        )}
      >
        <Layout
          model={model}
          factory={factory}
          onAction={handleAction}
          onRenderTab={onRenderTab}
          onModelChange={handleModelChange}
        />
      </div>
      {!rightCollapsed ? (
        <div
          aria-hidden
          className="hidden w-4 shrink-0 cursor-col-resize xl:block"
          onPointerDown={onRightResizeStart}
        >
          <div className="h-full w-px rounded-full bg-border/80" />
        </div>
      ) : null}
    </div>
  );
}
