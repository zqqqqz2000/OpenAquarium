import { useCallback, useEffect, useMemo, useState } from "react";

import { AlertTriangle, RefreshCcw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Room } from "@/domain/model";
import {
  buildAqTodoNodeAggregates,
  deriveAqTodoDisplayStatus,
  inferAqTodoNodeProgress,
  parseAqTodoXml,
  type AqTodoNodeModel,
} from "@/lib/aqtodo";
import {
  getInitialRoomTodoTreesPanelState,
  getRoomTodoTreesPanelStorageKey,
  serializeRoomTodoTreesPanelState,
} from "@/lib/room-todo-trees-panel-state";
import type {
  RoomTodoTreesPayload,
  WorkspaceRuntimeClient,
} from "@/lib/runtime-client";
import { cn } from "@/lib/utils";

const TODO_STATUS_STYLES: Record<string, string> = {
  blocked:
    "border-[color:var(--tone-correction-border)] bg-[color:var(--tone-correction-surface)] text-[color:var(--tone-correction-foreground)]",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  in_progress:
    "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)] text-[color:var(--tone-blueprint-foreground)]",
  todo: "border-border/80 bg-muted/35 text-muted-foreground",
};

interface AqTodoOutlineEntry {
  depth: number;
  node: AqTodoNodeModel;
}

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

function flattenTodoNodes(
  node: AqTodoNodeModel,
  depth = 0,
): AqTodoOutlineEntry[] {
  return [
    { depth, node },
    ...node.children.flatMap((child) => flattenTodoNodes(child, depth + 1)),
  ];
}

function getNodeEvidenceSummary(node: AqTodoNodeModel): string[] {
  return [
    node.images.length ? `${node.images.length} image${node.images.length === 1 ? "" : "s"}` : undefined,
    node.codes.length ? `${node.codes.length} code block${node.codes.length === 1 ? "" : "s"}` : undefined,
    node.details ? "details" : undefined,
    node.note ? "note" : undefined,
  ].filter((value): value is string => Boolean(value));
}

function getFailurePointCopy(node: AqTodoNodeModel): string {
  if (node.status === "blocked") {
    return node.note ?? node.details ?? "This node is blocked. Attach the exact failing step or missing dependency here.";
  }

  return (
    node.note ??
    node.details ??
    "No explicit failure point yet. Use this slot for acceptance blockers, retry notes, or unresolved dependencies."
  );
}

function prunePanelStateByFiles<T>(
  state: Record<string, T>,
  files: RoomTodoTreesPayload["files"],
): Record<string, T> {
  const allowedPaths = new Set(files.map((file) => file.absolutePath));
  return Object.fromEntries(
    Object.entries(state).filter(([filePath]) => allowedPaths.has(filePath)),
  );
}

function matchesTodoFilter(
  status: string,
  filter: "all" | "active" | "blocked" | "done",
): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "active") {
    return status === "in_progress" || status === "todo";
  }

  return status === filter;
}

export function RoomTodoTreesPanel(props: {
  room: Room;
  runtimeClient: WorkspaceRuntimeClient;
}) {
  const { room, runtimeClient } = props;
  const initialPanelState = getInitialRoomTodoTreesPanelState(room.id);
  const [selectedFilePath, setSelectedFilePath] = useState<string | undefined>(
    initialPanelState.selectedFilePath,
  );
  const [payload, setPayload] = useState<RoomTodoTreesPayload | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);
  const [selectedNodeIdByFile, setSelectedNodeIdByFile] = useState<
    Record<string, string | undefined>
  >(initialPanelState.selectedNodeIdByFile);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "blocked" | "done"
  >(initialPanelState.statusFilter);

  useEffect(() => {
    const nextPanelState = getInitialRoomTodoTreesPanelState(room.id);
    setSelectedFilePath(nextPanelState.selectedFilePath);
    setSelectedNodeIdByFile(nextPanelState.selectedNodeIdByFile);
    setStatusFilter(nextPanelState.statusFilter);
  }, [room.id]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      getRoomTodoTreesPanelStorageKey(room.id),
      serializeRoomTodoTreesPanelState({
        selectedFilePath,
        selectedNodeIdByFile,
        statusFilter,
      }),
    );
  }, [
    room.id,
    selectedFilePath,
    selectedNodeIdByFile,
    statusFilter,
  ]);

  const loadTodoTrees = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const nextPayload = await runtimeClient.getRoomTodoTrees(room.id);
      setPayload(nextPayload);
      setSelectedNodeIdByFile((current) =>
        prunePanelStateByFiles(current, nextPayload.files),
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

  const nodeAggregates = useMemo(() => {
    if (!parsedDocument.document) {
      return undefined;
    }

    return buildAqTodoNodeAggregates(parsedDocument.document.root);
  }, [parsedDocument.document]);

  const rootAggregate = parsedDocument.document
    ? nodeAggregates?.get(parsedDocument.document.root.id)
    : undefined;
  const rootDisplayStatus = useMemo(() => {
    if (!parsedDocument.document) {
      return undefined;
    }

    return deriveAqTodoDisplayStatus(parsedDocument.document.root, rootAggregate);
  }, [parsedDocument.document, rootAggregate]);

  const outlineEntries = useMemo(
    () =>
      parsedDocument.document
        ? flattenTodoNodes(parsedDocument.document.root)
        : [],
    [parsedDocument.document],
  );

  const filteredOutlineEntries = useMemo(
    () =>
      outlineEntries.filter((entry) =>
        matchesTodoFilter(
          deriveAqTodoDisplayStatus(entry.node, nodeAggregates?.get(entry.node.id)),
          statusFilter,
        ),
      ),
    [nodeAggregates, outlineEntries, statusFilter],
  );

  const selectedNodeId = selectedFile
    ? selectedNodeIdByFile[selectedFile.absolutePath]
    : undefined;

  const selectedNode = useMemo(() => {
    if (filteredOutlineEntries.length === 0) {
      return undefined;
    }

    return (
      filteredOutlineEntries.find((entry) => entry.node.id === selectedNodeId)?.node ??
      filteredOutlineEntries[0]?.node
    );
  }, [filteredOutlineEntries, selectedNodeId]);

  const selectedNodeAggregate = selectedNode ? nodeAggregates?.get(selectedNode.id) : undefined;
  const selectedNodeStatus = selectedNode
    ? deriveAqTodoDisplayStatus(selectedNode, selectedNodeAggregate)
    : undefined;
  const selectedNodeEvidenceSummary = selectedNode
    ? getNodeEvidenceSummary(selectedNode)
    : [];

  useEffect(() => {
    if (!selectedFile) {
      return;
    }

    setSelectedNodeIdByFile((current) => {
      const currentNodeId = current[selectedFile.absolutePath];
      if (
        currentNodeId
        && filteredOutlineEntries.some((entry) => entry.node.id === currentNodeId)
      ) {
        return current;
      }

      return {
        ...current,
        [selectedFile.absolutePath]: filteredOutlineEntries[0]?.node.id,
      };
    });
  }, [filteredOutlineEntries, selectedFile]);

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-none border border-border/75 bg-background/96 shadow-sm">
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
      ) : (
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
                  ? "There are no unfinished items right now, but the current outline and inspector stay visible below."
                  : "The current tree stays visible here even while work status changes."}
              </p>
            </div>
          ) : null}
          <div className="shrink-0 border-b border-border/70 bg-background/88 px-4 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <p className="m-0 text-sm font-semibold text-foreground">Workspace Controls</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  Filter the current outline while keeping node details pinned in the inspector.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Filter
                </span>
                {([
                  ["all", "All"],
                  ["active", "Active"],
                  ["blocked", "Blocked"],
                  ["done", "Done"],
                ] as const).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    variant="ghost"
                    size="xs"
                    className={cn(
                      "h-7 rounded-full border border-border/70 bg-background/84 px-2.5 text-[11px] shadow-sm",
                      statusFilter === value
                        && "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)] text-[color:var(--tone-blueprint-foreground)]",
                    )}
                    onClick={() => setStatusFilter(value)}
                    aria-pressed={statusFilter === value}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-1 divide-y divide-border/70 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] xl:divide-x xl:divide-y-0">
            <section className="flex min-h-[14rem] min-w-0 flex-col overflow-hidden bg-muted/18">
              <div className="shrink-0 border-b border-border/70 px-4 py-3">
                <p className="m-0 text-sm font-semibold text-foreground">Outline</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  Tree list with filter controls wired above.
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2">
                {filteredOutlineEntries.map((entry) => {
                  const isSelected = entry.node.id === selectedNode?.id;
                  const aggregate = nodeAggregates?.get(entry.node.id);
                  const status = deriveAqTodoDisplayStatus(entry.node, aggregate);
                  const progressValue = Math.round(
                    aggregate?.completion ?? inferAqTodoNodeProgress(entry.node),
                  );

                  return (
                    <button
                      key={entry.node.id}
                      type="button"
                      aria-label={`Select node ${entry.node.title}`}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-background/80",
                        isSelected && "bg-background shadow-sm ring-1 ring-border/70",
                      )}
                      style={{ marginLeft: `${Math.min(entry.depth * 12, 48)}px` }}
                      onClick={() => {
                        if (!selectedFile) {
                          return;
                        }

                        setSelectedNodeIdByFile((current) => ({
                          ...current,
                          [selectedFile.absolutePath]: entry.node.id,
                        }));
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-sm font-medium text-foreground">
                          {entry.node.title}
                        </p>
                        <p className="m-0 mt-1 truncate text-[11px] text-muted-foreground">
                          {entry.node.member ? `${entry.node.member} · ` : ""}
                          {aggregate?.totalItemCount
                            ? formatItemCount(aggregate.totalItemCount)
                            : "Leaf node"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn("rounded-full text-[10px]", getTodoStatusClassName(status))}
                        >
                          {getTodoStatusLabel(status)}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          {formatPercent(progressValue)}
                        </span>
                      </div>
                    </button>
                  );
                })}
                {filteredOutlineEntries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/70 px-3 py-5 text-sm text-muted-foreground">
                    当前过滤条件下没有节点，切回 `all` 可恢复完整视图。
                  </div>
                ) : null}
              </div>
            </section>

            <aside className="flex min-h-[14rem] min-w-0 flex-col overflow-hidden bg-background/92">
              <div className="shrink-0 border-b border-border/70 px-4 py-3">
                <p className="m-0 text-sm font-semibold text-foreground">Inspector</p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  Acceptance and proof placeholders are visible now; builder fields can plug in next.
                </p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
                <div className="rounded-2xl border border-border/70 bg-muted/18 px-3.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Acceptance Status
                      </p>
                      <p className="m-0 mt-2 text-sm font-semibold text-foreground">
                        {selectedNode?.title ?? "No node selected"}
                      </p>
                    </div>
                    {selectedNodeStatus ? (
                      <Badge
                        variant="outline"
                        className={cn("rounded-full", getTodoStatusClassName(selectedNodeStatus))}
                      >
                        {getTodoStatusLabel(selectedNodeStatus)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="m-0 mt-2 text-xs text-muted-foreground">
                    {selectedNodeAggregate
                      ? `${formatPercent(selectedNodeAggregate.completion)} complete · ${selectedNodeAggregate.doneItemCount}/${selectedNodeAggregate.totalItemCount} items done`
                      : "Waiting for richer acceptance fields. This shell keeps the status slot visible in the workspace."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background px-3.5 py-3 shadow-sm">
                  <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Failure Point
                  </p>
                  <p className="m-0 mt-2 text-sm leading-6 text-foreground">
                    {selectedNode ? getFailurePointCopy(selectedNode) : "Select a node to inspect its failure context."}
                  </p>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background px-3.5 py-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                      Proof Pack
                    </p>
                    <Badge variant="secondary">
                      {selectedNodeEvidenceSummary.length > 0
                        ? `${selectedNodeEvidenceSummary.length} linked`
                        : "placeholder"}
                    </Badge>
                  </div>
                  <p className="m-0 mt-2 text-sm leading-6 text-foreground">
                    {selectedNodeEvidenceSummary.length > 0
                      ? selectedNodeEvidenceSummary.join(" · ")
                      : "Attach screenshots, code refs, or acceptance notes here to close the review loop."}
                  </p>
                  {selectedNode?.tags.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedNode.tags.map((tag) => (
                        <Badge key={tag} variant="outline" className="rounded-full text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
