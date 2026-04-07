// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { handleWorkspaceJsonApiRequest } from "@/server/http-server";
import { WorkspacePersistence } from "@/server/persistence";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";
import type { ExecutionRequest, ExecutorCallbacks, MemberExecutor, MemberExecutorFactory } from "@/server/executor";

const ORIGINAL_BOOTSTRAP_ADMIN_HANDLE = process.env.OA_BOOTSTRAP_ADMIN_HANDLE;
const ORIGINAL_BOOTSTRAP_ADMIN_PASSWORD = process.env.OA_BOOTSTRAP_ADMIN_PASSWORD;
const ORIGINAL_BOOTSTRAP_ADMIN_DISPLAY_NAME = process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME;

class CompletingExecutor implements MemberExecutor {
  async execute(_request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await callbacks.onComplete("ok", "end_turn");
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

function createRuntime(workspaceRoot: string): WorkspaceRuntime {
  const executorFactory: MemberExecutorFactory = () => new CompletingExecutor();

  return new WorkspaceRuntime({
    initialSnapshot: createEmptyRuntimeSnapshot(),
    persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
    workspaceRoot,
    executorFactory,
  });
}

function configureBootstrapAdmin(args: { handle: string; password: string; displayName: string }): void {
  process.env.OA_BOOTSTRAP_ADMIN_HANDLE = args.handle;
  process.env.OA_BOOTSTRAP_ADMIN_PASSWORD = args.password;
  process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME = args.displayName;
}

describe("workspace auth http api", () => {
  const runtimes: WorkspaceRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
    if (ORIGINAL_BOOTSTRAP_ADMIN_HANDLE === undefined) {
      delete process.env.OA_BOOTSTRAP_ADMIN_HANDLE;
    } else {
      process.env.OA_BOOTSTRAP_ADMIN_HANDLE = ORIGINAL_BOOTSTRAP_ADMIN_HANDLE;
    }
    if (ORIGINAL_BOOTSTRAP_ADMIN_PASSWORD === undefined) {
      delete process.env.OA_BOOTSTRAP_ADMIN_PASSWORD;
    } else {
      process.env.OA_BOOTSTRAP_ADMIN_PASSWORD = ORIGINAL_BOOTSTRAP_ADMIN_PASSWORD;
    }
    if (ORIGINAL_BOOTSTRAP_ADMIN_DISPLAY_NAME === undefined) {
      delete process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME;
    } else {
      process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME = ORIGINAL_BOOTSTRAP_ADMIN_DISPLAY_NAME;
    }
  });

  it("supports login, session restore, me update, and project gate responses", async () => {
    configureBootstrapAdmin({ handle: "alice", password: "secret-pass", displayName: "Alice" });
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-auth-http-"));
    const runtime = createRuntime(workspaceRoot);
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "HTTP auth project",
      templateId: "template-product-pod",
    });

    const loginResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/auth/login",
      body: {
        handle: "alice",
        password: "secret-pass",
        displayName: "Alice",
      },
    });

    expect(loginResult?.statusCode).toBe(200);
    expect(loginResult?.headers?.["set-cookie"]).toContain("oa_session=");
    const sessionToken = (loginResult?.payload as { sessionToken?: string }).sessionToken;
    expect(sessionToken).toBeTruthy();

    const authHeaders = {
      authorization: `Bearer ${sessionToken}`,
    };

    const sessionResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/auth/session",
      headers: authHeaders,
    });
    expect(sessionResult?.statusCode).toBe(200);
    expect(sessionResult?.payload).toEqual(expect.objectContaining({ authenticated: true }));

    const meResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/me",
      headers: authHeaders,
    });
    expect(meResult?.statusCode).toBe(200);
    expect((meResult?.payload as { user: { handle: string } }).user.handle).toBe("alice");

    const membershipsResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/me/projects",
      headers: authHeaders,
    });
    expect(membershipsResult?.statusCode).toBe(200);
    expect((membershipsResult?.payload as { memberships: Array<{ projectId: string; role: string }> }).memberships).toEqual([
      expect.objectContaining({ projectId: created.projectId, role: "owner" }),
    ]);

    const projectMembersAliasResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/me/project-members",
      headers: authHeaders,
    });
    expect(projectMembersAliasResult?.statusCode).toBe(200);
    expect((projectMembersAliasResult?.payload as { memberships: Array<{ projectId: string; role: string }> }).memberships).toEqual([
      expect.objectContaining({ projectId: created.projectId, role: "owner" }),
    ]);

    const updateResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/me",
      headers: authHeaders,
      body: {
        displayName: "Alice Updated",
      },
    });
    expect(updateResult?.statusCode).toBe(200);
    expect((updateResult?.payload as { user: { displayName: string } }).user.displayName).toBe("Alice Updated");

    const createUserResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/admin/users",
      headers: authHeaders,
      body: {
        handle: "outsider",
        password: "outsider-pass",
        displayName: "Outsider",
      },
    });
    expect(createUserResult?.statusCode).toBe(200);

    const outsiderLogin = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/auth/login",
      body: {
        handle: "outsider",
        password: "outsider-pass",
        displayName: "Outsider",
      },
    });
    const outsiderHeaders = {
      authorization: `Bearer ${(outsiderLogin?.payload as { sessionToken?: string }).sessionToken}`,
    };

    const forbiddenCreateRoom = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/projects/${created.projectId}/rooms`,
      headers: outsiderHeaders,
      body: {
        templateId: "template-product-pod",
      },
    });
    expect(forbiddenCreateRoom?.statusCode).toBe(403);

    const logoutResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/auth/logout",
      headers: authHeaders,
    });
    expect(logoutResult?.statusCode).toBe(200);
    expect(logoutResult?.headers?.["set-cookie"]).toContain("Max-Age=0");

    const restoredAfterLogout = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/auth/session",
      headers: authHeaders,
    });
    expect(restoredAfterLogout?.statusCode).toBe(200);
    expect(restoredAfterLogout?.payload).toEqual({ authenticated: false });
  });
});
