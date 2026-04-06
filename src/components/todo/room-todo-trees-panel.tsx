import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCcw,
  Sparkles,
} from "lucide-react";

import type { Room } from "@/domain/model";
import type {
  RoomTodoTreesPayload,
  WorkspaceRuntimeClient,
} from "@/lib/runtime-client";
import {
  buildAqTodoNodeAggregates,
  buildAqTodoFlowGraph,
  deriveAqTodoDisplayStatus,
  inferAqTodoNodeProgress,
  parseAqTodoXml,
  type AqTodoFlowNodeData,
  type AqTodoNodeModel,
} from "@/lib/aqtodo";
import { cn } from "@/lib/utils";
import { RoomAssetImage } from "@/components/media/room-asset-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const TODO_STATUS_STYLES: Record<string, string> = {
  blocked:
    "border-[color:var(--tone-correction-border)] bg-[color:var(--tone-correction-surface)] text-[color:var(--tone-correction-foreground)]",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  in_progress:
    "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)] text-[color:var(--tone-blueprint-foreground)]",
  todo: "border-border/80 bg-muted/35 text-muted-foreground",
};

type AqTodoFlowNode = Node<AqTodoFlowNodeData, "aqtodo">;

function getTodoStatusClassName(status: string): string {
  return TODO_STATUS_STYLES[status] ?? TODO_STATUS_STYLES.todo;
}

function getTodoStatusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function formatItemCount(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

function buildStatusSummary(statusCounts: Record<string, number>): string[] {
  return [
    statusCounts.done ? `${statusCounts.done} done` : undefined,
    statusCounts.in_progress ? `${statusCounts.in_progress} active` : undefined,
    statusCounts.blocked ? `${statusCounts.blocked} blocked` : undefined,
    statusCounts.todo ? `${statusCounts.todo} todo` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function getCodePreview(code: string): {
  hiddenLineCount: number;
  preview: string;
} {
  const lines = code.trim().split(/\r?\n/u);
  const previewLines = lines.slice(0, 6);

  return {
    preview: previewLines.join("\n"),
    hiddenLineCount: Math.max(0, lines.length - previewLines.length),
  };
}

function buildNodeSummary(node: AqTodoNodeModel): string[] {
  return [
    node.member ? `Owner ${node.member}` : undefined,
    node.priority ? `Priority ${node.priority}` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function pruneGraphStateByFiles<T>(
  state: Record<string, T>,
  files: RoomTodoTreesPayload["files"],
): Record<string, T> {
  const allowedPaths = new Set(files.map((file) => file.absolutePath));
  return Object.fromEntries(
    Object.entries(state).filter(([filePath]) => allowedPaths.has(filePath)),
  );
}

function AqTodoFlowNodeCard(props: NodeProps<AqTodoFlowNode>) {
  const {
    data: {
      canCollapse,
      collapsed,
      depth,
      node,
      onToggleCollapse,
      roomId,
      zoomedOut,
    },
  } = props;
  const summary = buildNodeSummary(node);
  const aggregate = useMemo(() => buildAqTodoNodeAggregates(node).get(node.id), [node]);
  const previewCode = node.codes[0];
  const previewImage = node.images[0];
  const codePreview = previewCode ? getCodePreview(previewCode.content) : undefined;
  const progressValue = Math.round(aggregate?.completion ?? inferAqTodoNodeProgress(node));
  const displayStatus = deriveAqTodoDisplayStatus(node, aggregate);
  const statusSummary = aggregate ? buildStatusSummary(aggregate.statusCounts) : [];
  const compactMode = zoomedOut || collapsed;

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-[1.35rem] border bg-background/96 shadow-[0_22px_48px_-34px_rgba(15,23,42,0.52)]",
        getTodoStatusClassName(displayStatus),
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-background !bg-foreground/60"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-background !bg-foreground/60"
      />
      <div className="flex items-start justify-between gap-2 border-b border-black/5 px-3.5 py-3">
        <div className="min-w-0">
          <p
            className={cn(
              "m-0 font-semibold text-foreground",
              compactMode ? "line-clamp-3 text-base leading-5" : "text-sm leading-5",
            )}
          >
            {node.title}
          </p>
          {!compactMode && summary.length > 0 ? (
            <p className="mt-1 m-0 text-[11px] leading-4 text-muted-foreground">
              {summary.join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 border-current/20 bg-background/70 text-[10px] font-semibold uppercase tracking-[0.14em]",
              getTodoStatusClassName(displayStatus),
            )}
          >
            {getTodoStatusLabel(displayStatus)}
          </Badge>
          {canCollapse ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="rounded-full border border-border/70 bg-background/70"
              onClick={() => onToggleCollapse?.(node.id)}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${node.title}`}
            >
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </Button>
          ) : null}
        </div>
      </div>
      {compactMode ? (
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 px-3.5 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[11px] text-muted-foreground">
              {aggregate?.isCategory
                ? formatItemCount(aggregate.totalItemCount)
                : getTodoStatusLabel(displayStatus)}
            </p>
            <p className="m-0 text-xs font-semibold text-foreground">
              {formatPercent(progressValue)}
            </p>
          </div>
          <div
            role="progressbar"
            aria-label={`${node.title} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressValue}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-300",
                displayStatus === "done"
                  ? "bg-emerald-500"
                  : displayStatus === "blocked"
                    ? "bg-amber-500"
                    : "bg-[color:var(--tone-blueprint-border)]",
              )}
              style={{ width: `${progressValue}%` }}
            />
          </div>
          {collapsed && aggregate?.isCategory ? (
            <p className="m-0 text-[11px] leading-5 text-muted-foreground">
              {aggregate.directChildCount} branches hidden · {aggregate.doneItemCount} of{" "}
              {aggregate.totalItemCount} items done
            </p>
          ) : statusSummary.length > 0 ? (
            <p className="m-0 truncate text-[11px] leading-5 text-muted-foreground">
              {statusSummary.join(" · ")}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 px-3.5 py-3">
          {aggregate?.isCategory ? (
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                Category
              </Badge>
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                Level {depth + 1}
              </Badge>
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                {formatItemCount(aggregate.totalItemCount)}
              </Badge>
            </div>
          ) : null}
          {node.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {node.tags.slice(0, 4).map((tag: string) => (
                <Badge
                  key={tag}
                  variant="secondary"
                  className="px-2 py-0.5 text-[10px]"
                >
                  {tag}
                </Badge>
              ))}
              {node.tags.length > 4 ? (
                <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                  +{node.tags.length - 4}
                </Badge>
              ) : null}
            </div>
          ) : null}
          <div className="rounded-2xl border border-border/70 bg-background/80 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {aggregate?.isCategory ? "Subtree progress" : "Progress"}
              </p>
              <p className="m-0 text-xs font-semibold text-foreground">
                {formatPercent(progressValue)}
              </p>
            </div>
            <div
              role="progressbar"
              aria-label={`${node.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressValue}
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  displayStatus === "done"
                    ? "bg-emerald-500"
                    : displayStatus === "blocked"
                      ? "bg-amber-500"
                      : "bg-[color:var(--tone-blueprint-border)]",
                )}
                style={{ width: `${progressValue}%` }}
              />
            </div>
            {aggregate?.isCategory ? (
              <p className="mt-2 m-0 text-[11px] leading-5 text-muted-foreground">
                {aggregate.doneItemCount} of {aggregate.totalItemCount} items done
                {statusSummary.length > 0 ? ` · ${statusSummary.join(" · ")}` : ""}
              </p>
            ) : (
              <p className="mt-2 m-0 text-[11px] leading-5 text-muted-foreground">
                {getTodoStatusLabel(displayStatus)}
                {summary.length > 0 ? ` · ${summary.join(" · ")}` : ""}
              </p>
            )}
          </div>
          {node.note ? (
            <p className="m-0 line-clamp-3 text-[11px] leading-5 text-foreground/85">
              {node.note}
            </p>
          ) : null}
          {node.details ? (
            <p className="m-0 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
              {node.details}
            </p>
          ) : null}
          {previewCode && codePreview ? (
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-slate-950/94 text-slate-100">
              <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-300/90">
                <span>{previewCode.language || "code"}</span>
                {codePreview.hiddenLineCount > 0 ? (
                  <span>+{codePreview.hiddenLineCount} lines</span>
                ) : null}
              </div>
              <pre className="m-0 max-h-28 overflow-auto px-3 py-2 text-[11px] leading-5">
                <code>{codePreview.preview}</code>
              </pre>
            </div>
          ) : null}
          {previewImage ? (
            <RoomAssetImage
              roomId={roomId}
              src={previewImage.src}
              alt={previewImage.alt || node.title}
              className="my-0 block w-full rounded-2xl"
              imageClassName="h-24 w-full rounded-2xl object-cover"
              dialogImageClassName="max-h-[76vh]"
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

const TODO_NODE_TYPES = {
  aqtodo: AqTodoFlowNodeCard,
};

export function RoomTodoTreesPanel(props: {
  room: Room;
  runtimeClient: WorkspaceRuntimeClient;
}) {
  const { room, runtimeClient } = props;
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>(
    undefined,
  );
  const [payload, setPayload] = useState<RoomTodoTreesPayload | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [collapsedNodeIdsByFile, setCollapsedNodeIdsByFile] = useState<
    Record<string, string[]>
  >({});
  const [zoomedOutByFile, setZoomedOutByFile] = useState<Record<string, boolean>>(
    {},
  );

  const loadTodoTrees = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const nextPayload = await runtimeClient.getRoomTodoTrees(room.id);
      setPayload(nextPayload);
      setCollapsedNodeIdsByFile((current) =>
        pruneGraphStateByFiles(current, nextPayload.files),
      );
      setZoomedOutByFile((current) =>
        pruneGraphStateByFiles(current, nextPayload.files),
      );
      setSelectedFilePath((current) =>
        current &&
        nextPayload.files.some((file) => file.absolutePath === current)
          ? current
          : nextPayload.files[0]?.absolutePath,
      );
    } catch (loadError) {
      setPayload(undefined);
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load todo trees.",
      );
    } finally {
      setLoading(false);
    }
  }, [room.id, runtimeClient]);

  useEffect(() => {
    setPayload(undefined);
    setSelectedFilePath(undefined);
    void loadTodoTrees();
  }, [loadTodoTrees, room.updatedAt]);

  const selectedFile = useMemo(() => {
    if (!payload) {
      return undefined;
    }

    return (
      payload.files.find((file) => file.absolutePath === selectedFilePath) ??
      payload.files[0]
    );
  }, [payload, selectedFilePath]);

  const collapsedNodeIds = useMemo(
    () => new Set(selectedFile ? collapsedNodeIdsByFile[selectedFile.absolutePath] ?? [] : []),
    [collapsedNodeIdsByFile, selectedFile],
  );
  const zoomedOut = selectedFile
    ? (zoomedOutByFile[selectedFile.absolutePath] ?? false)
    : false;

  const toggleCollapse = useCallback(
    (nodeId: string) => {
      if (!selectedFile) {
        return;
      }

      setCollapsedNodeIdsByFile((current) => {
        const nextNodeIds = new Set(current[selectedFile.absolutePath] ?? []);
        if (nextNodeIds.has(nodeId)) {
          nextNodeIds.delete(nodeId);
        } else {
          nextNodeIds.add(nodeId);
        }

        return {
          ...current,
          [selectedFile.absolutePath]: [...nextNodeIds],
        };
      });
    },
    [selectedFile],
  );

  const handleViewportChange = useCallback(
    (_event: unknown, viewport: { zoom: number }) => {
      if (!selectedFile) {
        return;
      }

      const nextZoomedOut = viewport.zoom < 0.7;
      setZoomedOutByFile((current) =>
        current[selectedFile.absolutePath] === nextZoomedOut
          ? current
          : {
              ...current,
              [selectedFile.absolutePath]: nextZoomedOut,
            },
      );
    },
    [selectedFile],
  );

  const parsedDocument = useMemo(() => {
    if (!selectedFile) {
      return { document: undefined, error: undefined };
    }

    try {
      return {
        document: parseAqTodoXml(selectedFile.content),
        error: undefined,
      };
    } catch (parseError) {
      return {
        document: undefined,
        error:
          parseError instanceof Error
            ? parseError.message
            : "Failed to parse todo tree.",
      };
    }
  }, [selectedFile]);

  const flowGraph = useMemo(() => {
    if (!parsedDocument.document) {
      return undefined;
    }

    return buildAqTodoFlowGraph({
      collapsedNodeIds,
      document: parsedDocument.document,
      onToggleCollapse: toggleCollapse,
      roomId: room.id,
      zoomedOut,
    });
  }, [collapsedNodeIds, parsedDocument.document, room.id, toggleCollapse, zoomedOut]);
  const rootAggregate = useMemo(() => {
    if (!parsedDocument.document) {
      return undefined;
    }

    return buildAqTodoNodeAggregates(parsedDocument.document.root).get(
      parsedDocument.document.root.id,
    );
  }, [parsedDocument.document]);
  const rootDisplayStatus = useMemo(() => {
    if (!parsedDocument.document) {
      return undefined;
    }

    return deriveAqTodoDisplayStatus(parsedDocument.document.root, rootAggregate);
  }, [parsedDocument.document, rootAggregate]);
  const renderableFlowGraph = useMemo(
    () => (flowGraph && flowGraph.nodes.length > 0 ? flowGraph : undefined),
    [flowGraph],
  );
  const hasRenderableGraph = Boolean(renderableFlowGraph);
  const reactFlowKey = selectedFile
    ? `${selectedFile.absolutePath}:${selectedFile.modifiedAt}`
    : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-border/75 bg-background/96 shadow-sm">
      {selectedFile || payload?.files.length ? (
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex items-start gap-2">
          {payload && payload.files.length > 1 ? (
            <div className="pointer-events-auto flex max-w-[32rem] flex-wrap justify-end gap-1.5">
              {payload.files.map((file) => {
                const active = file.absolutePath === selectedFile?.absolutePath;
                return (
                  <Button
                    key={file.absolutePath}
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={cn(
                      "h-7 rounded-full border border-border/70 bg-background/84 px-2.5 text-[11px] shadow-sm backdrop-blur",
                      active &&
                        "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)] text-[color:var(--tone-blueprint-foreground)]",
                    )}
                    onClick={() => setSelectedFilePath(file.absolutePath)}
                    aria-pressed={active}
                  >
                    {file.fileName}
                  </Button>
                );
              })}
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="pointer-events-auto rounded-full border border-border/70 bg-background/84 shadow-sm backdrop-blur"
            onClick={() => void loadTodoTrees()}
            disabled={loading}
            aria-label="Refresh todo trees"
          >
            <RefreshCcw size={14} className={cn(loading && "animate-spin")} />
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-full min-h-[18rem] items-center justify-center px-6 text-sm text-muted-foreground">
          Loading todo trees…
        </div>
      ) : error ? (
        <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 px-6 text-center">
          <AlertTriangle size={18} className="text-destructive" />
          <p className="m-0 text-sm text-destructive">{error}</p>
        </div>
      ) : !selectedFile ? (
        <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          <Sparkles size={18} />
          <p className="m-0 text-sm">
            No tree file found. Create a `*.aqtree.xml` file under the room
            interactive directory.
          </p>
        </div>
      ) : parsedDocument.error ? (
        <div className="flex h-full min-h-[18rem] flex-col gap-3 p-4">
          <div className="rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3">
            <p className="m-0 text-sm font-medium text-destructive">
              Failed to parse {selectedFile.fileName}
            </p>
            <p className="mt-1 m-0 text-xs leading-5 text-destructive/90">
              {parsedDocument.error}
            </p>
          </div>
          <pre className="m-0 min-h-0 flex-1 overflow-auto rounded-2xl bg-slate-950 p-4 text-[11px] leading-5 text-slate-100">
            <code>{selectedFile.content}</code>
          </pre>
        </div>
      ) : hasRenderableGraph ? (
        <div className="flex h-full min-h-0 flex-col">
          {rootAggregate ? (
            <div className="shrink-0 border-b border-border/70 bg-background/90 px-4 py-3 backdrop-blur-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                    getTodoStatusClassName(rootDisplayStatus ?? "todo"),
                  )}
                >
                  {rootDisplayStatus === "done" ? "All items complete" : getTodoStatusLabel(rootDisplayStatus ?? "todo")}
                </Badge>
                <p className="m-0 text-sm font-medium text-foreground">
                  {rootAggregate.doneItemCount} of {rootAggregate.totalItemCount} items done
                </p>
                {buildStatusSummary(rootAggregate.statusCounts).length > 0 ? (
                  <p className="m-0 text-xs text-muted-foreground">
                    {buildStatusSummary(rootAggregate.statusCounts).join(" · ")}
                  </p>
                ) : null}
              </div>
              <p className="mt-1 m-0 text-xs text-muted-foreground">
                {rootDisplayStatus === "done"
                  ? "There are no unfinished items right now, but the current tree and graph stay visible below."
                  : "The current tree stays visible here even while work status changes."}
              </p>
            </div>
          ) : null}
          <div className="relative flex h-full min-h-[22rem] min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(110,135,255,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,248,252,0.96))] dark:bg-[radial-gradient(circle_at_top_left,rgba(110,135,255,0.16),transparent_32%),linear-gradient(180deg,rgba(25,29,40,0.96),rgba(18,22,31,0.98))]">
            <ReactFlow
              className="h-full w-full"
              style={{ width: "100%", height: "100%" }}
              key={reactFlowKey}
              nodes={renderableFlowGraph?.nodes ?? []}
              edges={renderableFlowGraph?.edges ?? []}
              nodeTypes={TODO_NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.16 }}
              minZoom={0.25}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnDoubleClick={false}
              onMove={handleViewportChange}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} color="rgba(120, 130, 160, 0.18)" />
              <Controls showInteractive={false} position="top-left" />
            </ReactFlow>
          </div>
        </div>
      ) : (
        <div className="flex h-full min-h-[18rem] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
          <Sparkles size={18} />
          <p className="m-0 text-sm">
            The current tree file loaded, but no graph nodes were available to render.
          </p>
          <p className="m-0 text-xs">
            Refresh the tree or check the current AqTree structure instead of showing a blank panel.
          </p>
        </div>
      )}
    </div>
  );
}
