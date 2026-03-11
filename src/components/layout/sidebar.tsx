import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, FolderKanban, LoaderCircle, Settings2, Trash2, Waves, X } from "lucide-react";

import type { Project, Room, TeamTemplate } from "@/domain/model";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreateRoomDialog } from "@/components/projects/create-room-dialog";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, summarizePrompt } from "@/lib/utils";
import { badgeToneProps } from "@/lib/ui-tone";

export function Sidebar(props: {
  collapsed: boolean;
  projects: Project[];
  roomsByProject: Record<string, Room[]>;
  activeProjectId?: string;
  activeRoomId?: string;
  templates: TeamTemplate[];
  activeTemplateId?: string;
  connected: boolean;
  error?: string;
  loading: boolean;
  deletingProjectId?: string;
  deletingRoomId?: string;
  deletingTemplateId?: string;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onOpenTemplate: (templateId: string) => void;
  onOpenTemplateStudio: () => void;
}) {
  const {
    collapsed,
    projects,
    roomsByProject,
    activeProjectId,
    activeRoomId,
    templates,
    activeTemplateId,
    connected,
    error,
    loading,
    deletingProjectId,
    deletingRoomId,
    deletingTemplateId,
    onResizeStart,
    onDeleteProject,
    onDeleteRoom,
    onDeleteTemplate,
    onOpenTemplate,
    onOpenTemplateStudio,
  } = props;
  const actionsDisabled = !connected || loading;
  const [expandedProjectOverrides, setExpandedProjectOverrides] = useState<Record<string, boolean>>({});
  const [templatesExpanded, setTemplatesExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "project" | "room" | "template"; id: string } | undefined>(undefined);
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

  const isPendingDelete = (kind: "project" | "room" | "template", id: string): boolean =>
    pendingDelete?.kind === kind && pendingDelete.id === id;

  const clearPendingDelete = (): void => {
    setPendingDelete(undefined);
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
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="m-0 truncate text-[1.9rem] font-semibold tracking-tight">OpenAquarium</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label={connected ? "Runtime online" : "Runtime offline"}
                    className={cn(
                      "inline-flex size-2.5 shrink-0 rounded-full border border-black/5",
                      connected
                        ? "bg-lime-400 shadow-[0_0_14px_rgba(163,230,53,0.95)]"
                        : "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.75)]",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">{connected ? "Runtime online" : "Runtime offline"}</TooltipContent>
              </Tooltip>
              {loading ? <Badge variant="secondary">Loading state…</Badge> : null}
            </div>
            <p className="m-0 text-sm text-muted-foreground">ACP multi-agent workspace.</p>
          </div>
        </div>
        <ThemeToggle className="w-full" />
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
            <CreateProjectDialog
              templates={templates}
              triggerMode="icon"
              disabled={actionsDisabled}
            />
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
                          <div className="flex shrink-0 items-center gap-1 self-start">
                            {isPendingDelete("project", project.id) ? (
                              <>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`Cancel deleting ${project.name}`}
                                  onClick={clearPendingDelete}
                                >
                                  <X size={14} />
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="icon-xs"
                                  aria-label={`Delete ${project.name}`}
                                  disabled={actionsDisabled || deletingProjectId === project.id}
                                  onClick={() => {
                                    clearPendingDelete();
                                    onDeleteProject(project.id);
                                  }}
                                >
                                  {deletingProjectId === project.id ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                </Button>
                              </>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Delete ${project.name}`}
                                disabled={actionsDisabled}
                                onClick={() => setPendingDelete({ kind: "project", id: project.id })}
                              >
                                <Trash2 size={14} />
                              </Button>
                            )}
                            <button
                              type="button"
                              aria-label={expandedProjectIds[project.id] ? `Collapse ${project.name}` : `Expand ${project.name}`}
                              className="flex shrink-0 items-center gap-2 rounded-none border-0 bg-transparent p-0"
                              onClick={() => {
                                clearPendingDelete();
                                toggleProjectExpanded(project.id);
                              }}
                            >
                              <Badge variant="outline">{roomsByProject[project.id]?.length ?? 0}</Badge>
                              {expandedProjectIds[project.id] ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                            </button>
                          </div>
                    </div>
                    {expandedProjectIds[project.id] ? (
                      <div className="flex flex-col gap-1.5">
                        {(roomsByProject[project.id] ?? []).length > 0 ? (
                          (roomsByProject[project.id] ?? []).map((room) => (
                            <div
                              key={room.id}
                              className={cn(
                                "flex items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 py-1.5 shadow-sm transition-colors",
                                room.id === activeRoomId && "border-ring bg-accent/5",
                              )}
                            >
                              <Link
                                to="/projects/$projectId/rooms/$roomId"
                                params={{ projectId: project.id, roomId: room.id }}
                                className="min-w-0 flex-1 no-underline"
                                onClick={clearPendingDelete}
                              >
                                <div className="flex items-center justify-between gap-3 text-left">
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{room.name}</span>
                                    <span className="block truncate text-xs text-muted-foreground">
                                      {summarizePrompt(room.topic, 40)}
                                    </span>
                                  </span>
                                </div>
                              </Link>
                              {isPendingDelete("room", room.id) ? (
                                <div className="flex shrink-0 items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`Cancel deleting ${room.name}`}
                                    onClick={clearPendingDelete}
                                  >
                                    <X size={14} />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon-xs"
                                    aria-label={`Delete ${room.name}`}
                                    disabled={actionsDisabled || deletingRoomId === room.id}
                                    onClick={() => {
                                      clearPendingDelete();
                                      onDeleteRoom(room.id);
                                    }}
                                  >
                                    {deletingRoomId === room.id ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={`Delete ${room.name}`}
                                  disabled={actionsDisabled}
                                  onClick={() => setPendingDelete({ kind: "room", id: room.id })}
                                >
                                  <Trash2 size={14} />
                                </Button>
                              )}
                            </div>
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

      <div className="shrink-0 border-t border-border/40 pt-3">
        <div className="flex min-h-0 flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <button
              type="button"
              aria-expanded={templatesExpanded}
              aria-label={templatesExpanded ? "Collapse team templates" : "Expand team templates"}
              className="flex min-w-0 items-center gap-2 rounded-none border-0 bg-transparent p-0 text-left"
              onClick={() => setTemplatesExpanded((current) => !current)}
            >
              <Settings2 size={18} />
              <p className="m-0 text-xl font-semibold tracking-tight">Team templates</p>
              <Badge variant="outline">{templates.length}</Badge>
              {templatesExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            <Button variant="ghost" size="icon-sm" aria-label="Open team template studio" onClick={onOpenTemplateStudio}>
              <Settings2 size={16} />
            </Button>
          </div>
          {templatesExpanded ? (
            <div
              className="max-h-[min(18rem,30vh)] overflow-y-auto pr-1"
              data-testid="sidebar-templates-scroll"
            >
              <div className="flex flex-col gap-2.5">
                {templates.map((template) => {
                  const templateBadge = badgeToneProps(template.accentTone);

                  return (
                    <div
                      key={template.id}
                      className={cn(
                        "rounded-[1.35rem] border border-border/80 bg-card px-3 py-3 shadow-sm transition-colors",
                        template.id === activeTemplateId && "border-ring bg-accent/5",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left"
                          onClick={() => {
                            clearPendingDelete();
                            onOpenTemplate(template.id);
                          }}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold tracking-tight">{template.name}</span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{summarizePrompt(template.description, 88)}</span>
                            </span>
                            <Badge variant={templateBadge.variant} className={cn(templateBadge.className, "shrink-0")}>
                              {template.members.length}
                            </Badge>
                          </div>
                        </button>
                        {isPendingDelete("template", template.id) ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              aria-label={`Cancel deleting ${template.name}`}
                              onClick={clearPendingDelete}
                            >
                              <X size={14} />
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon-xs"
                              aria-label={`Delete ${template.name}`}
                              disabled={actionsDisabled || deletingTemplateId === template.id}
                              onClick={() => {
                                clearPendingDelete();
                                onDeleteTemplate(template.id);
                              }}
                            >
                              {deletingTemplateId === template.id ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${template.name}`}
                            disabled={actionsDisabled}
                            onClick={() => setPendingDelete({ kind: "template", id: template.id })}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
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
