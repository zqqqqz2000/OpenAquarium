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

type ProjectSource = "workspace" | "path";

export function CreateProjectDialog(props: {
  templates: TeamTemplate[];
  triggerClassName?: string;
  triggerMode?: "default" | "icon";
  disabled?: boolean;
}) {
  const { templates, triggerClassName, triggerMode = "default", disabled = false } = props;
  const navigate = useNavigate();
  const createProject = useWorkspaceStore((state) => state.createProject);
  const inspectProjectPath = useWorkspaceStore((state) => state.inspectProjectPath);
  const pickProjectPath = useWorkspaceStore((state) => state.pickProjectPath);
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [projectSource, setProjectSource] = useState<ProjectSource>("workspace");
  const [projectPath, setProjectPath] = useState("");
  const [projectPathInspection, setProjectPathInspection] = useState<ProjectPathInspectionPayload | undefined>();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [actionError, setActionError] = useState<string | undefined>();
  const [inspectingPath, setInspectingPath] = useState(false);
  const [pickingPath, setPickingPath] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const creatingProjectRef = useRef(false);
  const resolvedTemplateId = templates.some((template) => template.id === templateId) ? templateId : (templates[0]?.id ?? "");
  const selectedTemplate = templates.find((template) => template.id === resolvedTemplateId);
  const selectedTemplateMemberCount = selectedTemplate?.members.length ?? 0;
  const effectiveProjectPath = projectSource === "path" ? projectPath.trim() : "";
  const canInspectProjectPath = projectSource === "path" && effectiveProjectPath.length > 0;
  const importingExistingProject = effectiveProjectPath.length > 0 && projectPathInspection?.canImport === true;

  const handleInspectProjectPath = async (pathValue: string): Promise<ProjectPathInspectionPayload | undefined> => {
    const trimmedPath = pathValue.trim();
    if (trimmedPath.length === 0) {
      setProjectPathInspection(undefined);
      return undefined;
    }

    try {
      setActionError(undefined);
      setInspectingPath(true);
      const inspection = await inspectProjectPath({ path: trimmedPath });
      setProjectPathInspection(inspection);
      if (inspection.projectName.trim()) {
        setProjectName(inspection.projectName.trim());
      }
      return inspection;
    } catch (error) {
      setProjectPathInspection(undefined);
      setActionError(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setInspectingPath(false);
    }
  };

  const handlePickProjectPath = (): void => {
    void (async () => {
      try {
        setActionError(undefined);
        setPickingPath(true);
        setProjectSource("path");
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
    if (creatingProjectRef.current || disabled || projectName.trim().length === 0) {
      return;
    }

    creatingProjectRef.current = true;
    setCreatingProject(true);
    void (async () => {
      try {
        setActionError(undefined);
        const resolvedInspection = effectiveProjectPath.length > 0
          ? await handleInspectProjectPath(effectiveProjectPath)
          : undefined;
        const canImportExistingProject = resolvedInspection?.canImport === true;

        if (projectSource === "path" && effectiveProjectPath.length === 0) {
          throw new Error("Project path is required when using a custom path source.");
        }
        if (!canImportExistingProject && resolvedTemplateId.length === 0) {
          throw new Error("Team template is required when creating a new project.");
        }

        const next = await createProject({
          projectName,
          templateId: canImportExistingProject ? undefined : resolvedTemplateId,
          path: effectiveProjectPath || undefined,
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
        setProjectSource("workspace");
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
              <span className="text-sm font-medium">Project source</span>
              <Select value={projectSource} onValueChange={(value) => setProjectSource(value as ProjectSource)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a source" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="workspace">OpenAquarium workspace</SelectItem>
                  <SelectItem value="path">Custom filesystem path</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-xs leading-5 text-muted-foreground">
                默认直接在当前 OpenAquarium 工作区创建；切到自定义路径时可在网页内输入或浏览目录。
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project path</span>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={projectPath}
                  onChange={(event) => {
                    setProjectPath(event.currentTarget.value);
                    setProjectPathInspection(undefined);
                    setActionError(undefined);
                  }}
                  onBlur={() => {
                    if (projectSource !== "path") {
                      return;
                    }
                    void handleInspectProjectPath(projectPath);
                  }}
                  placeholder={projectSource === "path" ? "输入项目绝对路径或相对路径" : "使用当前 OpenAquarium workspace"}
                  className="flex-1"
                  disabled={disabled || creatingProject || projectSource !== "path"}
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label="Inspect path"
                  onClick={() => {
                    void handleInspectProjectPath(projectPath);
                  }}
                  disabled={disabled || !canInspectProjectPath || pickingPath || inspectingPath || creatingProject}
                >
                  {inspectingPath ? "Inspecting…" : "Inspect path"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePickProjectPath}
                  disabled={disabled || pickingPath || inspectingPath || creatingProject || projectSource !== "path"}
                >
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
                {projectSource === "path"
                  ? inspectingPath
                    ? "正在检查这个路径是否已有 OpenAquarium room context…"
                    : "输入路径后会在提交前自动检查；如路径内已有 room context，将切到导入流程。"
                  : "保持为空时，ACP session 默认从当前 OpenAquarium workspace 启动。"}
              </span>
            </label>
            {!importingExistingProject ? (
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
                    <Badge variant="outline">{effectiveProjectPath.length > 0 ? "ACP cwd follows project path" : "ACP cwd uses OA workspace"}</Badge>
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
                    <Badge variant="outline">{effectiveProjectPath.length > 0 ? "ACP cwd follows project path" : "ACP cwd uses OA workspace"}</Badge>
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
                  || (projectSource === "path" && effectiveProjectPath.length === 0)
                  || (!importingExistingProject && resolvedTemplateId.length === 0)
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
