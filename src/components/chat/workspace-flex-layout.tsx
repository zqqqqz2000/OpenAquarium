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
  type IJsonTabNode,
  type IJsonTabSetNode,
  type ITabRenderValues,
  type TabNode,
  type TabSetNode,
} from "flexlayout-react";

import { cn } from "@/lib/utils";
import {
  WORKSPACE_FLEXLAYOUT_PRIMARY_COMPONENT,
  WORKSPACE_FLEXLAYOUT_RIGHT_TABSET_ID,
  buildWorkspaceFlexLayoutModelJson,
  configureWorkspaceFlexLayoutModel,
  interceptWorkspaceFlexLayoutAction,
  workspaceFlexLayoutRightPanelOrder,
} from "@/components/chat/workspace-flex-layout-support";

export type WorkspacePanelId = "chat" | "members" | "todo" | "dashboard";

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
  return workspaceFlexLayoutRightPanelOrder.includes(value as WorkspacePanelId);
}

function renderFlexLayoutTabContent(panel: WorkspacePanelDefinition): ReactNode {
  return (
    <div
      data-workspace-panel-id={panel.id}
      className="h-full min-h-0 overflow-hidden bg-card"
    >
      {panel.content}
    </div>
  );
}

function cloneModelJson(modelJson: IJsonModel): IJsonModel {
  return JSON.parse(JSON.stringify(modelJson)) as IJsonModel;
}

function updateWorkspaceFlexLayoutModelJsonPresentation(args: {
  modelJson: IJsonModel;
  primaryTabTitle: string;
  rightTabsetWidth: number;
}): IJsonModel {
  const { modelJson, primaryTabTitle, rightTabsetWidth } = args;
  const nextModelJson = cloneModelJson(modelJson);
  const layoutChildren = nextModelJson.layout?.children;

  if (Array.isArray(layoutChildren)) {
    const primaryTabset = layoutChildren[0];
    const rightTabset = layoutChildren[1];

    if (primaryTabset?.type === "tabset" && Array.isArray(primaryTabset.children)) {
      const nextPrimaryTabset = primaryTabset as IJsonTabSetNode;
      const primaryTab = nextPrimaryTabset.children?.[0] as IJsonTabNode | undefined;
      if (primaryTab?.type === "tab") {
        primaryTab.name = primaryTabTitle;
      }
    }

    if (rightTabset?.type === "tabset") {
      const nextRightTabset = rightTabset as IJsonTabSetNode;
      nextRightTabset.minWidth = rightTabsetWidth;
      nextRightTabset.maxWidth = rightTabsetWidth;
    }
  }

  return nextModelJson;
}

function createWorkspaceDesktopModel(args: {
  activePanelId: WorkspacePanelId;
  modelJson?: IJsonModel;
  panelWidth: number;
  primaryTabTitle: string;
}): Model {
  const { activePanelId, modelJson, panelWidth, primaryTabTitle } = args;
  const nextModelJson = updateWorkspaceFlexLayoutModelJsonPresentation({
    modelJson: modelJson ?? buildWorkspaceFlexLayoutModelJson({
      defaultActivePanelId: activePanelId,
      primaryTabTitle,
      rightTabsetWidth: panelWidth,
    }),
    primaryTabTitle,
    rightTabsetWidth: panelWidth,
  });

  return configureWorkspaceFlexLayoutModel(Model.fromJson(nextModelJson));
}

export function WorkspaceFlexLayout(props: {
  collapsed: boolean;
  layoutKey: string;
  onResizeStart?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  panelWidth?: number;
  panels: Record<WorkspacePanelId, WorkspacePanelDefinition>;
}) {
  const { collapsed, layoutKey, onResizeStart, panelWidth = 372, panels } = props;
  const isMobile = useMediaQuery("(max-width: 1023px)");
  const [activePanelId, setActivePanelId] = useState<WorkspacePanelId>(
    () => workspaceActivePanelIdByKey.get(layoutKey) ?? "chat",
  );
  const [model, setModel] = useState<Model>(() =>
    createWorkspaceDesktopModel({
      activePanelId: workspaceActivePanelIdByKey.get(layoutKey) ?? "chat",
      modelJson: workspaceDesktopModelJsonByKey.get(layoutKey),
      panelWidth,
      primaryTabTitle: panels.chat.title,
    }),
  );

  useEffect(() => {
    setActivePanelId(workspaceActivePanelIdByKey.get(layoutKey) ?? "chat");
    setModel(
      createWorkspaceDesktopModel({
        activePanelId: workspaceActivePanelIdByKey.get(layoutKey) ?? "chat",
        modelJson: workspaceDesktopModelJsonByKey.get(layoutKey),
        panelWidth,
        primaryTabTitle: panels.chat.title,
      }),
    );
  }, [layoutKey, panelWidth, panels.chat.title]);

  useEffect(() => {
    workspaceActivePanelIdByKey.set(layoutKey, activePanelId);
  }, [activePanelId, layoutKey]);

  const orderedMobilePanels = useMemo(
    () => (collapsed ? (["chat"] satisfies WorkspacePanelId[]) : workspaceFlexLayoutRightPanelOrder),
    [collapsed],
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
          <span className="inline-flex items-center gap-2">
            <span>{panel.title}</span>
            {panel.badge ? <span className="shrink-0">{panel.badge}</span> : null}
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="-mx-1 flex shrink-0 gap-2 overflow-x-auto px-1 pb-1">
          {orderedMobilePanels.map((panelId) => {
            const panel = panels[panelId];
            const Icon = panel.icon;
            const selected = panelId === activePanelId;

            return (
              <button
                key={panelId}
                type="button"
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)] text-[color:var(--tone-blueprint-foreground)]"
                    : "border-border/70 bg-background text-muted-foreground",
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
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-sm"
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

  if (collapsed) {
    return (
      <section
        data-workspace-panel-id={panels.chat.id}
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-sm"
      >
        <div className="min-h-0 flex-1 overflow-hidden p-3">{panels.chat.content}</div>
      </section>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      <div
        data-testid="workspace-flex-layout"
        className={cn(
          "flexlayout__theme_light dark:flexlayout__theme_dark flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[1.5rem] border border-border/70 bg-card shadow-sm",
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
      <div
        aria-hidden
        className="hidden w-4 shrink-0 cursor-col-resize xl:block"
        onPointerDown={onResizeStart}
      >
        <div className="h-full w-px rounded-full bg-border/80" />
      </div>
    </div>
  );
}
