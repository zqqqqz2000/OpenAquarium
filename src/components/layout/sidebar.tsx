import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, FolderKanban, MessageSquareShare, Waves } from "lucide-react";

import type { Project, Room, TeamTemplate } from "@/domain/model";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreateRoomDialog } from "@/components/projects/create-room-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
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
  const [expandedProjectOverrides, setExpandedProjectOverrides] = useState<Record<string, boolean>>({});
  const defaultExpandedProjectId = activeProjectId ?? projects[0]?.id;
  const expandedProjectIds = Object.fromEntries(
    projects.map((project) => [project.id, expandedProjectOverrides[project.id] ?? project.id === defaultExpandedProjectId]),
  ) as Record<string, boolean>;
  const toggleProjectExpanded = (projectId: string): void => {
    setExpandedProjectOverrides((current) => ({
      ...current,
      [projectId]: !expandedProjectIds[projectId],
    }));
  };

  if (collapsed) {
    return <aside className="min-h-0 min-w-0 overflow-hidden" data-collapsed="true" aria-hidden />;
  }

  return (
    <aside className="relative z-20 flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden border-r border-border/60 bg-background/96 px-3 py-3 backdrop-blur md:px-4 max-[860px]:absolute max-[860px]:inset-y-0 max-[860px]:left-0 max-[860px]:w-[min(21rem,82vw)] max-[860px]:shadow-2xl">
      <div className="shrink-0 space-y-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl border border-border/70 bg-card shadow-sm">
            <Waves size={20} />
          </div>
          <div className="min-w-0">
            <p className="m-0 truncate text-[1.9rem] font-semibold tracking-tight">OpenAquarium</p>
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
      </div>

      <div className="min-h-0 flex-[1.35] border-t border-border/40 pt-3">
        <div className="flex h-full min-h-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <FolderKanban size={18} />
              <p className="m-0 text-xl font-semibold tracking-tight">Projects</p>
              <Badge variant="outline">{projects.length}</Badge>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2.5">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className={cn(
                    "rounded-[1.45rem] border border-border/80 bg-card px-3 py-2.5 text-sm text-card-foreground shadow-sm",
                    project.id === activeProjectId && "border-ring bg-accent/5",
                  )}
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="block w-full truncate rounded-none border-0 bg-transparent p-0 text-left text-base font-semibold tracking-tight"
                          onClick={() => toggleProjectExpanded(project.id)}
                        >
                          {project.name}
                        </button>
                        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <button
                            type="button"
                            className="rounded-none border-0 bg-transparent p-0 text-left text-sm text-muted-foreground"
                            onClick={() => toggleProjectExpanded(project.id)}
                          >
                            {roomsByProject[project.id]?.length ?? 0} rooms
                          </button>
                          <CreateRoomDialog
                            project={project}
                            templates={templates}
                            disabled={actionsDisabled}
                            triggerMode="icon"
                            triggerClassName="size-6"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={expandedProjectIds[project.id] ? `Collapse ${project.name}` : `Expand ${project.name}`}
                        className="flex shrink-0 items-center gap-2 self-start rounded-none border-0 bg-transparent p-0"
                        onClick={() => toggleProjectExpanded(project.id)}
                      >
                        <Badge variant="outline">{roomsByProject[project.id]?.length ?? 0}</Badge>
                        {expandedProjectIds[project.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                      </button>
                    </div>
                    {expandedProjectIds[project.id] ? (
                      <div className="flex flex-col gap-1.5">
                        {(roomsByProject[project.id] ?? []).length > 0 ? (
                          (roomsByProject[project.id] ?? []).map((room) => (
                            <Link
                              key={room.id}
                              to="/projects/$projectId/rooms/$roomId"
                              params={{ projectId: project.id, roomId: room.id }}
                              className="no-underline"
                            >
                              <div
                                className={cn(
                                  "flex items-center justify-between rounded-lg border border-border/70 bg-card px-2.5 py-1.5 text-left shadow-sm transition-colors hover:bg-muted/60",
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
                          ))
                        ) : (
                          <div className="rounded-lg bg-muted/25 px-2.5 py-1.5 text-sm text-muted-foreground">No rooms yet.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

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
