import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";

import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, FolderKanban, MessageSquareShare, Waves } from "lucide-react";

import type { Project, Room, TeamTemplate } from "@/domain/model";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreateRoomDialog } from "@/components/projects/create-room-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn, summarizePrompt } from "@/lib/utils";
import { badgeToneProps } from "@/lib/ui-tone";

export function Sidebar(props: {
  collapsed: boolean;
  projects: Project[];
  roomsByProject: Record<string, Room[]>;
  activeProjectId?: string;
  activeRoomId?: string;
  templates: TeamTemplate[];
  connected: boolean;
  error?: string;
  loading: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const { collapsed, projects, roomsByProject, activeProjectId, activeRoomId, templates, connected, error, loading, onResizeStart } = props;
  const connectionBadge = badgeToneProps(connected ? "blueprint" : "correction");
  const actionsDisabled = !connected || loading;
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>(() =>
    createInitialExpandedProjectIds(projects, activeProjectId),
  );

  useEffect(() => {
    setExpandedProjectIds((current) => {
      const next = Object.fromEntries(projects.map((project) => [project.id, current[project.id] ?? project.id === activeProjectId])) as Record<
        string,
        boolean
      >;

      if (activeProjectId && !next[activeProjectId]) {
        next[activeProjectId] = true;
      }

      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      const hasSameKeys = currentKeys.length === nextKeys.length && nextKeys.every((key) => currentKeys.includes(key));
      const hasSameValues = hasSameKeys && nextKeys.every((key) => current[key] === next[key]);

      return hasSameValues ? current : next;
    });
  }, [activeProjectId, projects]);

  if (collapsed) {
    return <aside className="min-h-0 min-w-0 overflow-hidden" data-collapsed="true" aria-hidden />;
  }

  return (
    <aside className="relative z-20 flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden border-r border-border/60 bg-background/96 px-4 py-5 backdrop-blur md:px-5 max-[860px]:absolute max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:w-[min(21rem,82vw)] max-[860px]:shadow-2xl">
      <Card className="shrink-0 border border-border shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
              <Waves size={22} />
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-2xl font-semibold tracking-tight">OpenAquarium</p>
              <p className="m-0 text-sm text-muted-foreground">ACP multi-agent workspace.</p>
            </div>
          </div>
          <ThemeToggle className="w-full" />
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={connectionBadge.variant} className={connectionBadge.className}>
              {connected ? "Runtime online" : "Runtime offline"}
            </Badge>
            {loading ? <Badge variant="secondary">Loading state…</Badge> : null}
            <CreateProjectDialog templates={templates} triggerClassName="ml-auto" disabled={actionsDisabled} />
          </div>
          {!connected ? (
            <p className="m-0 text-xs leading-5 text-muted-foreground">
              启动本地 runtime：<span className="font-mono">bun run server</span>
            </p>
          ) : null}
          {error ? <p className="m-0 text-xs leading-5 text-destructive">{error}</p> : null}
        </CardContent>
      </Card>

      <Card className="min-h-0 flex-[1.35] border border-border shadow-sm">
        <CardContent className="flex h-full min-h-0 flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <FolderKanban size={20} />
              <p className="m-0 text-xl font-semibold tracking-tight">Projects</p>
            </div>
            <CreateRoomDialog activeProjectId={activeProjectId} projects={projects} templates={templates} disabled={actionsDisabled} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-4">
              {projects.map((project) => (
                <Card
                  key={project.id}
                  size="sm"
                  className={cn(
                    "border border-border shadow-sm",
                    project.id === activeProjectId && "border-ring bg-accent/5",
                  )}
                >
                  <CardContent className="flex flex-col gap-3 p-3">
                    <button
                      type="button"
                      className="flex w-full items-start justify-between gap-3 text-left"
                      onClick={() =>
                        setExpandedProjectIds((current) => ({
                          ...current,
                          [project.id]: !current[project.id],
                        }))
                      }
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-semibold tracking-tight">{project.name}</span>
                        <span className="block text-sm text-muted-foreground">{roomsByProject[project.id]?.length ?? 0} rooms</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline">{roomsByProject[project.id]?.length ?? 0}</Badge>
                        {expandedProjectIds[project.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </span>
                    </button>
                    {expandedProjectIds[project.id] ? (
                      <div className="flex flex-col gap-2">
                        {(roomsByProject[project.id] ?? []).map((room) => (
                          <Link
                            key={room.id}
                            to="/projects/$projectId/rooms/$roomId"
                            params={{ projectId: project.id, roomId: room.id }}
                            className="no-underline"
                          >
                            <div
                              className={cn(
                                "flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left shadow-sm transition-colors hover:bg-muted/60",
                                room.id === activeRoomId && "border-ring bg-accent/5",
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium">{room.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {summarizePrompt(room.topic, 40)}
                                </span>
                              </span>
                              <MessageSquareShare size={18} />
                            </div>
                          </Link>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div
        aria-hidden
        className="absolute inset-y-0 -right-2 hidden w-4 cursor-col-resize lg:block"
        onPointerDown={onResizeStart}
      >
        <div className="absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-border/80" />
      </div>
    </aside>
  );
}

function createInitialExpandedProjectIds(projects: Project[], activeProjectId?: string): Record<string, boolean> {
  const defaultExpandedProjectId = activeProjectId ?? projects[0]?.id;

  return Object.fromEntries(projects.map((project) => [project.id, project.id === defaultExpandedProjectId])) as Record<string, boolean>;
}
