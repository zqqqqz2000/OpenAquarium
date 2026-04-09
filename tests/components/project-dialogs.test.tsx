import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ProjectDirectoryBrowsePayload,
  ProjectPathInspectionPayload,
} from "@/lib/runtime-client";
import type { WorkspaceRemoteStoreState } from "@/store/workspace-remote-store";

const DEFAULT_WORKSPACE_ROOT = "/tmp/workspace-root";

const { navigateMock, workspaceStoreState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  workspaceStoreState: {
    browseProjectDirectory: vi.fn(),
    createProjectDirectory: vi.fn(),
    createProject: vi.fn(),
    createRoom: vi.fn(),
    inspectProjectPath: vi.fn(),
  } satisfies Pick<WorkspaceRemoteStoreState, "browseProjectDirectory" | "createProjectDirectory" | "createProject" | "createRoom" | "inspectProjectPath">,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/store/workspace-store-context", () => ({
  useWorkspaceStore: <T,>(
    selector: (state: Pick<WorkspaceRemoteStoreState, "browseProjectDirectory" | "createProjectDirectory" | "createProject" | "createRoom" | "inspectProjectPath">) => T,
  ) => selector(workspaceStoreState),
}));

import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { CreateRoomDialog } from "@/components/projects/create-room-dialog";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

function createDeferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) {
        throw new Error("Deferred promise resolver missing");
      }
      resolvePromise(value);
    },
  };
}

function createInspection(path: string, overrides: Partial<ProjectPathInspectionPayload> = {}): ProjectPathInspectionPayload {
  return {
    path,
    projectName: path.split("/").filter(Boolean).at(-1) ?? "Untitled Project",
    projectInteractiveDirectory: `${path}/.openaquarium/interactive`,
    hasOpenAquariumDirectory: false,
    canImport: false,
    roomCount: 0,
    rooms: [],
    ...overrides,
  };
}

function createBrowsePayload(args: {
  entries?: ProjectDirectoryBrowsePayload["entries"];
  inspection?: ProjectPathInspectionPayload;
  isWorkspaceRoot?: boolean;
  isWithinWorkspaceRoot?: boolean;
  parentPath?: string;
  path?: string;
} = {}): ProjectDirectoryBrowsePayload {
  const path = args.path ?? DEFAULT_WORKSPACE_ROOT;

  return {
    path,
    parentPath: args.parentPath,
    isWorkspaceRoot: args.isWorkspaceRoot ?? path === DEFAULT_WORKSPACE_ROOT,
    isWithinWorkspaceRoot: args.isWithinWorkspaceRoot ?? (path === DEFAULT_WORKSPACE_ROOT || path.startsWith(`${DEFAULT_WORKSPACE_ROOT}/`)),
    entries: args.entries ?? [],
    inspection: args.inspection ?? createInspection(path),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  navigateMock.mockReset();
  workspaceStoreState.browseProjectDirectory.mockReset();
  workspaceStoreState.createProjectDirectory.mockReset();
  workspaceStoreState.createProject.mockReset();
  workspaceStoreState.createRoom.mockReset();
  workspaceStoreState.inspectProjectPath.mockReset();
  workspaceStoreState.browseProjectDirectory.mockImplementation((input?: { path?: string }) => {
    const path = input?.path ?? DEFAULT_WORKSPACE_ROOT;
    return createBrowsePayload({
      path,
      parentPath: path === DEFAULT_WORKSPACE_ROOT ? "/tmp" : DEFAULT_WORKSPACE_ROOT,
      isWorkspaceRoot: path === DEFAULT_WORKSPACE_ROOT,
    });
  });
  workspaceStoreState.createProjectDirectory.mockImplementation(({ path, name }: { path: string; name: string }) => {
    const nextPath = `${path}/${name}`;
    return createBrowsePayload({
      path: nextPath,
      parentPath: path,
      isWorkspaceRoot: false,
      inspection: createInspection(nextPath),
    });
  });
  workspaceStoreState.inspectProjectPath.mockImplementation(({ path }: { path: string }) => createInspection(path));
});

describe("project dialogs", () => {
  it("exposes an accessible description for the create project dialog", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));

    expect(screen.getByRole("dialog", { name: "Create project" })).toHaveAccessibleDescription(
      "Create a new project or reopen one from an existing OpenAquarium directory using the in-browser folder manager.",
    );
  });

  it("ignores repeated create project clicks while the first request is still pending", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const deferred = createDeferred<{ projectId: string; roomId: string }>();

    workspaceStoreState.createProject.mockReturnValue(deferred.promise);

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect((await screen.findAllByText(DEFAULT_WORKSPACE_ROOT)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Create project" }));
    await user.click(screen.getByRole("button", { name: "Creating project…" }));
    await user.click(screen.getByRole("button", { name: "Creating project…" }));

    await waitFor(() => expect(workspaceStoreState.createProject).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Creating project…" })).toBeDisabled();

    await act(async () => {
      deferred.resolve({ projectId: "project-test", roomId: "room-test" });
      await deferred.promise;
    });
  });

  it("switches to import mode when the selected folder already contains room context", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const inspection: ProjectPathInspectionPayload = createInspection("/tmp/recovered-project", {
      projectName: "Recovered Project",
      hasOpenAquariumDirectory: true,
      canImport: true,
      roomCount: 2,
      rooms: [
        {
          roomId: "room-alpha",
          roomName: "Alpha Room",
          teamName: "Product Pod",
          memberCount: 4,
          updatedAt: "2026-03-20T00:00:00.000Z",
        },
        {
          roomId: "room-beta",
          roomName: "Beta Room",
          teamName: "Incident Pod",
          memberCount: 3,
          updatedAt: "2026-03-19T00:00:00.000Z",
        },
      ],
    });

    workspaceStoreState.browseProjectDirectory.mockResolvedValue(
      createBrowsePayload({
        path: inspection.path,
        inspection,
        isWorkspaceRoot: false,
        parentPath: "/tmp",
      }),
    );
    workspaceStoreState.inspectProjectPath.mockResolvedValue(inspection);
    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-imported",
      roomId: "room-imported",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));

    expect(await screen.findByDisplayValue("Recovered Project")).toBeInTheDocument();
    expect(screen.queryByText("Team template")).not.toBeInTheDocument();
    expect(await screen.findByText("Reuse existing room context")).toBeInTheDocument();
    expect(screen.getByText("Alpha Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import project" })).toBeEnabled();
    expect(screen.getByRole("dialog", { name: "Create project" }).className).toContain("max-h-[min(90vh,48rem)]");
    expect(screen.getByText("Alpha Room").closest("div.overflow-y-auto")?.className).toContain("max-h-72");

    await user.click(screen.getByRole("button", { name: "Import project" }));

    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Recovered Project",
      templateId: undefined,
      path: "/tmp/recovered-project",
    });
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/projects/$projectId/rooms/$roomId",
      params: {
        projectId: "project-imported",
        roomId: "room-imported",
      },
    });
  });

  it("browses into a child folder and selects it as the project root", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const childPath = `${DEFAULT_WORKSPACE_ROOT}/external-project`;

    workspaceStoreState.browseProjectDirectory.mockImplementation((input?: { path?: string }) => {
      if (input?.path === childPath) {
        return createBrowsePayload({
          path: childPath,
          parentPath: DEFAULT_WORKSPACE_ROOT,
          isWorkspaceRoot: false,
          inspection: createInspection(childPath),
        });
      }

      return createBrowsePayload({
        path: DEFAULT_WORKSPACE_ROOT,
        parentPath: "/tmp",
        isWorkspaceRoot: true,
        entries: [{ name: "external-project", path: childPath }],
        inspection: createInspection(DEFAULT_WORKSPACE_ROOT),
      });
    });
    workspaceStoreState.inspectProjectPath.mockImplementation(({ path }: { path: string }) => createInspection(path));
    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-manual-path",
      roomId: "room-manual-path",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(await screen.findByRole("button", { name: "external-project" }));
    expect(await screen.findByText(childPath)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select current folder" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(workspaceStoreState.inspectProjectPath).toHaveBeenCalledWith({ path: childPath });
    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Untitled Project",
      templateId: snapshot.templateOrder[0],
      path: childPath,
    });
  });

  it("creates a new child folder from the right-side action and uses it as the selected project root", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const createdPath = `${DEFAULT_WORKSPACE_ROOT}/new-project`;

    workspaceStoreState.createProjectDirectory.mockResolvedValue(
      createBrowsePayload({
        path: createdPath,
        parentPath: DEFAULT_WORKSPACE_ROOT,
        isWorkspaceRoot: false,
        inspection: createInspection(createdPath),
      }),
    );
    workspaceStoreState.inspectProjectPath.mockResolvedValue(createInspection(createdPath));
    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-new-folder",
      roomId: "room-new-folder",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("button", { name: "New directory" }));
    await user.type(screen.getByRole("textbox", { name: "Directory name" }), "new-project");
    await user.click(screen.getByRole("button", { name: "Create directory" }));

    expect(workspaceStoreState.createProjectDirectory).toHaveBeenCalledWith({
      path: DEFAULT_WORKSPACE_ROOT,
      name: "new-project",
    });
    expect((await screen.findAllByText(createdPath)).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Current folder selected" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(workspaceStoreState.inspectProjectPath).toHaveBeenCalledWith({ path: createdPath });
    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Untitled Project",
      templateId: snapshot.templateOrder[0],
      path: createdPath,
    });
  });

  it("disables directory creation after leaving the workspace root", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    workspaceStoreState.browseProjectDirectory.mockImplementation((input?: { path?: string }) => {
      if (input?.path === "/tmp") {
        return createBrowsePayload({
          path: "/tmp",
          parentPath: "/",
          isWorkspaceRoot: false,
          isWithinWorkspaceRoot: false,
          entries: [{ name: "workspace-root", path: DEFAULT_WORKSPACE_ROOT }],
          inspection: createInspection("/tmp"),
        });
      }

      return createBrowsePayload({
        path: DEFAULT_WORKSPACE_ROOT,
        parentPath: "/tmp",
        isWorkspaceRoot: true,
        isWithinWorkspaceRoot: true,
        inspection: createInspection(DEFAULT_WORKSPACE_ROOT),
      });
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("button", { name: "Parent folder" }));

    expect(await screen.findByText("New directories can only be created inside the workspace root.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New directory" })).toBeDisabled();
  });

  it("shows project inspection errors for the selected folder", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const brokenPath = `${DEFAULT_WORKSPACE_ROOT}/missing-project`;

    workspaceStoreState.browseProjectDirectory.mockImplementation((input?: { path?: string }) => {
      if (input?.path === brokenPath) {
        return createBrowsePayload({
          path: brokenPath,
          parentPath: DEFAULT_WORKSPACE_ROOT,
          isWorkspaceRoot: false,
          inspection: createInspection(brokenPath),
        });
      }

      return createBrowsePayload({
        path: DEFAULT_WORKSPACE_ROOT,
        parentPath: "/tmp",
        isWorkspaceRoot: true,
        entries: [{ name: "missing-project", path: brokenPath }],
        inspection: createInspection(DEFAULT_WORKSPACE_ROOT),
      });
    });
    workspaceStoreState.inspectProjectPath.mockRejectedValue(new Error("Path does not exist."));

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(await screen.findByRole("button", { name: "missing-project" }));
    await user.click(screen.getByRole("button", { name: "Select current folder" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Path does not exist.")).toBeInTheDocument();
    expect(workspaceStoreState.createProject).not.toHaveBeenCalled();
    expect(screen.queryByText("Reuse existing room context")).not.toBeInTheDocument();
  });

  it("keeps the dialog in an error state when the selected folder disappears before create", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const disappearingPath = `${DEFAULT_WORKSPACE_ROOT}/disappearing-project`;

    workspaceStoreState.browseProjectDirectory.mockImplementation((input?: { path?: string }) => {
      if (input?.path === disappearingPath) {
        return createBrowsePayload({
          path: disappearingPath,
          parentPath: DEFAULT_WORKSPACE_ROOT,
          isWorkspaceRoot: false,
          inspection: createInspection(disappearingPath),
        });
      }

      return createBrowsePayload({
        path: DEFAULT_WORKSPACE_ROOT,
        parentPath: "/tmp",
        isWorkspaceRoot: true,
        entries: [{ name: "disappearing-project", path: disappearingPath }],
        inspection: createInspection(DEFAULT_WORKSPACE_ROOT),
      });
    });
    workspaceStoreState.inspectProjectPath.mockRejectedValue(new Error("Project directory does not exist."));

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(await screen.findByRole("button", { name: "disappearing-project" }));
    await user.click(screen.getByRole("button", { name: "Select current folder" }));
    expect((await screen.findAllByText(disappearingPath)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByText("Project directory does not exist.")).toBeInTheDocument();
    expect(workspaceStoreState.inspectProjectPath).toHaveBeenCalledWith({ path: disappearingPath });
    expect(workspaceStoreState.createProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Create project" })).toBeInTheDocument();
  });

  it("creates a workspace-root project through the web folder manager", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-workspace",
      roomId: "room-workspace",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect((await screen.findAllByText(DEFAULT_WORKSPACE_ROOT)).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(workspaceStoreState.browseProjectDirectory).toHaveBeenCalledWith({});
    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Untitled Project",
      templateId: snapshot.templateOrder[0],
      path: undefined,
    });
  });

  it("preserves the workspace-root path when importing an existing project", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const inspection = createInspection(DEFAULT_WORKSPACE_ROOT, {
      canImport: true,
      hasOpenAquariumDirectory: true,
      projectName: "Workspace Root Project",
      roomCount: 1,
      rooms: [{
        roomId: "room-alpha",
        roomName: "Alpha Room",
        teamName: "Alpha Team",
        memberCount: 4,
        updatedAt: "2026-01-02T03:04:05.000Z",
      }],
    });

    workspaceStoreState.browseProjectDirectory.mockResolvedValue(
      createBrowsePayload({
        path: DEFAULT_WORKSPACE_ROOT,
        parentPath: "/tmp",
        isWorkspaceRoot: true,
        inspection,
      }),
    );
    workspaceStoreState.inspectProjectPath.mockResolvedValue(inspection);
    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-imported-root",
      roomId: "room-imported-root",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    expect(await screen.findByDisplayValue("Workspace Root Project")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import project" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Import project" }));

    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Workspace Root Project",
      templateId: undefined,
      path: DEFAULT_WORKSPACE_ROOT,
    });
  });

  it("falls back to a newly loaded default template after rerender", async () => {
    const user = userEvent.setup();
    const emptySnapshot = createSeedWorkspace();
    emptySnapshot.templateOrder = [];
    emptySnapshot.templates = {};

    const nextSnapshot = createSeedWorkspace();
    const persistedTemplateId = nextSnapshot.templateOrder[0];
    if (!persistedTemplateId) {
      throw new Error("Expected persisted template id");
    }
    nextSnapshot.templates[persistedTemplateId] = {
      ...nextSnapshot.templates[persistedTemplateId],
      name: "Persisted Product Pod",
    };

    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-persisted",
      roomId: "room-persisted",
    });

    const { rerender } = render(
      <CreateProjectDialog templates={emptySnapshot.templateOrder.map((templateId) => emptySnapshot.templates[templateId])} />,
    );

    rerender(
      <CreateProjectDialog templates={nextSnapshot.templateOrder.map((templateId) => nextSnapshot.templates[templateId])} />,
    );

    await user.click(screen.getByRole("button", { name: "New project" }));

    expect(screen.getByRole("combobox", { name: /team template/i })).toHaveTextContent("Persisted Product Pod");

    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Untitled Project",
      templateId: persistedTemplateId,
      path: undefined,
    });
  });

  it("keeps a newly loaded default template selectable for create room after rerender", async () => {
    const user = userEvent.setup();
    const emptySnapshot = createSeedWorkspace();
    emptySnapshot.templateOrder = [];
    emptySnapshot.templates = {};

    const nextSnapshot = createSeedWorkspace();
    const projectId = nextSnapshot.projectOrder[0];
    if (!projectId) {
      throw new Error("Expected seeded project id");
    }
    const project = nextSnapshot.projects[projectId];
    if (!project) {
      throw new Error("Expected seeded project");
    }
    const persistedTemplateId = nextSnapshot.templateOrder[0];
    if (!persistedTemplateId) {
      throw new Error("Expected persisted template id");
    }
    nextSnapshot.templates[persistedTemplateId] = {
      ...nextSnapshot.templates[persistedTemplateId],
      name: "Persisted Product Pod",
    };

    workspaceStoreState.createRoom.mockResolvedValue({
      roomId: "room-persisted",
    });

    const { rerender } = render(
      <CreateRoomDialog
        project={project}
        templates={emptySnapshot.templateOrder.map((templateId) => emptySnapshot.templates[templateId])}
      />,
    );

    rerender(
      <CreateRoomDialog
        project={project}
        templates={nextSnapshot.templateOrder.map((templateId) => nextSnapshot.templates[templateId])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New room" }));

    expect(screen.getByRole("combobox", { name: /team template/i })).toHaveTextContent("Persisted Product Pod");

    await user.click(screen.getByRole("button", { name: "Create room" }));

    expect(workspaceStoreState.createRoom).toHaveBeenCalledWith({
      projectId,
      templateId: persistedTemplateId,
    });
  });

  it("exposes an accessible description for the create room dialog", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    if (!projectId) {
      throw new Error("Expected seeded project id");
    }
    const project = snapshot.projects[projectId];
    if (!project) {
      throw new Error("Expected seeded project");
    }

    render(
      <CreateRoomDialog
        project={project}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New room" }));

    expect(screen.getByRole("dialog", { name: "Create room" })).toHaveAccessibleDescription(
      "Create a new room in the selected project and initialize it from one of the available team templates.",
    );
  });

  it("ignores repeated create room clicks while the first request is still pending", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const projectId = snapshot.projectOrder[0];
    if (!projectId) {
      throw new Error("Expected seeded project id");
    }
    const project = snapshot.projects[projectId];
    if (!project) {
      throw new Error("Expected seeded project");
    }
    const deferred = createDeferred<{ roomId: string }>();

    workspaceStoreState.createRoom.mockReturnValue(deferred.promise);

    render(
      <CreateRoomDialog
        project={project}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New room" }));
    const submitButton = screen.getByRole("button", { name: "Create room" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(workspaceStoreState.createRoom).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating room…" })).toBeDisabled();

    await act(async () => {
      deferred.resolve({ roomId: "room-test" });
      await deferred.promise;
    });
  });
});
