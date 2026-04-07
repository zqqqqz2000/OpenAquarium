import { useState, type PointerEvent as ReactPointerEvent } from "react";

import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, CirclePause, FolderKanban, LoaderCircle, PanelLeftOpen, Pause, Play, Settings2, Trash2, Waves, X } from "lucide-react";

import type { Project, Room, TeamTemplate } from "@/domain/model";
import { RunningMembersHoverCard, type RunningMemberPreview } from "@/components/members/running-members-hover-card";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreateRoomDialog } from "@/components/projects/create-room-dialog";
import { LocaleToggle } from "@/components/theme/locale-toggle";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RoomWatcherPauseSummary } from "@/lib/watcher-state";
import { badgeToneProps, compactBadgeClassName } from "@/lib/ui-tone";
import { cn, summarizePrompt } from "@/lib/utils";
import { formatRelativeActivityShort, type ProjectActivitySummary, type RoomActivitySummary } from "@/lib/workspace-activity";

function ActivityTimestamp(props: { updatedAt: string }) {
  const { updatedAt } = props;

  return (
    <p className="m-0 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground" title={updatedAt}>
      Updated {formatRelativeActivityShort(updatedAt)}
    </p>
  );
}

function UnreadCountBadge(props: { count: number }) {
  const { count } = props;

  if (count <= 0) {
    return null;
  }

  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function RunningPresenceBadge(props: { hasRunning: boolean; runningCount: number; idleLabel?: string; className?: string }) {
  const { hasRunning, runningCount, idleLabel = "Idle", className } = props;

  return (
    <Badge
      variant="outline"
      className={cn(
        compactBadgeClassName,
        "gap-1.5",
        hasRunning
          ? "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-badge)] text-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_1px_rgba(120,150,255,0.08)]"
          : "border-border/80 bg-background/70 text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          hasRunning
            ? "animate-oa-breathe bg-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_0.24rem_rgba(113,113,255,0.12)]"
            : "bg-muted-foreground/45",
        )}
      />
      {hasRunning ? (runningCount > 1 ? `${runningCount} live` : "Running") : idleLabel}
    </Badge>
  );
}

function SidebarRunningBadge(props: {
  runningMembers: RunningMemberPreview[];
  hasRunning: boolean;
  runningCount: number;
  idleLabel?: string;
  onOpenMember?: (preview: RunningMemberPreview) => void;
}) {
  const { runningMembers, hasRunning, runningCount, idleLabel, onOpenMember } = props;

  if (!hasRunning || runningMembers.length === 0 || !onOpenMember) {
    return <RunningPresenceBadge hasRunning={hasRunning} runningCount={runningCount} idleLabel={idleLabel} />;
  }

  return (
    <RunningMembersHoverCard members={runningMembers} side="right" align="start" onOpenMember={onOpenMember}>
      <span
        aria-label="Show running members"
        className="inline-flex align-middle"
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <RunningPresenceBadge hasRunning={hasRunning} runningCount={runningCount} idleLabel={idleLabel} />
      </span>
    </RunningMembersHoverCard>
  );
}

function RoomWatcherSuspensionButton(props: {
  room: Room;
  disabled: boolean;
  pending: boolean;
  onToggle?: (roomId: string) => void;
}) {
  const { room, disabled, pending, onToggle } = props;
  const suspended = room.watchersSuspended === true;
  const actionLabel = suspended ? `Resume watcher execution for ${room.name}` : `Suspend watcher execution for ${room.name}`;
  const tooltipLabel = suspended
    ? "Resume watcher execution. Existing watcher config will stay unchanged."
    : "Suspend watcher execution for this room without changing any watcher's original state.";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={suspended ? "secondary" : "ghost"}
          size="icon-xs"
          aria-label={actionLabel}
          disabled={disabled || pending || !onToggle}
          onClick={() => onToggle?.(room.id)}
        >
          {pending ? <LoaderCircle size={14} className="animate-spin" /> : suspended ? <Play size={14} /> : <Pause size={14} />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

function RoomWatcherPausedBadge(props: { summary?: RoomWatcherPauseSummary }) {
  const { summary } = props;
  const pausedUntilActivityCount = summary?.pausedUntilActivityCount ?? 0;
  const enabledCount = summary?.enabledCount ?? 0;

  if (pausedUntilActivityCount <= 0) {
    return null;
  }

  const tooltipLabel =
    enabledCount > 1
      ? `${pausedUntilActivityCount} of ${enabledCount} enabled watchers are paused until room activity. This is separate from room-level Watch hold.`
      : "This room has an enabled watcher paused until room activity. This is separate from room-level Watch hold.";
  const ariaLabel = pausedUntilActivityCount > 1 ? "Watchers paused until activity" : "Watcher paused until activity";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={ariaLabel}
          className="inline-flex size-5 items-center justify-center rounded-full border border-sky-500/45 bg-sky-500/10 text-sky-700 dark:text-sky-300"
        >
          <CirclePause size={12} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltipLabel}</TooltipContent>
    </Tooltip>
  );
}

function ProjectRow(props: {
  project: Project;
  rooms: Room[];
  projectActivity?: ProjectActivitySummary;
  roomActivityById: Record<string, RoomActivitySummary>;
  roomWatcherPauseById?: Record<string, RoomWatcherPauseSummary>;
  projectUnreadCount: number;
  roomUnreadCountById: Record<string, number>;
  projectRunningMembers: RunningMemberPreview[];
  roomRunningMembersById: Record<string, RunningMemberPreview[]>;
  isActiveProject: boolean;
  activeRoomId?: string;
  expanded: boolean;
  actionsDisabled: boolean;
  templates: TeamTemplate[];
  deletingProjectId?: string;
  deletingRoomId?: string;
  togglingRoomWatcherSuspensionRoomId?: string;
  pendingDelete?: { kind: "project" | "room" | "template"; id: string };
  onClearPendingDelete: () => void;
  onToggleExpanded: () => void;
  onSetPendingDelete: (payload: { kind: "project" | "room" | "template"; id: string }) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleRoomWatcherSuspension?: (roomId: string) => void;
  onOpenMember?: (projectId: string, roomId: string, memberId: string) => void;
}) {
  const {
    project,
    rooms,
    projectActivity,
    roomActivityById,
    roomWatcherPauseById,
    projectUnreadCount,
    roomUnreadCountById,
    projectRunningMembers,
    roomRunningMembersById,
    isActiveProject,
    activeRoomId,
    expanded,
    actionsDisabled,
    templates,
    deletingProjectId,
    deletingRoomId,
    togglingRoomWatcherSuspensionRoomId,
    pendingDelete,
    onClearPendingDelete,
    onToggleExpanded,
    onSetPendingDelete,
    onDeleteProject,
    onDeleteRoom,
    onToggleRoomWatcherSuspension,
    onOpenMember,
  } = props;
  const isPendingDelete = pendingDelete?.kind === "project" && pendingDelete.id === project.id;

  return (
    <section
      className={cn(
        "rounded-[1.35rem] border border-border/75 bg-card/80 px-3 py-2.5 text-card-foreground shadow-[0_12px_24px_-28px_rgba(15,23,42,0.55)] transition-colors",
        isActiveProject && "border-ring bg-accent/5",
        projectActivity?.hasRunning && "border-[color:var(--tone-blueprint-border)]/85 bg-[color:var(--tone-blueprint-surface)]/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <button
            type="button"
            className="block w-full truncate rounded-none border-0 bg-transparent p-0 text-left text-[15px] font-semibold tracking-tight"
            onClick={onToggleExpanded}
          >
            {project.name}
          </button>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="h-6 rounded-full px-2 text-[10px] uppercase tracking-[0.14em]">
              {rooms.length} rooms
            </Badge>
            <UnreadCountBadge count={projectUnreadCount} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CreateRoomDialog
            project={project}
            templates={templates}
            disabled={actionsDisabled}
            triggerMode="icon"
            triggerClassName="size-7"
          />
          {isPendingDelete ? (
            <>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Cancel deleting ${project.name}`} onClick={onClearPendingDelete}>
                <X size={14} />
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="icon-xs"
                aria-label={`Delete ${project.name}`}
                disabled={actionsDisabled || deletingProjectId === project.id}
                onClick={() => {
                  onClearPendingDelete();
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
              onClick={() => onSetPendingDelete({ kind: "project", id: project.id })}
            >
              <Trash2 size={14} />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={expanded ? `Collapse ${project.name}` : `Expand ${project.name}`}
            onClick={() => {
              onClearPendingDelete();
              onToggleExpanded();
            }}
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
        <ActivityTimestamp updatedAt={projectActivity?.updatedAt ?? project.updatedAt ?? project.createdAt} />
        <SidebarRunningBadge
          runningMembers={projectRunningMembers}
          hasRunning={projectActivity?.hasRunning ?? false}
          runningCount={projectActivity?.runningCount ?? 0}
          idleLabel="Idle"
          onOpenMember={onOpenMember ? (preview) => onOpenMember(project.id, preview.roomId, preview.memberId) : undefined}
        />
      </div>

      {expanded ? (
        <div className="mt-2.5 flex flex-col gap-1.5">
          {rooms.length > 0 ? (
            rooms.map((room) => {
              const roomActivity = roomActivityById[room.id];
              const roomWatcherPauseSummary = roomWatcherPauseById?.[room.id];
              const isActiveRoom = room.id === activeRoomId;
              const roomPendingDelete = pendingDelete?.kind === "room" && pendingDelete.id === room.id;

              return (
                <div
                  key={room.id}
                  className={cn(
                    "flex items-start gap-2 rounded-xl border border-border/70 bg-background/80 px-2.5 py-2 transition-colors",
                    isActiveRoom && "border-ring bg-accent/7",
                    roomActivity?.hasRunning && "border-[color:var(--tone-blueprint-border)]/75 bg-[color:var(--tone-blueprint-surface)]/70",
                    isActiveRoom && roomActivity?.hasRunning && "ring-1 ring-ring",
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Link
                      to="/projects/$projectId/rooms/$roomId"
                      params={{ projectId: project.id, roomId: room.id }}
                      className="min-w-0 flex-1 no-underline"
                      onClick={onClearPendingDelete}
                    >
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-medium">{room.name}</p>
                        <p className="m-0 truncate pt-0.5 text-xs text-muted-foreground">
                          {summarizePrompt(room.topic || "No topic yet.", 54)}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <RoomWatcherPausedBadge summary={roomWatcherPauseSummary} />
                          <ActivityTimestamp updatedAt={roomActivity?.updatedAt ?? room.updatedAt ?? room.createdAt} />
                        </div>
                      </div>
                    </Link>
                    <div className="flex shrink-0 items-start gap-1.5 pt-0.5">
                      <UnreadCountBadge count={roomUnreadCountById[room.id] ?? 0} />
                      <SidebarRunningBadge
                        runningMembers={roomRunningMembersById[room.id] ?? []}
                        hasRunning={roomActivity?.hasRunning ?? false}
                        runningCount={roomActivity?.runningCount ?? 0}
                        idleLabel="Ready"
                        onOpenMember={onOpenMember ? (preview) => onOpenMember(project.id, preview.roomId, preview.memberId) : undefined}
                      />
                      <RoomWatcherSuspensionButton
                        room={room}
                        disabled={actionsDisabled}
                        pending={togglingRoomWatcherSuspensionRoomId === room.id}
                        onToggle={onToggleRoomWatcherSuspension}
                      />
                    </div>
                  </div>
                  {roomPendingDelete ? (
                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Cancel deleting ${room.name}`} onClick={onClearPendingDelete}>
                        <X size={14} />
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon-xs"
                        aria-label={`Delete ${room.name}`}
                        disabled={actionsDisabled || deletingRoomId === room.id}
                        onClick={() => {
                          onClearPendingDelete();
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
                      onClick={() => onSetPendingDelete({ kind: "room", id: room.id })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              );
            })
          ) : (
            <div className="rounded-xl bg-muted/30 px-2.5 py-2 text-sm text-muted-foreground">No rooms yet.</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function Sidebar(props: {
  collapsed: boolean;
  overlay?: boolean;
  onToggleCollapsed?: () => void;
  projects: Project[];
  roomsByProject: Record<string, Room[]>;
  projectActivityById: Record<string, ProjectActivitySummary>;
  roomActivityById: Record<string, RoomActivitySummary>;
  roomWatcherPauseById?: Record<string, RoomWatcherPauseSummary>;
  projectUnreadCountById: Record<string, number>;
  roomUnreadCountById: Record<string, number>;
  projectRunningMembersById: Record<string, RunningMemberPreview[]>;
  roomRunningMembersById: Record<string, RunningMemberPreview[]>;
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
  togglingRoomWatcherSuspensionRoomId?: string;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDeleteProject: (projectId: string) => void;
  onDeleteRoom: (roomId: string) => void;
  onToggleRoomWatcherSuspension?: (roomId: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onOpenTemplate: (templateId: string) => void;
  onOpenTemplateStudio: () => void;
  onOpenMember?: (projectId: string, roomId: string, memberId: string) => void;
}) {
  const {
    collapsed,
    overlay = false,
    onToggleCollapsed,
    projects,
    roomsByProject,
    projectActivityById,
    roomActivityById,
    roomWatcherPauseById,
    projectUnreadCountById,
    roomUnreadCountById,
    projectRunningMembersById,
    roomRunningMembersById,
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
    togglingRoomWatcherSuspensionRoomId,
    onResizeStart,
    onDeleteProject,
    onDeleteRoom,
    onToggleRoomWatcherSuspension,
    onDeleteTemplate,
    onOpenTemplate,
    onOpenTemplateStudio,
    onOpenMember,
  } = props;
  const actionsDisabled = !connected || loading;
  const { t } = useI18n();
  const [expandedProjectOverrides, setExpandedProjectOverrides] = useState<Record<string, boolean>>({});
  const [templatesExpanded, setTemplatesExpanded] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ kind: "project" | "room" | "template"; id: string } | undefined>(undefined);
  const defaultExpandedProjectId = activeProjectId ?? projects[0]?.id;
  const expandedProjectIds = Object.fromEntries(
    projects.map((project) => [project.id, expandedProjectOverrides[project.id] ?? project.id === defaultExpandedProjectId]),
  ) as Record<string, boolean>;

  if (collapsed) {
    if (!overlay && onToggleCollapsed) {
      return (
        <aside className="relative z-20 flex h-full min-h-0 min-w-0 flex-col items-center gap-3 overflow-hidden border-r border-border/60 bg-background/92 px-2 py-3 backdrop-blur">
          <Button
            aria-label="Show projects sidebar"
            className="shrink-0"
            size="icon-sm"
            type="button"
            variant="outline"
            onClick={onToggleCollapsed}
          >
            <PanelLeftOpen size={16} />
          </Button>
          <span className="rotate-180 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground [writing-mode:vertical-rl]">
            Projects
          </span>
        </aside>
      );
    }

    return <aside className="min-h-0 min-w-0 overflow-hidden" data-collapsed="true" aria-hidden />;
  }

  return (
    <aside
      className={cn(
        "relative z-20 shrink-0 flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden border-r border-border/60 bg-background/96 px-3 py-3 backdrop-blur md:px-3.5",
        overlay && "absolute inset-y-0 left-0 w-[min(21rem,82vw)] shadow-2xl",
      )}
    >
      <div className="shrink-0 space-y-2">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex size-8 items-center justify-center rounded-xl border border-border/70 bg-card shadow-sm">
            <Waves size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <p className="m-0 truncate text-[1.65rem] font-semibold tracking-tight">OpenAquarium</p>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    aria-label={connected ? t("sidebar.runtimeOnline") : t("sidebar.runtimeOffline")}
                    className={cn(
                      "inline-flex size-2.5 shrink-0 rounded-full border border-black/5",
                      connected
                        ? "bg-lime-400 shadow-[0_0_14px_rgba(163,230,53,0.95)]"
                        : "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.75)]",
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="bottom">{connected ? t("sidebar.runtimeOnline") : t("sidebar.runtimeOffline")}</TooltipContent>
              </Tooltip>
              {loading ? <Badge variant="secondary">{t("sidebar.loading")}</Badge> : null}
            </div>
            <p className="m-0 text-xs text-muted-foreground">{t("sidebar.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            <ThemeToggle mode="compact" />
            <LocaleToggle mode="compact" />
          </div>
        </div>
        {!connected ? (
          <p className="m-0 text-xs leading-5 text-muted-foreground">
            {t("sidebar.startRuntime")} <span className="font-mono">bun run server</span>
          </p>
        ) : null}
        {error ? <p className="m-0 text-xs leading-5 text-destructive">{error}</p> : null}
      </div>

      <div className="min-h-0 flex-1 border-t border-border/40 pt-2.5">
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <FolderKanban size={18} />
              <p className="m-0 text-lg font-semibold tracking-tight">{t("sidebar.projects")}</p>
              <Badge variant="outline">{projects.length}</Badge>
            </div>
            <CreateProjectDialog templates={templates} triggerMode="icon" disabled={actionsDisabled} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex flex-col gap-2">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  rooms={roomsByProject[project.id] ?? []}
                  projectActivity={projectActivityById[project.id]}
                  roomActivityById={roomActivityById}
                  roomWatcherPauseById={roomWatcherPauseById}
                  projectUnreadCount={projectUnreadCountById[project.id] ?? 0}
                  roomUnreadCountById={roomUnreadCountById}
                  projectRunningMembers={projectRunningMembersById[project.id] ?? []}
                  roomRunningMembersById={roomRunningMembersById}
                  isActiveProject={project.id === activeProjectId}
                  activeRoomId={activeRoomId}
                  expanded={expandedProjectIds[project.id]}
                  actionsDisabled={actionsDisabled}
                  templates={templates}
                  deletingProjectId={deletingProjectId}
                  deletingRoomId={deletingRoomId}
                  togglingRoomWatcherSuspensionRoomId={togglingRoomWatcherSuspensionRoomId}
                  pendingDelete={pendingDelete}
                  onClearPendingDelete={() => setPendingDelete(undefined)}
                  onToggleExpanded={() =>
                    setExpandedProjectOverrides((current) => ({
                      ...current,
                      [project.id]: !expandedProjectIds[project.id],
                    }))
                  }
                  onSetPendingDelete={setPendingDelete}
                  onDeleteProject={onDeleteProject}
                  onDeleteRoom={onDeleteRoom}
                  onToggleRoomWatcherSuspension={onToggleRoomWatcherSuspension}
                  onOpenMember={onOpenMember}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border/40 pt-2.5">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <button
              type="button"
              aria-expanded={templatesExpanded}
              aria-label={templatesExpanded ? "Collapse team templates" : "Expand team templates"}
              className="flex min-w-0 items-center gap-2 rounded-none border-0 bg-transparent p-0 text-left"
              onClick={() => setTemplatesExpanded((current) => !current)}
            >
              <Settings2 size={18} />
              <p className="m-0 text-lg font-semibold tracking-tight">Team templates</p>
              <Badge variant="outline">{templates.length}</Badge>
              {templatesExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
            <Button variant="ghost" size="icon-sm" aria-label="Open team template studio" onClick={onOpenTemplateStudio}>
              <Settings2 size={16} />
            </Button>
          </div>
          {templatesExpanded ? (
            <div className="max-h-[min(18rem,30vh)] overflow-y-auto pr-1" data-testid="sidebar-templates-scroll">
              <div className="flex flex-col gap-2">
                {templates.map((template) => {
                  const templateBadge = badgeToneProps(template.accentTone);
                  const isPendingDelete = pendingDelete?.kind === "template" && pendingDelete.id === template.id;

                  return (
                    <div
                      key={template.id}
                      className={cn(
                        "rounded-[1.2rem] border border-border/75 bg-card/85 px-3 py-2.5 shadow-[0_10px_22px_-28px_rgba(15,23,42,0.55)] transition-colors",
                        template.id === activeTemplateId && "border-ring bg-accent/5",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left"
                          onClick={() => {
                            setPendingDelete(undefined);
                            onOpenTemplate(template.id);
                          }}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold tracking-tight">{template.name}</span>
                              <span className="mt-1 block text-xs leading-5 text-muted-foreground">{summarizePrompt(template.description, 88)}</span>
                            </span>
                            <Badge variant={templateBadge.variant} className={cn(templateBadge.className, "shrink-0")}>
                              {template.members.length}
                            </Badge>
                          </div>
                        </button>
                        {isPendingDelete ? (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button type="button" variant="ghost" size="icon-xs" aria-label={`Cancel deleting ${template.name}`} onClick={() => setPendingDelete(undefined)}>
                              <X size={14} />
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              size="icon-xs"
                              aria-label={`Delete ${template.name}`}
                              disabled={actionsDisabled || deletingTemplateId === template.id}
                              onClick={() => {
                                setPendingDelete(undefined);
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
