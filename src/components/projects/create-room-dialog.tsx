import { startTransition, useMemo, useState } from "react";

import { Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import type { Project, TeamTemplate } from "@/domain/model";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function CreateRoomDialog(props: {
  activeProjectId?: string;
  projects: Project[];
  templates: TeamTemplate[];
}) {
  const { activeProjectId, projects, templates } = props;
  const navigate = useNavigate();
  const createRoom = useWorkspaceStore((state) => state.createRoom);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [firstPrompt, setFirstPrompt] = useState("继续细化当前 project 的 agent-team 协作和实现路径。");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const projectOptions = useMemo(() => projects, [projects]);
  const disabled = projectOptions.length === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen && !projectId) {
          setProjectId(activeProjectId ?? projects[0]?.id ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" disabled={disabled}>
          <Plus size={16} />
          New room
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,720px)] max-w-[720px] sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">Create room</DialogTitle>
          <DialogDescription>在现有 project 下新开一个 room，名称会按首条问题自动生成。</DialogDescription>
        </DialogHeader>
        <Card className="border border-transparent shadow-none">
          <CardContent className="flex flex-col gap-4 p-0">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project</span>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">First user prompt</span>
              <Textarea
                className="min-h-28"
                value={firstPrompt}
                onChange={(event) => setFirstPrompt(event.currentTarget.value)}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Team template</span>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a team template" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project note</span>
              <Input
                disabled
                value={projectOptions.find((project) => project.id === projectId)?.name ?? ""}
                placeholder="Select a project first"
              />
            </label>
            <div className="flex justify-end">
              <Button
                disabled={!projectId || firstPrompt.trim().length === 0 || !templateId}
                onClick={() => {
                  void (async () => {
                    try {
                      const next = await createRoom({
                        projectId,
                        firstPrompt,
                        templateId,
                      });
                      startTransition(() => {
                        void navigate({
                          to: "/projects/$projectId/rooms/$roomId",
                          params: {
                            projectId,
                            roomId: next.roomId,
                          },
                        });
                      });
                      setOpen(false);
                    } catch {
                      // Sidebar error state will explain why room creation failed.
                    }
                  })();
                }}
              >
                Create room
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
