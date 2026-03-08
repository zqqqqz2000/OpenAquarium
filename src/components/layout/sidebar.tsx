import { Link } from "@tanstack/react-router";
import { FolderKanban, MessageSquareShare, Waves } from "lucide-react";

import type { Project, Room, TeamTemplate } from "@/domain/model";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { ThemeSwitcher } from "@/components/theme/theme-switcher";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { summarizePrompt, tilt, wobbly } from "@/lib/utils";

export function Sidebar(props: {
  projects: Project[];
  roomsByProject: Record<string, Room[]>;
  activeProjectId?: string;
  activeRoomId?: string;
  templates: TeamTemplate[];
  connected: boolean;
  loading: boolean;
}) {
  const { projects, roomsByProject, activeProjectId, activeRoomId, templates, connected, loading } = props;

  return (
    <aside className="flex min-h-screen flex-col gap-5 px-4 py-5 md:px-5">
      <Card className="thumbtack flex flex-col gap-4 p-5" tone="postit">
        <div className="flex items-center gap-3">
          <div
            className="rough-frame flex h-12 w-12 items-center justify-center bg-white"
            style={wobbly.listItem}
          >
            <Waves size={24} />
          </div>
          <div>
            <p className="scribble-underline m-0 text-4xl">OpenAquarium</p>
            <p className="m-0 text-lg opacity-70">A hand-drawn team tank for ACP members.</p>
          </div>
        </div>
        <CreateProjectDialog templates={templates} />
        <div className="flex flex-wrap gap-2">
          <Badge tone={connected ? "blueprint" : "correction"}>{connected ? "Runtime online" : "Runtime offline"}</Badge>
          {loading ? <Badge tone="paper">Loading state…</Badge> : null}
        </div>
        <ThemeSwitcher />
      </Card>

      <Card className="flex flex-col gap-4 p-4" tone="paper">
        <div className="flex items-center gap-2">
          <FolderKanban size={20} />
          <p className="m-0 text-2xl">Projects</p>
        </div>
        <div className="flex flex-col gap-4">
          {projects.map((project, projectIndex) => (
            <Card
              key={project.id}
              className="flex flex-col gap-3 p-3"
              tone={project.id === activeProjectId ? "postit" : projectIndex % 2 === 0 ? "paper" : "blueprint"}
              style={project.id === activeProjectId ? tilt.active : tilt.positive}
            >
              <div>
                <p className="m-0 text-2xl">{project.name}</p>
                <p className="m-0 text-base opacity-65">{roomsByProject[project.id]?.length ?? 0} rooms</p>
              </div>
              <div className="flex flex-col gap-2">
                {(roomsByProject[project.id] ?? []).map((room) => (
                  <Link
                    key={room.id}
                    to="/projects/$projectId/rooms/$roomId"
                    params={{ projectId: project.id, roomId: room.id }}
                    className="rounded-none no-underline"
                  >
                    <div
                      className="rough-frame surface-interactive flex items-center justify-between bg-white px-3 py-2"
                      style={{
                        ...wobbly.note,
                        background: room.id === activeRoomId ? "var(--postit)" : "white",
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-lg">{room.name}</span>
                        <span className="block truncate text-sm opacity-65">{summarizePrompt(room.topic, 40)}</span>
                      </span>
                      <MessageSquareShare size={18} />
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Card>

      <Card className="flex flex-col gap-3 p-4" tone="blueprint">
        <p className="m-0 text-2xl">Default templates</p>
        <div className="flex flex-wrap gap-2">
          {templates.map((template) => (
            <Badge key={template.id} tone={template.accentTone}>
              {template.name}
            </Badge>
          ))}
        </div>
        <p className="m-0 text-lg opacity-70">template 由首条问题绑定。后续可以新增 room，但不会在当前 room 中途替换成员阵容。</p>
      </Card>
    </aside>
  );
}
