import { startTransition, useState } from "react";

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
import { cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function CreateRoomDialog(props: {
  project: Project;
  templates: TeamTemplate[];
  disabled?: boolean;
  triggerClassName?: string;
  triggerMode?: "button" | "icon";
}) {
  const { project, templates, disabled = false, triggerClassName, triggerMode = "button" } = props;
  const navigate = useNavigate();
  const createRoom = useWorkspaceStore((state) => state.createRoom);
  const [open, setOpen] = useState(false);
  const [firstPrompt, setFirstPrompt] = useState("继续细化当前 project 的 agent-team 协作和实现路径。");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [actionError, setActionError] = useState<string | undefined>();
  const resolvedTemplateId = templates.some((template) => template.id === templateId) ? templateId : (templates[0]?.id ?? "");
  const selectedTemplate = templates.find((template) => template.id === resolvedTemplateId);
  const triggerDisabled = disabled || templates.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerMode === "icon" ? (
          <Button
            aria-label={`Create room in ${project.name}`}
            size="icon-xs"
            type="button"
            variant="outline"
            className={cn("rounded-full border-border/60 bg-background/80 text-muted-foreground shadow-none", triggerClassName)}
            disabled={triggerDisabled}
          >
            <Plus size={14} />
          </Button>
        ) : (
          <Button size="sm" variant="secondary" className={triggerClassName} disabled={triggerDisabled}>
            <Plus size={16} />
            New room
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,760px)] max-w-[760px] gap-4 p-5 sm:max-w-[760px]">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-2xl font-semibold tracking-tight">Create room</DialogTitle>
          <DialogDescription>
            直接在 <span className="font-medium text-foreground">{project.name}</span> 下新开 room，名称会按首条问题自动生成。
          </DialogDescription>
        </DialogHeader>
        <Card className="border border-transparent shadow-none">
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project</span>
              <div className="rounded-lg bg-muted/35 px-2.5 py-1.5 text-sm">{project.name}</div>
            </div>
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
              <Select value={resolvedTemplateId} onValueChange={setTemplateId}>
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
                disabled={triggerDisabled || firstPrompt.trim().length === 0 || !resolvedTemplateId}
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(undefined);
                      const next = await createRoom({
                        projectId: project.id,
                        firstPrompt,
                        templateId: resolvedTemplateId,
                      });
                      startTransition(() => {
                        void navigate({
                          to: "/projects/$projectId/rooms/$roomId",
                          params: {
                            projectId: project.id,
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
    <div className="rounded-2xl border border-border/60 bg-muted/20 p-4">
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
          <div key={member.id} className="rounded-xl border border-border/60 bg-card px-3 py-3">
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
