import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import { ChevronLeft, Folder, FolderOpen, FolderPlus, Plus, RefreshCcw } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ProjectDirectoryBrowsePayload,
  ProjectPathInspectionPayload,
} from "@/lib/runtime-client";
import { badgeToneProps } from "@/lib/ui-tone";
import { useWorkspaceStore } from "@/store/workspace-store-context";

type SelectedProjectDirectory = {
  inspection?: ProjectPathInspectionPayload;
  path: string;
  usesWorkspaceRoot: boolean;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shouldAdoptInspectionProjectName(inspection: ProjectPathInspectionPayload): boolean {
  return inspection.canImport && inspection.projectName.trim().length > 0;
}

export function CreateProjectDialog(props: {
  templates: TeamTemplate[];
  triggerClassName?: string;
  triggerMode?: "default" | "icon";
  disabled?: boolean;
}) {
  const { templates, triggerClassName, triggerMode = "default", disabled = false } = props;
  const navigate = useNavigate();
  const createProject = useWorkspaceStore((state) => state.createProject);
  const browseProjectDirectory = useWorkspaceStore((state) => state.browseProjectDirectory);
  const createProjectDirectory = useWorkspaceStore((state) => state.createProjectDirectory);
  const inspectProjectPath = useWorkspaceStore((state) => state.inspectProjectPath);
  const [open, setOpen] = useState(false);
  const [projectName, setProjectName] = useState("Untitled Project");
  const [directoryBrowser, setDirectoryBrowser] = useState<ProjectDirectoryBrowsePayload | undefined>();
  const [selectedProjectDirectory, setSelectedProjectDirectory] = useState<SelectedProjectDirectory | undefined>();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [actionError, setActionError] = useState<string | undefined>();
  const [browsingDirectory, setBrowsingDirectory] = useState(false);
  const [inspectingSelection, setInspectingSelection] = useState(false);
  const [showDirectoryCreator, setShowDirectoryCreator] = useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState("");
  const [creatingDirectory, setCreatingDirectory] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const browseRequestIdRef = useRef(0);
  const inspectRequestIdRef = useRef(0);
  const creatingDirectoryRef = useRef(false);
  const creatingProjectRef = useRef(false);
  const resolvedTemplateId = templates.some((template) => template.id === templateId) ? templateId : (templates[0]?.id ?? "");
  const selectedTemplate = templates.find((template) => template.id === resolvedTemplateId);
  const selectedTemplateMemberCount = selectedTemplate?.members.length ?? 0;
  const selectedProjectInspection = selectedProjectDirectory?.inspection;
  const selectedProjectPath = selectedProjectDirectory?.path ?? "";
  const importingExistingProject = selectedProjectInspection?.canImport === true;
  const currentFolderSelected = Boolean(directoryBrowser && selectedProjectDirectory?.path === directoryBrowser.path);
  const canCreateDirectoryInCurrentFolder = directoryBrowser?.isWithinWorkspaceRoot === true;

  const syncProjectNameFromInspection = useCallback((inspection: ProjectPathInspectionPayload): void => {
    if (shouldAdoptInspectionProjectName(inspection)) {
      setProjectName(inspection.projectName.trim());
    }
  }, []);

  const syncSelectedDirectoryFromBrowser = useCallback((
    nextDirectory: ProjectDirectoryBrowsePayload,
    replaceSelection: boolean,
  ): void => {
    if (replaceSelection) {
      const nextSelection: SelectedProjectDirectory = {
        path: nextDirectory.path,
        usesWorkspaceRoot: nextDirectory.isWorkspaceRoot,
        inspection: nextDirectory.inspection,
      };
      setSelectedProjectDirectory(nextSelection);
      syncProjectNameFromInspection(nextDirectory.inspection);
      return;
    }

    setSelectedProjectDirectory((current) => {
      if (current) {
        return current;
      }

      const nextSelection: SelectedProjectDirectory = {
        path: nextDirectory.path,
        usesWorkspaceRoot: nextDirectory.isWorkspaceRoot,
        inspection: nextDirectory.inspection,
      };
      syncProjectNameFromInspection(nextDirectory.inspection);
      return nextSelection;
    });
  }, [syncProjectNameFromInspection]);

  const loadDirectory = useCallback(async (
    pathValue?: string,
    replaceSelection = false,
  ): Promise<ProjectDirectoryBrowsePayload | undefined> => {
    const requestId = browseRequestIdRef.current + 1;
    browseRequestIdRef.current = requestId;

    try {
      setActionError(undefined);
      setBrowsingDirectory(true);
      const nextDirectory = await browseProjectDirectory(pathValue ? { path: pathValue } : {});
      if (browseRequestIdRef.current !== requestId) {
        return undefined;
      }

      setDirectoryBrowser(nextDirectory);
      syncSelectedDirectoryFromBrowser(nextDirectory, replaceSelection);
      return nextDirectory;
    } catch (error) {
      if (browseRequestIdRef.current === requestId) {
        setActionError(getErrorMessage(error));
      }
      return undefined;
    } finally {
      if (browseRequestIdRef.current === requestId) {
        setBrowsingDirectory(false);
      }
    }
  }, [browseProjectDirectory, syncSelectedDirectoryFromBrowser]);

  const refreshSelectedProjectInspection = async (
    selection: SelectedProjectDirectory | undefined,
  ): Promise<ProjectPathInspectionPayload | undefined> => {
    if (!selection || selection.path.trim().length === 0) {
      setSelectedProjectDirectory(undefined);
      return undefined;
    }

    const requestId = inspectRequestIdRef.current + 1;
    inspectRequestIdRef.current = requestId;

    try {
      setActionError(undefined);
      setInspectingSelection(true);
      const inspection = await inspectProjectPath({ path: selection.path });
      if (inspectRequestIdRef.current !== requestId) {
        return undefined;
      }

      setSelectedProjectDirectory((current) => {
        if (!current || current.path !== selection.path) {
          return current;
        }

        return {
          ...current,
          inspection,
        };
      });
      syncProjectNameFromInspection(inspection);
      return inspection;
    } catch (error) {
      if (inspectRequestIdRef.current === requestId) {
        setSelectedProjectDirectory((current) => {
          if (!current || current.path !== selection.path) {
            return current;
          }

          return {
            ...current,
            inspection: undefined,
          };
        });
        setActionError(getErrorMessage(error));
      }
      return undefined;
    } finally {
      if (inspectRequestIdRef.current === requestId) {
        setInspectingSelection(false);
      }
    }
  };

  const handleSelectCurrentDirectory = (): void => {
    if (!directoryBrowser) {
      return;
    }

    setActionError(undefined);
    setSelectedProjectDirectory({
      path: directoryBrowser.path,
      usesWorkspaceRoot: directoryBrowser.isWorkspaceRoot,
      inspection: directoryBrowser.inspection,
    });
    syncProjectNameFromInspection(directoryBrowser.inspection);
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
        if (!selectedProjectDirectory || selectedProjectDirectory.path.trim().length === 0) {
          throw new Error("Select a folder in the web file manager before creating the project.");
        }

        const resolvedInspection = await refreshSelectedProjectInspection(selectedProjectDirectory);
        if (!resolvedInspection) {
          return;
        }

        const canImportExistingProject = resolvedInspection?.canImport === true;
        const requestedProjectPath = canImportExistingProject
          ? selectedProjectDirectory.path
          : selectedProjectDirectory.usesWorkspaceRoot
            ? undefined
            : selectedProjectDirectory.path;

        if (!canImportExistingProject && resolvedTemplateId.length === 0) {
          throw new Error("Team template is required when creating a new project.");
        }

        const next = await createProject({
          projectName,
          templateId: canImportExistingProject ? undefined : resolvedTemplateId,
          path: requestedProjectPath,
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
        setDirectoryBrowser(undefined);
        setSelectedProjectDirectory(undefined);
      } catch (error) {
        setActionError(getErrorMessage(error));
      } finally {
        creatingProjectRef.current = false;
        setCreatingProject(false);
      }
    })();
  };

  const handleCreateDirectory = (): void => {
    if (creatingDirectoryRef.current || disabled || !directoryBrowser) {
      return;
    }

    const normalizedDirectoryName = newDirectoryName.trim();
    if (normalizedDirectoryName.length === 0) {
      setActionError("Directory name is required.");
      return;
    }

    if (!canCreateDirectoryInCurrentFolder) {
      setActionError("New directories can only be created inside the workspace root.");
      return;
    }

    creatingDirectoryRef.current = true;
    setCreatingDirectory(true);
    void (async () => {
      try {
        setActionError(undefined);
        const nextDirectory = await createProjectDirectory({
          path: directoryBrowser.path,
          name: normalizedDirectoryName,
        });
        setDirectoryBrowser(nextDirectory);
        syncSelectedDirectoryFromBrowser(nextDirectory, true);
        setShowDirectoryCreator(false);
        setNewDirectoryName("");
      } catch (error) {
        setActionError(getErrorMessage(error));
      } finally {
        creatingDirectoryRef.current = false;
        setCreatingDirectory(false);
      }
    })();
  };

  useEffect(() => {
    if (!open) {
      setActionError(undefined);
      setDirectoryBrowser(undefined);
      setSelectedProjectDirectory(undefined);
      setShowDirectoryCreator(false);
      setNewDirectoryName("");
      setCreatingDirectory(false);
      setBrowsingDirectory(false);
      setInspectingSelection(false);
      return;
    }

    void loadDirectory(undefined, true);
  }, [loadDirectory, open]);

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
      <DialogContent className="flex max-h-[min(90vh,48rem)] w-[min(92vw,760px)] max-w-[760px] flex-col overflow-hidden sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-semibold tracking-tight">Create project</DialogTitle>
          <DialogDescription className="sr-only">
            Create a new project or reopen one from an existing OpenAquarium directory using the in-browser folder manager.
          </DialogDescription>
        </DialogHeader>
        <Card className="flex min-h-0 flex-col border border-transparent shadow-none">
          <CardContent className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Project name</span>
              <Input value={projectName} onChange={(event) => setProjectName(event.currentTarget.value)} />
            </label>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="m-0 text-sm font-medium">Folder manager</p>
                  <p className="m-0 text-xs leading-5 text-muted-foreground">
                    Web-only directory browsing. Navigate folders here, then select the current folder as the project root.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">web-only</Badge>
                  <Badge variant="outline">in-browser folder manager</Badge>
                </div>
              </div>

              <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (directoryBrowser?.parentPath) {
                          void loadDirectory(directoryBrowser.parentPath, false);
                        }
                      }}
                      disabled={disabled || browsingDirectory || creatingDirectory || creatingProject || !directoryBrowser?.parentPath}
                    >
                      <ChevronLeft size={16} />
                      Parent folder
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        void loadDirectory(undefined, false);
                      }}
                      disabled={disabled || browsingDirectory || creatingDirectory || creatingProject}
                    >
                      <FolderOpen size={16} />
                      Workspace root
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (directoryBrowser?.path) {
                          void loadDirectory(directoryBrowser.path, false);
                        }
                      }}
                      disabled={disabled || browsingDirectory || creatingDirectory || creatingProject || !directoryBrowser?.path}
                    >
                      <RefreshCcw size={16} />
                      Refresh
                    </Button>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setActionError(undefined);
                      setShowDirectoryCreator((current) => !current);
                    }}
                    disabled={disabled || browsingDirectory || creatingDirectory || creatingProject || !canCreateDirectoryInCurrentFolder}
                  >
                    <FolderPlus size={16} />
                    New directory
                  </Button>
                </div>

                {!canCreateDirectoryInCurrentFolder && directoryBrowser ? (
                  <p className="mt-3 mb-0 text-xs leading-5 text-muted-foreground">
                    New directories can only be created inside the workspace root.
                  </p>
                ) : null}

                {showDirectoryCreator ? (
                  <form
                    className="mt-3 flex flex-col gap-3 rounded-xl border border-border/60 bg-background/80 p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleCreateDirectory();
                    }}
                  >
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Directory name</span>
                      <Input
                        aria-label="Directory name"
                        value={newDirectoryName}
                        onChange={(event) => setNewDirectoryName(event.currentTarget.value)}
                        placeholder="new-project"
                        autoFocus
                        disabled={disabled || browsingDirectory || creatingDirectory || creatingProject}
                      />
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="m-0 text-xs leading-5 text-muted-foreground">
                        Creates one child folder under the current directory.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => {
                            setShowDirectoryCreator(false);
                            setNewDirectoryName("");
                          }}
                          disabled={creatingDirectory}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="submit"
                          disabled={disabled || browsingDirectory || creatingDirectory || creatingProject || newDirectoryName.trim().length === 0}
                        >
                          {creatingDirectory ? "Creating directory…" : "Create directory"}
                        </Button>
                      </div>
                    </div>
                  </form>
                ) : null}

                <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.9fr)]">
                  <div className="min-w-0 rounded-xl border border-border/60 bg-background/80 p-3">
                    <p className="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Current folder</p>
                    <p className="mt-2 mb-0 break-all font-mono text-xs leading-6">{directoryBrowser?.path ?? "Loading folder browser…"}</p>
                    <ScrollArea className="mt-3 h-52 rounded-lg border border-border/50 bg-muted/20">
                      <div className="flex flex-col gap-1 p-2">
                        {directoryBrowser?.entries.length ? (
                          directoryBrowser.entries.map((entry) => (
                            <Button
                              key={entry.path}
                              type="button"
                              variant="ghost"
                              className="h-auto justify-start gap-2 rounded-lg px-3 py-2 text-left"
                              onClick={() => {
                                void loadDirectory(entry.path, false);
                              }}
                              disabled={disabled || browsingDirectory || creatingDirectory || creatingProject}
                            >
                              <Folder size={16} className="shrink-0" />
                              <span className="min-w-0 truncate">{entry.name}</span>
                            </Button>
                          ))
                        ) : (
                          <p className="m-0 px-3 py-2 text-sm text-muted-foreground">
                            {browsingDirectory ? "Loading folders…" : "No subfolders in this directory."}
                          </p>
                        )}
                      </div>
                    </ScrollArea>
                  </div>

                  <div className="min-w-0 rounded-xl border border-border/60 bg-background/80 p-3">
                    <p className="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Selected folder</p>
                    <p className="mt-2 mb-0 break-all font-mono text-xs leading-6">{selectedProjectPath || "Select a folder to continue."}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        onClick={handleSelectCurrentDirectory}
                        disabled={disabled || browsingDirectory || creatingDirectory || creatingProject || !directoryBrowser || currentFolderSelected}
                      >
                        <Folder size={16} />
                        {currentFolderSelected ? "Current folder selected" : "Select current folder"}
                      </Button>
                      {selectedProjectDirectory?.usesWorkspaceRoot ? (
                        <Badge variant="outline">OA workspace root</Badge>
                      ) : null}
                      {currentFolderSelected ? <Badge variant="outline">current folder</Badge> : null}
                      {inspectingSelection ? <Badge variant="outline">checking…</Badge> : null}
                    </div>
                    <p className="mt-3 mb-0 text-xs leading-5 text-muted-foreground">
                      Browse with the left list, then use “Select current folder” to make the current directory the project root.
                    </p>
                  </div>
                </div>
              </div>
            </div>

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
              {importingExistingProject && selectedProjectInspection ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="m-0 text-sm font-medium">Reuse existing room context</p>
                      <p className="m-0 text-xs leading-5 text-muted-foreground">
                        已检测到 {selectedProjectInspection.roomCount} 个 room。history、room、members、todo tree 会直接从 project 内恢复。
                      </p>
                    </div>
                    <Badge variant="outline">{selectedProjectInspection.roomCount} rooms</Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{selectedProjectDirectory?.usesWorkspaceRoot ? "ACP cwd uses OA workspace" : "ACP cwd follows selected folder"}</Badge>
                    <Badge variant="outline">team restored from room state</Badge>
                  </div>
                  <div className="mt-3 max-h-72 overflow-y-auto pr-1">
                    <div className="flex flex-col gap-2">
                      {selectedProjectInspection.rooms.map((room) => (
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
                    <Badge variant="outline">{selectedProjectDirectory?.usesWorkspaceRoot ? "ACP cwd uses OA workspace" : "ACP cwd follows selected folder"}</Badge>
                    <Badge variant="outline">{selectedTemplate?.accentTone ?? "paper"}</Badge>
                  </div>
                  {selectedProjectInspection?.hasOpenAquariumDirectory ? (
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
                  || browsingDirectory
                  || creatingDirectory
                  || inspectingSelection
                  || creatingProject
                  || projectName.trim().length === 0
                  || selectedProjectPath.length === 0
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
