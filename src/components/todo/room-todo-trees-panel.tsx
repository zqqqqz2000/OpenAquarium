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
import { AlertTriangle, FolderTree, RefreshCcw, Sparkles } from "lucide-react";

import type { Room } from "@/domain/model";
import type {
  RoomTodoTreesPayload,
  WorkspaceRuntimeClient,
} from "@/lib/runtime-client";
import {
  buildAqTodoFlowGraph,
  parseAqTodoXml,
  type AqTodoFlowNodeData,
  type AqTodoNodeModel,
} from "@/lib/aqtodo";
import { cn } from "@/lib/utils";
import { RoomAssetImage } from "@/components/media/room-asset-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TODO_STATUS_STYLES: Record<string, string> = {
  blocked:
    "border-[color:var(--tone-correction-border)] bg-[color:var(--tone-correction-surface)] text-[color:var(--tone-correction-foreground)]",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  in_progress:
    "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)] text-[color:var(--tone-blueprint-foreground)]",
  todo: "border-border/80 bg-muted/35 text-muted-foreground",
};

type AqTodoFlowNode = Node<AqTodoFlowNodeData, "aqtodo">;

function formatTodoTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  return timestamp.toLocaleString();
}

function getTodoStatusClassName(status: string): string {
  return TODO_STATUS_STYLES[status] ?? TODO_STATUS_STYLES.todo;
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
    typeof node.progress === "number" ? `${Math.round(node.progress)}%` : undefined,
  ].filter((value): value is string => Boolean(value));
}

function formatGraphCount(count: number): string {
  return `${count} graph${count === 1 ? "" : "s"}`;
}

function AqTodoFlowNodeCard(props: NodeProps<AqTodoFlowNode>) {
  const {
    data: { node, roomId },
  } = props;
  const summary = buildNodeSummary(node);
  const previewCode = node.codes[0];
  const previewImage = node.images[0];
  const codePreview = previewCode ? getCodePreview(previewCode.content) : undefined;

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-[1.35rem] border bg-background/96 shadow-[0_22px_48px_-34px_rgba(15,23,42,0.52)]",
        getTodoStatusClassName(node.status),
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
          <p className="m-0 text-sm font-semibold leading-5 text-foreground">
            {node.title}
          </p>
          {summary.length > 0 ? (
            <p className="mt-1 m-0 text-[11px] leading-4 text-muted-foreground">
              {summary.join(" · ")}
            </p>
          ) : null}
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0 border-current/20 bg-background/70 text-[10px] font-semibold uppercase tracking-[0.14em]",
            getTodoStatusClassName(node.status),
          )}
        >
          {node.status.replaceAll("_", " ")}
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3.5 py-3">
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

  const loadTodoTrees = useCallback(async () => {
    setLoading(true);
    setError(undefined);

    try {
      const nextPayload = await runtimeClient.getRoomTodoTrees(room.id);
      setPayload(nextPayload);
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
  }, [loadTodoTrees]);

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

  const flowGraph = useMemo(() => {
    if (!parsedDocument.document) {
      return undefined;
    }

    return buildAqTodoFlowGraph({
      document: parsedDocument.document,
      roomId: room.id,
    });
  }, [parsedDocument.document, room.id]);

  const activeTabValue = selectedFile?.absolutePath ?? "__no-selection__";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="rounded-3xl border border-border/75 bg-card/96 p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <FolderTree size={16} />
              <p className="m-0 text-sm font-semibold">AqTree</p>
              {payload?.files.length ? (
                <Badge variant="secondary" className="rounded-full px-2 py-0 text-[10px]">
                  {formatGraphCount(payload.files.length)}
                </Badge>
              ) : null}
            </div>
            <p className="m-0 text-xs text-muted-foreground">
              Visual room plan, ownership, and evidence at a glance.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void loadTodoTrees()}
            disabled={loading}
          >
            <RefreshCcw size={14} className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
        {payload ? (
          <details className="mt-2 rounded-2xl border border-border/60 bg-muted/15 px-3 py-2.5">
            <summary className="cursor-pointer list-none text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground marker:hidden">
              Workspace info
            </summary>
            <div className="mt-2 space-y-2 text-[11px] leading-5">
              <div>
                <p className="m-0 font-medium text-foreground/80">Project interactive directory</p>
                <p className="m-0 break-all font-mono text-foreground/85">
                  {payload.projectInteractiveDirectory}
                </p>
              </div>
              <div>
                <p className="m-0 font-medium text-foreground/80">Room interactive directory</p>
                <p className="m-0 break-all font-mono text-foreground/85">
                  {payload.roomInteractiveDirectory}
                </p>
              </div>
              {payload.providerAssociationNotice ? (
                <div className="rounded-2xl border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-amber-900">
                  {payload.providerAssociationNotice}
                </div>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>

      <Tabs
        value={activeTabValue}
        onValueChange={setSelectedFilePath}
        className="min-h-0 flex-1 gap-2"
      >
        {payload?.files.length ? (
          <div className="rounded-2xl border border-border/70 bg-background/70 p-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Graph views
              </p>
              {selectedFile ? (
                <p className="m-0 text-[11px] text-muted-foreground">
                  Updated {formatTodoTimestamp(selectedFile.modifiedAt)}
                </p>
              ) : null}
            </div>
            <div className="overflow-x-auto pb-1">
              <TabsList
                variant="line"
                className="h-auto min-w-full justify-start gap-1 rounded-none p-0"
              >
                {payload.files.map((file) => (
                  <TabsTrigger
                    key={file.absolutePath}
                    value={file.absolutePath}
                    className="min-w-0 flex-none rounded-xl border border-border/70 bg-background/85 px-3 py-2 text-left text-xs data-active:border-[color:var(--tone-blueprint-border)] data-active:bg-[color:var(--tone-blueprint-surface)] data-active:text-[color:var(--tone-blueprint-foreground)] data-active:after:hidden"
                  >
                    <span className="block truncate font-medium">{file.fileName}</span>
                    <span className="block text-[10px] opacity-80">
                      {formatTodoTimestamp(file.modifiedAt)}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </div>
        ) : null}

        <Card className="min-h-0 flex-1 overflow-hidden border border-border shadow-sm">
          <CardContent className="flex h-full min-h-0 flex-col p-0">
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
              <TabsContent value={selectedFile.absolutePath} className="m-0 flex min-h-0 flex-1 flex-col">
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
              </TabsContent>
            ) : flowGraph ? (
              <TabsContent value={selectedFile.absolutePath} className="m-0 flex min-h-0 flex-1 flex-col">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
                  <div className="min-w-0">
                    <p className="m-0 truncate text-sm font-semibold">
                      {parsedDocument.document?.title ||
                        parsedDocument.document?.roomName ||
                        selectedFile.fileName}
                    </p>
                    <p className="mt-1 m-0 text-xs text-muted-foreground">
                      {flowGraph.nodes.length} nodes · {flowGraph.edges.length} links
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {selectedFile.fileName}
                  </Badge>
                </div>
                <div className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top_left,rgba(110,135,255,0.12),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.96),rgba(246,248,252,0.96))] dark:bg-[radial-gradient(circle_at_top_left,rgba(110,135,255,0.16),transparent_32%),linear-gradient(180deg,rgba(25,29,40,0.96),rgba(18,22,31,0.98))]">
                  <ReactFlow
                    key={selectedFile.absolutePath}
                    nodes={flowGraph.nodes}
                    edges={flowGraph.edges}
                    nodeTypes={TODO_NODE_TYPES}
                    fitView
                    fitViewOptions={{ padding: 0.16 }}
                    minZoom={0.25}
                    maxZoom={1.5}
                    nodesDraggable={false}
                    nodesConnectable={false}
                    elementsSelectable={false}
                    zoomOnDoubleClick={false}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background gap={20} size={1} color="rgba(120, 130, 160, 0.18)" />
                    <Controls showInteractive={false} position="top-left" />
                  </ReactFlow>
                </div>
              </TabsContent>
            ) : null}
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
