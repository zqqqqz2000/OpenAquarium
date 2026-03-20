import { startTransition, useRef, useState } from "react";

import { FolderSearch, Plus } from "lucide-react";
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
import type { ProjectPathInspectionPayload } from "@/lib/runtime-client";
import { badgeToneProps } from "@/lib/ui-tone";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function CreateProjectDialog(props: {
  templates: TeamTemplate[];
  triggerClassName?: string;
  triggerMode?: "default" | "icon";
  disabled?: boolean;
}) {
  const { templates, triggerClassName, triggerMode = "default", disabled = false } = props;
  const navigate = useNavigate();
  const createProject = useWorkspaceStore((state) => state.createProject);
  const pickProjectPath = useWorkspaceStore((state) => state.pickProjectPath);
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectPath, setProjectPath] = useState("");
  const [projectPathInspection, setProjectPathInspection] = useState<ProjectPathInspectionPayload | undefined>();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [actionError, setActionError] = useState<string | undefined>();
  const [pickingPath, setPickingPath] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const creatingProjectRef = useRef(false);
  const selectedTemplate = templates.find((template) => template.id === templateId);
  const selectedTemplateMemberCount = selectedTemplate?.members.length ?? 0;
  const importingExistingProject = projectPathInspection?.canImport === true;
  const handlePickProjectPath = (): void => {
    void (async () => {
      try {
        setActionError(undefined);
        setPickingPath(true);
        const selection = await pickProjectPath();
        if (typeof selection.path === "string" && selection.path.trim().length > 0) {
          setProjectPath(selection.path);
          setProjectPathInspection(selection.inspection);
          if (selection.inspection?.projectName.trim()) {
            setProjectName(selection.inspection.projectName.trim());
          }
        }
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setPickingPath(false);
      }
    })();
  };

  const handleCreateProject = (): void => {
    if (
      creatingProjectRef.current
      || disabled
      || projectName.trim().length === 0
      || (!importingExistingProject && templateId.length === 0)
    ) {
      return;
    }

    creatingProjectRef.current = true;
    setCreatingProject(true);
    void (async () => {
      try {
        setActionError(undefined);
        const next = await createProject({
          projectName,
          templateId: importingExistingProject ? undefined : templateId,
          path: projectPath,
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
        setProjectPath("");
        setProjectPathInspection(undefined);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        creatingProjectRef.current = false;
        setCreatingProject(false);
      }
    })();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setActionError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        {triggerMode === "icon" ? (
          <Button type="button" className={triggerClassName} disabled={disabled} variant="ghost" size="icon-sm" aria-label="Create project">
            <Plus size={18} />
          </Button>
        ) : (
          <Button type="button" className={triggerClassName} disabled={disabled}>
            <Plus size={18} />
            New project
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="w-[min(92vw,720px)] max-w-[720px] sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">Create project</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new project or reopen one from an existing OpenAquarium directory, then optionally set the default ACP working directory.
          </DialogDescription>
        </DialogHeader>
        <Card className="border border-transparent shadow-none">
          <CardContent className="flex flex-col gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project name</span>
              <Input value={projectName} onChange={(event) => setProjectName(event.currentTarget.value)} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project path</span>
              <div className="flex flex-wrap items-center gap-2">
                <Input readOnly value={projectPath} placeholder="未选择目录" className="flex-1" />
                <Button type="button" variant="outline" onClick={handlePickProjectPath} disabled={disabled || pickingPath || creatingProject}>
                  <FolderSearch size={16} />
                  {pickingPath ? "选择中…" : "选择文件夹"}
                </Button>
                {projectPath.trim().length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setProjectPath("");
                      setProjectPathInspection(undefined);
                    }}
                    disabled={disabled || pickingPath || creatingProject}
                  >
                    清空
                  </Button>
                ) : null}
              </div>
              <span className="text-xs leading-5 text-muted-foreground">
                可选。点击选择目录后，ACP session 默认会从这个路径启动。
              </span>
            </label>
            {!importingExistingProject ? (
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
            ) : null}
            {actionError ? <p className="m-0 text-sm text-destructive">{actionError}</p> : null}
            <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
              {importingExistingProject ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="m-0 text-sm font-medium">Reuse existing room context</p>
                      <p className="m-0 text-xs leading-5 text-muted-foreground">
                        已检测到 {projectPathInspection.roomCount} 个 room。history、room、members、todo tree 会直接从 project 内恢复。
                      </p>
                    </div>
                    <Badge variant="outline">{projectPathInspection.roomCount} rooms</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{projectPath.trim().length > 0 ? "ACP cwd follows project path" : "ACP cwd uses OA workspace"}</Badge>
                    <Badge variant="outline">team restored from room state</Badge>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {projectPathInspection.rooms.map((room) => (
                      <div key={room.roomId} className="rounded-xl border border-border/60 bg-background/70 px-3 py-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-medium">{room.roomName}</p>
                            <p className="m-0 text-xs leading-5 text-muted-foreground">{room.teamName}</p>
                          </div>
                          <Badge variant="outline">{room.memberCount} members</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="m-0 text-sm font-medium">{selectedTemplate?.name ?? "No template selected"}</p>
                      <p className="m-0 text-xs leading-5 text-muted-foreground">
                        {selectedTemplate?.description ?? "选择一个 team template 作为初始协作结构。"}
                      </p>
                    </div>
                    <Badge variant="outline">{selectedTemplateMemberCount} members</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{projectPath.trim().length > 0 ? "ACP cwd follows project path" : "ACP cwd uses OA workspace"}</Badge>
                    <Badge variant="outline">{selectedTemplate?.accentTone ?? "paper"}</Badge>
                  </div>
                  {projectPathInspection?.hasOpenAquariumDirectory ? (
                    <p className="mt-3 mb-0 text-xs leading-5 text-muted-foreground">
                      检测到现有 `.openaquarium`，但没有可复用的 room state，仍需选择 team template。
                    </p>
                  ) : null}
                </>
              )}
            </div>
            {!importingExistingProject ? (
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
            ) : null}
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={handleCreateProject}
                disabled={
                  disabled
                  || creatingProject
                  || projectName.trim().length === 0
                  || (!importingExistingProject && templateId.length === 0)
                }
              >
                {creatingProject
                  ? importingExistingProject ? "Importing project…" : "Creating project…"
                  : importingExistingProject ? "Import project" : "Create project"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
