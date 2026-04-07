import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceAuthGate, WorkspaceAuthProfileControl } from "@/components/auth/workspace-auth-controls";
import { RECOMMENDED_DEV_RUNTIME_COMMAND } from "@/lib/runtime-dev";
import type { AuthenticatedWorkspaceAuth } from "@/lib/runtime-client";

function createAuth(overrides: Partial<AuthenticatedWorkspaceAuth> = {}): AuthenticatedWorkspaceAuth {
  return {
    required: true,
    authenticated: true,
    createdUser: false,
    sessionToken: "session-token",
    session: {
      id: "session_1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    },
    user: {
      id: "user_1",
      handle: "alice",
      displayName: "Alice",
      isAdmin: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership_1",
        projectId: "project_1",
        projectName: "Coral Reef",
        role: "owner",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

const availableProjects = [
  {
    id: "project_1",
    name: "Coral Reef",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("workspace auth controls", () => {
  it("submits login credentials and clears the password after success", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => undefined);

    render(<WorkspaceAuthGate connected error={undefined} onLogin={onLogin} />);

    await user.type(screen.getByLabelText("Handle"), "alice");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Login" }));

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith({
        handle: "alice",
        password: "hunter2",
      }),
    );
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("keeps login disabled while runtime is offline", () => {
    render(<WorkspaceAuthGate connected={false} error={undefined} onLogin={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Login" })).toBeDisabled();
    expect(screen.getByText(`Start the runtime first with \`${RECOMMENDED_DEV_RUNTIME_COMMAND}\`.`)).toBeInTheDocument();
  });

  it("saves profile edits and shows project memberships", async () => {
    const user = userEvent.setup();
    const onUpdateMe = vi.fn(async () => undefined);

    render(
      <WorkspaceAuthProfileControl
        auth={createAuth()}
        error={undefined}
        availableProjects={availableProjects}
        onLogout={vi.fn(async () => undefined)}
        onUpdateMe={onUpdateMe}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Alice @alice/i }));

    expect(await screen.findByRole("dialog", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("Coral Reef · owner")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Profile display name"));
    await user.type(screen.getByLabelText("Profile display name"), "Alice Updated");
    await user.clear(screen.getByLabelText("Profile handle"));
    await user.type(screen.getByLabelText("Profile handle"), "alice-updated");
    await user.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(onUpdateMe).toHaveBeenCalledWith({
        handle: "alice-updated",
        displayName: "Alice Updated",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Account" })).not.toBeInTheDocument());
  });

  it("shows the empty membership state and supports logout", async () => {
    const user = userEvent.setup();
    const onLogout = vi.fn(async () => undefined);

    render(
      <WorkspaceAuthProfileControl
        auth={createAuth({ memberships: [] })}
        error={undefined}
        availableProjects={availableProjects}
        onLogout={onLogout}
        onUpdateMe={vi.fn(async () => undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Alice @alice/i }));

    expect(await screen.findByText("No project memberships yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
  });

  it("lets admins create managed users from the users tab", async () => {
    const user = userEvent.setup();
    const onListManagedUsers = vi.fn(async () => []);
    const onCreateManagedUser = vi.fn(async () => ({
      id: "user_2",
      handle: "bob",
      displayName: "Bob",
      isAdmin: false,
      createdAt: "2026-01-02T00:00:00.000Z",
      memberships: [],
    }));

    render(
      <WorkspaceAuthProfileControl
        auth={createAuth({
          user: {
            ...createAuth().user,
            isAdmin: true,
          },
        })}
        error={undefined}
        availableProjects={availableProjects}
        onLogout={vi.fn(async () => undefined)}
        onUpdateMe={vi.fn(async () => undefined)}
        onListManagedUsers={onListManagedUsers}
        onCreateManagedUser={onCreateManagedUser}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Alice @alice/i }));
    await user.click(await screen.findByRole("tab", { name: /Users/i }));
    expect(onListManagedUsers).toHaveBeenCalledTimes(1);

    await user.type(screen.getByLabelText("Managed user display name"), "Bob");
    await user.type(screen.getByLabelText("Managed user handle"), "bob");
    await user.type(screen.getByLabelText("Managed user password"), "bob-pass");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() =>
      expect(onCreateManagedUser).toHaveBeenCalledWith({
        handle: "bob",
        displayName: "Bob",
        password: "bob-pass",
        isAdmin: false,
      }),
    );
  });
});
