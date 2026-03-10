import { startTransition, useState } from "react";

import { Plus } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import type { TeamTemplate } from "@/domain/model";
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
import { Input } from "@/components/ui/input";
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

export function CreateProjectDialog(props: { templates: TeamTemplate[]; triggerClassName?: string; disabled?: boolean }) {
  const { templates, triggerClassName, disabled = false } = props;
  const navigate = useNavigate();
  const createProject = useWorkspaceStore((state) => state.createProject);
  const generateTemplate = useWorkspaceStore((state) => state.generateTemplate);
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [firstPrompt, setFirstPrompt] = useState("先定义一个支持 ACP 和多 member 配置的 agent-team 产品。");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [isGenerating, setIsGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const selectedTemplate = templates.find((template) => template.id === templateId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={triggerClassName} disabled={disabled}>
          <Plus size={18} />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,720px)] max-w-[720px] sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">Create project</DialogTitle>
          <DialogDescription>room 名会按首条问题自动生成，template 第一次固定。</DialogDescription>
        </DialogHeader>
        <Card className="border border-transparent shadow-none">
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project name</span>
              <Input value={projectName} onChange={(event) => setProjectName(event.currentTarget.value)} />
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
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || isGenerating}
                onClick={() => {
                  void (async () => {
                    setIsGenerating(true);
                    setActionError(undefined);
                    try {
                      const template = await generateTemplate(firstPrompt);
                      setTemplateId(template.id);
                    } catch (error) {
                      setActionError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setIsGenerating(false);
                    }
                  })();
                }}
              >
                {isGenerating ? "Generating…" : "Generate template"}
              </Button>
            </div>
            {actionError ? <p className="m-0 text-sm text-destructive">{actionError}</p> : null}
            <p className="m-0 text-sm text-muted-foreground">
              生成会调用真实 ACP agent，并参考内置 templates、CLI 命令范式和成员配置约束。
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedTemplate?.members.map((member) => {
                const toneBadge = badgeToneProps(member.accentTone);

                return (
                  <Badge key={member.id} variant={toneBadge.variant} className={toneBadge.className}>
                    @{member.handle}
                  </Badge>
                );
              })}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  void (async () => {
                    try {
                      setActionError(undefined);
                      const next = await createProject({
                        projectName,
                        firstPrompt,
                        templateId,
                      });
                      startTransition(() => {
                        void navigate({
                          to: "/projects/$projectId/rooms/$roomId",
                          params: {
                            projectId: next.projectId,
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
                disabled={disabled || projectName.trim().length === 0 || firstPrompt.trim().length === 0 || templateId.length === 0}
              >
                Create project
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
