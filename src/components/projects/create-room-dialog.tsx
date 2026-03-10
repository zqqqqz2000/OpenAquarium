import { startTransition, useMemo, useState } from "react";

import { Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import type { Project, TeamTemplate } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { badgeToneProps } from "@/lib/ui-tone";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function CreateRoomDialog(props: {
  activeProjectId?: string;
  projects: Project[];
  templates: TeamTemplate[];
  disabled?: boolean;
}) {
  const { activeProjectId, projects, templates, disabled = false } = props;
  const navigate = useNavigate();
  const createRoom = useWorkspaceStore((state) => state.createRoom);
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [firstPrompt, setFirstPrompt] = useState("继续细化当前 project 的 agent-team 协作和实现路径。");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [actionError, setActionError] = useState<string | undefined>();
  const projectOptions = useMemo(() => projects, [projects]);
  const selectedTemplate = useMemo(() => templates.find((template) => template.id === templateId), [templateId, templates]);
  const triggerDisabled = disabled || projectOptions.length === 0;

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
        <Button size="sm" variant="secondary" disabled={triggerDisabled}>
          <Plus size={16} />
          New room
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,760px)] max-w-[760px] gap-5 p-6 sm:max-w-[760px]">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-2xl font-semibold tracking-tight">Create room</DialogTitle>
          <DialogDescription>在现有 project 下新开一个 room，名称会按首条问题自动生成。</DialogDescription>
        </DialogHeader>
        <Card className="border border-border shadow-sm">
          <CardContent className="flex flex-col gap-5 p-5">
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
                className="min-h-32"
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
            {selectedTemplate ? <TemplateDetails template={selectedTemplate} /> : null}
            {actionError ? <p className="m-0 text-sm text-destructive">{actionError}</p> : null}
            <div className="flex justify-end">
              <Button
                disabled={triggerDisabled || !projectId || firstPrompt.trim().length === 0 || !templateId}
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(undefined);
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
                    } catch (error) {
                      setActionError(error instanceof Error ? error.message : String(error));
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

function TemplateDetails(props: { template: TeamTemplate }) {
  const { template } = props;
  const accentBadge = badgeToneProps(template.accentTone);

  return (
    <div className="rounded-2xl border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 text-base font-semibold tracking-tight">{template.name}</p>
            <Badge variant={accentBadge.variant} className={accentBadge.className}>
              {template.members.length} members
            </Badge>
          </div>
          <p className="m-0 text-sm leading-6 text-muted-foreground">{template.description}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {template.members.map((member) => (
          <div key={member.id} className="rounded-xl border border-border bg-card px-3 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-semibold">{member.name}</p>
              <Badge variant="outline">@{member.handle}</Badge>
            </div>
            <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{member.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
