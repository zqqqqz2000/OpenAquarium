import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectPathInspectionPayload } from "@/lib/runtime-client";
import type { WorkspaceRemoteStoreState } from "@/store/workspace-remote-store";

const { navigateMock, workspaceStoreState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  workspaceStoreState: {
    createProject: vi.fn(),
    createRoom: vi.fn(),
    inspectProjectPath: vi.fn(),
    pickProjectPath: vi.fn(),
  } satisfies Pick<WorkspaceRemoteStoreState, "createProject" | "createRoom" | "inspectProjectPath" | "pickProjectPath">,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/store/workspace-store-context", () => ({
  useWorkspaceStore: <T,>(selector: (state: Pick<WorkspaceRemoteStoreState, "createProject" | "createRoom" | "inspectProjectPath" | "pickProjectPath">) => T) =>
    selector(workspaceStoreState),
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

afterEach(() => {
  vi.clearAllMocks();
  navigateMock.mockReset();
  workspaceStoreState.createProject.mockReset();
  workspaceStoreState.createRoom.mockReset();
  workspaceStoreState.inspectProjectPath.mockReset();
  workspaceStoreState.pickProjectPath.mockReset();
  workspaceStoreState.inspectProjectPath.mockImplementation(async ({ path }: { path: string }) => ({
    path,
    projectName: "Untitled Project",
    projectInteractiveDirectory: `${path}/.openaquarium/interactive`,
    hasOpenAquariumDirectory: false,
    canImport: false,
    roomCount: 0,
    rooms: [],
  }));
  workspaceStoreState.pickProjectPath.mockResolvedValue({ path: undefined });
});

describe("project dialogs", () => {
  it("exposes an accessible description for the create project dialog", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));

    expect(screen.getByRole("dialog", { name: "Create project" })).toHaveAccessibleDescription(
      "Create a new project or reopen one from an existing OpenAquarium directory, then optionally set the default ACP working directory.",
    );
  });

  it("ignores repeated create project clicks while the first request is still pending", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const deferred = createDeferred<{ projectId: string; roomId: string }>();

    workspaceStoreState.createProject.mockReturnValue(deferred.promise);

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    const submitButton = screen.getByRole("button", { name: "Create project" });

    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(workspaceStoreState.createProject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating project…" })).toBeDisabled();

    await act(async () => {
      deferred.resolve({ projectId: "project-test", roomId: "room-test" });
      await deferred.promise;
    });
  });

  it("switches to import mode when the selected path already contains room context", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const inspection: ProjectPathInspectionPayload = {
      path: "/tmp/recovered-project",
      projectName: "Recovered Project",
      projectInteractiveDirectory: "/tmp/recovered-project/.openaquarium/interactive",
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
    };

    workspaceStoreState.inspectProjectPath.mockResolvedValue(inspection);
    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-imported",
      roomId: "room-imported",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("combobox", { name: /project source/i }));
    await user.click(screen.getByRole("option", { name: "Custom filesystem path" }));
    const pathInput = screen.getByPlaceholderText("输入项目绝对路径或相对路径");
    await user.type(pathInput, inspection.path);
    await user.click(screen.getByRole("button", { name: "Inspect path" }));

    expect(await screen.findByDisplayValue("Recovered Project")).toBeInTheDocument();
    expect(screen.queryByText("Team template")).not.toBeInTheDocument();
    expect(await screen.findByText("Reuse existing room context")).toBeInTheDocument();
    expect(screen.getByText("Alpha Room")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import project" })).toBeEnabled();

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

  it("submits a manually entered custom path without using the OS picker", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-manual-path",
      roomId: "room-manual-path",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("combobox", { name: /project source/i }));
    await user.click(screen.getByRole("option", { name: "Custom filesystem path" }));
    await user.type(screen.getByPlaceholderText("输入项目绝对路径或相对路径"), "relative/project-root");
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(workspaceStoreState.pickProjectPath).not.toHaveBeenCalled();
    expect(workspaceStoreState.inspectProjectPath).toHaveBeenCalledWith({ path: "relative/project-root" });
    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Untitled Project",
      templateId: snapshot.templateOrder[0],
      path: "relative/project-root",
    });
  });

  it("shows project path inspection errors in the dialog", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    workspaceStoreState.inspectProjectPath.mockRejectedValue(new Error("Path does not exist."));

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("combobox", { name: /project source/i }));
    await user.click(screen.getByRole("option", { name: "Custom filesystem path" }));
    await user.type(screen.getByPlaceholderText("输入项目绝对路径或相对路径"), "/tmp/missing-project");
    await user.click(screen.getByRole("button", { name: "Inspect path" }));

    expect(await screen.findByText("Path does not exist.")).toBeInTheDocument();
    expect(screen.queryByText("Reuse existing room context")).not.toBeInTheDocument();
  });

  it("creates a workspace-scoped project without inspecting or opening the OS picker", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    workspaceStoreState.createProject.mockResolvedValue({
      projectId: "project-workspace",
      roomId: "room-workspace",
    });

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.click(screen.getByRole("button", { name: "Create project" }));

    expect(workspaceStoreState.pickProjectPath).not.toHaveBeenCalled();
    expect(workspaceStoreState.inspectProjectPath).not.toHaveBeenCalled();
    expect(workspaceStoreState.createProject).toHaveBeenCalledWith({
      projectName: "Untitled Project",
      templateId: snapshot.templateOrder[0],
      path: undefined,
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
