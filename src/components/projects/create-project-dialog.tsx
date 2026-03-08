import * as Dialog from "@radix-ui/react-dialog";
import { startTransition, useState } from "react";

import { Plus, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import type { TeamTemplate } from "@/domain/model";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { wobbly } from "@/lib/utils";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function CreateProjectDialog(props: { templates: TeamTemplate[] }) {
  const { templates } = props;
  const navigate = useNavigate();
  const createProject = useWorkspaceStore((state) => state.createProject);
  const generateTemplate = useWorkspaceStore((state) => state.generateTemplate);
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [firstPrompt, setFirstPrompt] = useState("先定义一个支持 ACP 和多 member 配置的 agent-team 产品。");
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [isGenerating, setIsGenerating] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button>
          <Plus size={18} />
          New project
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/25 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,720px)] -translate-x-1/2 -translate-y-1/2">
          <Card className="flex flex-col gap-4 p-5 md:p-6" tone="postit" tack>
            <div className="flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="m-0 text-4xl">Start A New Room</Dialog.Title>
                <Dialog.Description className="m-0 text-xl opacity-75">room 名会按首条问题自动生成，template 第一次固定。</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="rounded-none" type="button">
                  <X size={22} />
                </button>
              </Dialog.Close>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-xl">Project name</span>
              <Input value={projectName} onChange={(event) => setProjectName(event.currentTarget.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xl">First user prompt</span>
              <Textarea value={firstPrompt} onChange={(event) => setFirstPrompt(event.currentTarget.value)} minRows={5} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xl">Team template</span>
              <select
                className="rough-input h-12 px-4 text-lg"
                style={wobbly.pill}
                value={templateId}
                onChange={(event) => setTemplateId(event.currentTarget.value)}
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                disabled={isGenerating}
                onClick={() => {
                  void (async () => {
                  setIsGenerating(true);
                  const template = await generateTemplate(firstPrompt);
                  setTemplateId(template.id);
                  setIsGenerating(false);
                  })();
                }}
              >
                {isGenerating ? "Generating…" : "Generate template"}
              </Button>
            </div>
            <p className="m-0 text-lg opacity-70">生成会调用 ACP agent，并参考内置 templates、CLI 命令范式和成员配置约束。</p>
            <div className="flex flex-wrap gap-2">
              {templates
                .find((template) => template.id === templateId)
                ?.members.map((member) => (
                  <Badge key={member.id} tone={member.accentTone}>
                    @{member.handle}
                  </Badge>
                ))}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  void (async () => {
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
                  })();
                }}
              >
                Create room
              </Button>
            </div>
          </Card>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
