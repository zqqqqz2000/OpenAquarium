import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceRemoteStoreState } from "@/store/workspace-remote-store";

const { navigateMock, workspaceStoreState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  workspaceStoreState: {
    createProject: vi.fn(),
    createRoom: vi.fn(),
    pickProjectPath: vi.fn(),
  } satisfies Pick<WorkspaceRemoteStoreState, "createProject" | "createRoom" | "pickProjectPath">,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/store/workspace-store-context", () => ({
  useWorkspaceStore: <T,>(selector: (state: Pick<WorkspaceRemoteStoreState, "createProject" | "createRoom" | "pickProjectPath">) => T) =>
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
  workspaceStoreState.pickProjectPath.mockReset();
  workspaceStoreState.pickProjectPath.mockResolvedValue(undefined);
});

describe("project dialogs", () => {
  it("exposes an accessible description for the create project dialog", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();

    render(<CreateProjectDialog templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])} />);

    await user.click(screen.getByRole("button", { name: "New project" }));

    expect(screen.getByRole("dialog", { name: "Create project" })).toHaveAccessibleDescription(
      "Create a new project, choose its initial team template, and optionally set the default ACP working directory.",
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
