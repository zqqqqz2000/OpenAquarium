// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspacePersistence } from "@/server/persistence";
import { ForbiddenRuntimeError, WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";
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

function createRuntime(
  workspaceRoot: string,
  executorFactory: MemberExecutorFactory = () => new CompletingExecutor(),
): WorkspaceRuntime {

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

async function flushMicrotasks(iterations = 8): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function waitForRoomIdle(
  runtime: WorkspaceRuntime,
  roomId: string,
  attempts = 40,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const snapshot = runtime.getSnapshot();
    const hasRunningTask = Object.values(snapshot.tasks).some(
      (task) => task.roomId === roomId && task.status === "running",
    );

    if (!hasRunningTask) {
      return;
    }

    await vi.advanceTimersByTimeAsync(20);
    await flushMicrotasks(10);
  }

  throw new Error(`Room ${roomId} did not become idle in time`);
}

describe("workspace runtime auth", () => {
  const runtimes: WorkspaceRuntime[] = [];

  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) {
      await runtime.dispose();
    }
    runtimes.length = 0;
    vi.useRealTimers();
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

  it("persists login sessions, bootstraps legacy memberships, and projects the user into room humans", async () => {
    configureBootstrapAdmin({ handle: "alice", password: "secret-pass", displayName: "Alice" });
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-auth-runtime-"));
    const runtime = createRuntime(workspaceRoot);
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Legacy project",
      templateId: "template-product-pod",
    });

    const login = await runtime.login({
      handle: "alice",
      password: "secret-pass",
      displayName: "Alice",
    });

    expect(login.authenticated).toBe(true);
    expect(login.createdUser).toBe(true);
    expect(login.memberships).toEqual([
      expect.objectContaining({
        projectId: created.projectId,
        role: "owner",
      }),
    ]);

    const me = await runtime.getMe({ sessionToken: login.sessionToken });
    expect(me.user).toEqual(expect.objectContaining({ handle: "alice", displayName: "Alice" }));

    await runtime.createRoom(
      {
        projectId: created.projectId,
        templateId: "template-product-pod",
      },
      { sessionToken: login.sessionToken },
    );

    const snapshot = await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "hello from alice",
      sessionToken: login.sessionToken,
    });

    const userMessage = Object.values(snapshot.messages)
      .find((message) => message.roomId === created.roomId && message.content === "hello from alice");

    expect(userMessage?.author.kind).toBe("user");
    expect(userMessage?.author.label).toBe("Alice");
    expect(userMessage?.author.handle).toBe("alice");

    const restoredSnapshot = await new WorkspacePersistence(
      path.join(workspaceRoot, ".openaquarium", "state.json"),
    ).load();
    expect(restoredSnapshot).toBeDefined();

    await runtime.dispose();
    runtimes.pop();

    const resumedRuntime = new WorkspaceRuntime({
      initialSnapshot: restoredSnapshot!,
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new CompletingExecutor(),
    });
    runtimes.push(resumedRuntime);

    const restored = await resumedRuntime.restoreSession({ sessionToken: login.sessionToken });
    expect(restored).toEqual(expect.objectContaining({ authenticated: true }));
  });

  it("requires auth for client workspace state and only reveals projects after login", async () => {
    configureBootstrapAdmin({ handle: "alice", password: "secret-pass", displayName: "Alice" });
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-auth-runtime-client-state-"));
    const runtime = createRuntime(workspaceRoot);
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Client gated project",
      templateId: "template-product-pod",
    });

    const unauthenticated = await runtime.getClientState();
    expect(unauthenticated.auth).toEqual(expect.objectContaining({ required: true, authenticated: false }));
    expect(unauthenticated.snapshot.projectOrder).toEqual([]);
    expect(Object.keys(unauthenticated.snapshot.rooms)).toEqual([]);

    const login = await runtime.login({
      handle: "alice",
      password: "secret-pass",
      displayName: "Alice",
    });

    const authenticated = await runtime.getClientState({ sessionToken: login.sessionToken });
    expect(authenticated.auth).toEqual(expect.objectContaining({ required: true, authenticated: true }));
    expect(authenticated.snapshot.projectOrder).toEqual([created.projectId]);
    expect(authenticated.snapshot.roomOrderByProject[created.projectId]).toEqual([created.roomId]);
  });

  it("rejects project mutations when the logged-in user is not a project member", async () => {
    configureBootstrapAdmin({ handle: "owner", password: "owner-pass", displayName: "Owner" });
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-auth-runtime-gate-"));
    const runtime = createRuntime(workspaceRoot);
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Restricted project",
      templateId: "template-product-pod",
    });
    const owner = await runtime.login({
      handle: "owner",
      password: "owner-pass",
      displayName: "Owner",
    });
    expect(owner.memberships[0]?.projectId).toBe(created.projectId);

    await runtime.createManagedUser({
      sessionToken: owner.sessionToken,
      handle: "outsider",
      displayName: "Outsider",
      password: "outsider-pass",
    });

    const outsider = await runtime.login({
      handle: "outsider",
      password: "outsider-pass",
      displayName: "Outsider",
    });
    expect(outsider.memberships).toHaveLength(0);

    await expect(runtime.createRoom(
      {
        projectId: created.projectId,
        templateId: "template-product-pod",
      },
      { sessionToken: outsider.sessionToken },
    )).rejects.toBeInstanceOf(ForbiddenRuntimeError);
  });

  it("keeps runtime online after logout when background watchers are pending or scheduled", async () => {
    vi.useFakeTimers();
    configureBootstrapAdmin({ handle: "alice", password: "secret-pass", displayName: "Alice" });

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-auth-runtime-logout-watchers-"));
    let holdScribe = false;
    let releaseScribe: (() => void) | undefined;
    const scribeReleasePromise = new Promise<void>((resolve) => {
      releaseScribe = resolve;
    });

    const runtime = createRuntime(
      workspaceRoot,
      ({ member }) => ({
        async execute(_request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
          if (member.handle === "scribe" && holdScribe) {
            await scribeReleasePromise;
          }

          await callbacks.onComplete("ok", "end_turn");
        },
        cancel: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
      }),
    );
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Logout Watchers",
      templateId: "template-product-pod",
    });

    const login = await runtime.login({
      handle: "alice",
      password: "secret-pass",
      displayName: "Alice",
    });

    let snapshot = runtime.getSnapshot();
    const scribe = snapshot.rooms[created.roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");
    expect(scribe).toBeDefined();
    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    await runtime.upsertWatcher(
      {
        memberId: scribe.id,
        enabled: true,
        intervalMinutes: 1,
      },
      { sessionToken: login.sessionToken },
    );

    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "先建立 watcher 基线",
      sessionToken: login.sessionToken,
    });
    await waitForRoomIdle(runtime, created.roomId);

    snapshot = runtime.getSnapshot();
    const watcherId = snapshot.rooms[created.roomId].watcherIds.find(
      (candidate) => snapshot.watchers[candidate]?.memberId === scribe.id,
    );
    expect(watcherId).toBeDefined();
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.runWatcherNow(watcherId, { sessionToken: login.sessionToken });
    await waitForRoomIdle(runtime, created.roomId);

    holdScribe = true;
    await runtime.sendUserMessage({
      roomId: created.roomId,
      directMemberId: scribe.id,
      content: "先让 scribe 忙起来",
      sessionToken: login.sessionToken,
    });
    await flushMicrotasks(10);

    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "logout 后这条消息不应把 runtime 打崩",
      sessionToken: login.sessionToken,
    });
    await flushMicrotasks(10);

    const busyRun = await runtime.runWatcherNow(watcherId, { sessionToken: login.sessionToken });
    expect(busyRun.outcome).toBe("busy");

    await runtime.logout({ sessionToken: login.sessionToken });

    const loggedOutState = await runtime.getClientState();
    expect(loggedOutState.auth).toEqual(expect.objectContaining({ required: true, authenticated: false }));

    holdScribe = false;
    releaseScribe?.();
    await vi.advanceTimersByTimeAsync(60 * 1000);
    await flushMicrotasks(20);

    const afterWatcherTick = await runtime.getClientState();
    expect(afterWatcherTick.auth).toEqual(expect.objectContaining({ required: true, authenticated: false }));

    const relogin = await runtime.login({
      handle: "alice",
      password: "secret-pass",
    });
    expect(relogin.authenticated).toBe(true);
    expect(relogin.memberships).toEqual([
      expect.objectContaining({
        projectId: created.projectId,
        role: "owner",
      }),
    ]);

    await waitForRoomIdle(runtime, created.roomId);

    expect(
      Object.values(runtime.getSnapshot().messages).some(
        (message) =>
          message.roomId === created.roomId
          && message.transport === "watch-digest"
          && message.content.includes("logout 后这条消息不应把 runtime 打崩"),
      ),
    ).toBe(true);
  });
});
