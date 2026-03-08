import { Link } from "@tanstack/react-router";
import { FolderKanban, MessageSquareShare, Waves } from "lucide-react";

import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import type { Project, Room, TeamTemplate } from "@/domain/model";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
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
  loading: boolean;
  onToggleCollapsed: () => void;
}) {
  const { collapsed, projects, roomsByProject, activeProjectId, activeRoomId, templates, connected, loading, onToggleCollapsed } = props;
  const connectionBadge = badgeToneProps(connected ? "blueprint" : "correction");

  if (collapsed) {
    return <aside className="min-h-0 min-w-0 overflow-hidden" data-collapsed="true" aria-hidden />;
  }

  return (
    <aside className="flex min-h-screen min-w-0 flex-col gap-5 border-r border-border/60 px-4 py-5 md:px-5">
      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
                <Waves size={24} />
              </div>
              <div className="min-w-0">
                <p className="m-0 truncate text-2xl font-semibold tracking-tight">OpenAquarium</p>
                <p className="m-0 text-sm text-muted-foreground">ACP multi-agent workspace.</p>
              </div>
            </div>
            <PanelToggleButton collapsed={false} side="left" onToggle={onToggleCollapsed} />
          </div>
          <ThemeToggle className="w-full" />
          <CreateProjectDialog templates={templates} triggerClassName="w-full justify-center" />
          <div className="flex flex-wrap gap-2">
            <Badge variant={connectionBadge.variant} className={connectionBadge.className}>
              {connected ? "Runtime online" : "Runtime offline"}
            </Badge>
            {loading ? <Badge variant="secondary">Loading state…</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <FolderKanban size={20} />
            <p className="m-0 text-xl font-semibold tracking-tight">Projects</p>
          </div>
          <div className="flex flex-col gap-4">
            {projects.map((project) => (
              <Card
                key={project.id}
                className={cn(
                  "border border-border shadow-sm",
                  project.id === activeProjectId && "border-ring bg-accent/5",
                )}
              >
                <CardContent className="flex flex-col gap-3 p-3">
                  <div>
                    <p className="m-0 text-base font-semibold tracking-tight">{project.name}</p>
                    <p className="m-0 text-sm text-muted-foreground">{roomsByProject[project.id]?.length ?? 0} rooms</p>
                  </div>
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
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="m-0 text-lg font-semibold tracking-tight">Default templates</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => {
              const toneBadge = badgeToneProps(template.accentTone);

              return (
                <Badge key={template.id} variant={toneBadge.variant} className={toneBadge.className}>
                  {template.name}
                </Badge>
              );
            })}
          </div>
          <p className="m-0 text-sm text-muted-foreground">
            template 由首条问题绑定。后续可以新增 room，但不会在当前 room 中途替换成员阵容。
          </p>
        </CardContent>
      </Card>
    </aside>
  );
}
