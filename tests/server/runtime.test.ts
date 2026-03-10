import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { createProjectWithRoom, createWorkspaceSnapshot, postUserMessage } from "@/domain/workspace";
import { defaultTemplates } from "@/lib/sample-data/templates";
import type { ExecutorCallbacks, ExecutionRequest, MemberExecutor, MemberExecutorFactory } from "@/server/executor";
import { WorkspacePersistence } from "@/server/persistence";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";

class FakeExecutor implements MemberExecutor {
  private readonly handler: (request: ExecutionRequest, callbacks: ExecutorCallbacks) => Promise<void>;

  constructor(handler: (request: ExecutionRequest, callbacks: ExecutorCallbacks) => Promise<void>) {
    this.handler = handler;
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.handler(request, callbacks);
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 800): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  await assertion();
}

describe("WorkspaceRuntime", () => {
  const runtimes: WorkspaceRuntime[] = [];

  async function createStartedRuntimeRoom(runtime: WorkspaceRuntime, projectName: string, firstMessage: string) {
    const created = await runtime.createProject({
      projectName,
      templateId: "template-product-pod",
    });
    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: firstMessage,
    });
    return created;
  }

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
  });

  it("routes an explicit member @mention into another member task without publishing internal task output", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-"));
    const executorFactory: MemberExecutorFactory = ({ member }) =>
      new FakeExecutor(async (_request, callbacks) => {
        if (member.handle === "lead") {
          await callbacks.onDraft("我先分派给 builder。");
          await callbacks.onComplete("lead internal plan", "end_turn");
          return;
        }

        if (member.handle === "builder") {
          await callbacks.onComplete("builder internal result", "end_turn");
          return;
        }

        await callbacks.onComplete(`${member.handle} no-op`, "end_turn");
      });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory,
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(runtime, "Runtime Check", "把 ACP runtime 接起来");

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;

      expect(leadTask.status).toBe("completed");
    });

    let snapshot = runtime.getSnapshot();
    const roomId = snapshot.selection.roomId!;
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;

    await runtime.sendMemberMessage({
      roomId,
      memberId: lead.id,
      taskId: leadTask.id,
      content: "@builder 先把 ACP runtime 和 CLI 接起来。",
    });

    await waitFor(() => {
      const current = runtime.getSnapshot();
      const builder = current.rooms[roomId].memberIds
        .map((memberId) => current.members[memberId])
        .find((member) => member.handle === "builder")!;
      const builderTask = Object.values(current.tasks).find((task) => task.roomId === roomId && task.memberId === builder.id)!;
      expect(builderTask.status).toBe("completed");
    });

    snapshot = runtime.getSnapshot();
    const messages = (snapshot.messageOrderByRoom[roomId] ?? []).map((messageId) => snapshot.messages[messageId].content);
    expect(messages.some((message) => message.includes("@builder"))).toBe(true);
    expect(messages.some((message) => message.includes("lead internal plan"))).toBe(false);
    expect(messages.some((message) => message.includes("builder internal result"))).toBe(false);
    const leadTraceKinds = (snapshot.taskTraceOrderByTask[leadTask.id] ?? []).map(
      (traceId) => snapshot.taskTraces[traceId]?.kind,
    );

    expect(leadTraceKinds).toContain("task-started");
    expect(leadTraceKinds).toContain("task-prompt");
    expect(leadTraceKinds).toContain("completed");
  });

  it("persists the latest snapshot to disk", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-persist-"));
    const stateFilePath = path.join(workspaceRoot, ".openaquarium", "state.json");
    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    await runtime.createProject({
      projectName: "Persist Check",
      templateId: "template-product-pod",
    });

    await waitFor(async () => {
      const raw = await readFile(stateFilePath, "utf8");
      const payload = JSON.parse(raw) as { snapshot: { projectOrder: string[] } };
      expect(payload.snapshot.projectOrder.length).toBeGreaterThan(0);
    });
  });

  it("captures an error trace when execution crashes before ACP completes", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-crash-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(() => {
          if (member.handle === "lead") {
            return Promise.reject(new Error("executor crashed"));
          }

          return Promise.resolve();
        }),
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(runtime, "Crash Check", "@lead 请回应一下");

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;
      const leadTraceEntries = (snapshot.taskTraceOrderByTask[leadTask.id] ?? []).map(
        (traceId) => snapshot.taskTraces[traceId],
      );

      expect(leadTask.status).toBe("completed");
      expect(leadTraceEntries.some((entry) => entry?.kind === "error")).toBe(true);
    });
  });

  it("records internal draft/status in trace without publishing them into the room transcript", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-status-"));
    let allowCompletion: (() => void) | undefined;
    const completionGate = new Promise<void>((resolve) => {
      allowCompletion = resolve;
    });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle !== "lead") {
            await callbacks.onComplete(`${member.handle} done`, "end_turn");
            return;
          }

          await callbacks.onDraft("正在整理上下文");
          await callbacks.onDraft("正在整理上下文，并补充最新事实");
          await callbacks.onStatus("Run room state (in_progress)");
          await callbacks.onStatus("Inspect room state (completed)");
          await completionGate;
          await callbacks.onComplete("整理完成", "end_turn");
        }),
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(runtime, "Status Check", "@lead 看一下当前状态");

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;
      const leadTraceEntries = (snapshot.taskTraceOrderByTask[leadTask.id] ?? []).map((traceId) => snapshot.taskTraces[traceId]);

      expect((snapshot.messageOrderByRoom[roomId] ?? []).map((messageId) => snapshot.messages[messageId].author.kind)).toEqual(["user"]);
      expect(leadTraceEntries.filter((entry) => entry?.kind === "draft")).toHaveLength(1);
      expect(leadTraceEntries.filter((entry) => entry?.kind === "status")).toHaveLength(1);
      expect(leadTraceEntries.find((entry) => entry?.kind === "draft")?.content).toBe("正在整理上下文，并补充最新事实");
      expect(leadTraceEntries.find((entry) => entry?.kind === "status")?.content).toBe("Inspect room state (completed)");
    });

    allowCompletion?.();

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;

      expect(leadTask.status).toBe("completed");
      expect((snapshot.messageOrderByRoom[roomId] ?? []).map((messageId) => snapshot.messages[messageId].author.kind)).toEqual(["user"]);
      expect((snapshot.taskTraceOrderByTask[leadTask.id] ?? []).some((traceId) => snapshot.taskTraces[traceId]?.kind === "completed")).toBe(true);
    });
  });

  it("continues id allocation after restart instead of colliding with persisted state", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-ids-"));
    const stateFilePath = path.join(workspaceRoot, ".openaquarium", "state.json");
    const executorFactory: MemberExecutorFactory = ({ member }) =>
      new FakeExecutor(async (_request, callbacks) => {
        await callbacks.onComplete(`${member.handle} done`, "end_turn");
      });
    const firstRuntime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      executorFactory,
    });
    runtimes.push(firstRuntime);

    const first = await firstRuntime.createProject({
      projectName: "First",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const runningTasks = Object.values(firstRuntime.getSnapshot().tasks).filter((task) => task.status === "running");
      expect(runningTasks.length).toBe(0);
    });

    await firstRuntime.dispose();
    runtimes.pop();

    const secondRuntime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      executorFactory,
    });
    runtimes.push(secondRuntime);

    const second = await secondRuntime.createProject({
      projectName: "Second",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const runningTasks = Object.values(secondRuntime.getSnapshot().tasks).filter((task) => task.status === "running");
      expect(runningTasks.length).toBe(0);
    });

    expect(second.projectId).not.toBe(first.projectId);
    expect(second.roomId).not.toBe(first.roomId);
  });

  it("expires stale running tasks on startup instead of dispatching them again", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-stale-"));
    const stateFilePath = path.join(workspaceRoot, ".openaquarium", "state.json");
    const persistence = new WorkspacePersistence(stateFilePath);
    const staleContext = createRuntimeContext(0, "2026-03-09T07:30:00.000Z");
    let staleSnapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "Stale",
        templateId: "template-product-pod",
      },
      staleContext,
    );
    staleSnapshot = postUserMessage(
      staleSnapshot,
      {
        roomId: staleSnapshot.selection.roomId!,
        content: "请回复我",
      },
      staleContext,
    );
    const staleRoomId = staleSnapshot.selection.roomId!;
    const staleLead = staleSnapshot.rooms[staleRoomId].memberIds
      .map((memberId) => staleSnapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    await persistence.save(staleSnapshot);

    let executeCount = 0;
    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      executorFactory: () =>
        new FakeExecutor(() => {
          executeCount += 1;
          return Promise.resolve();
        }),
    });
    runtimes.push(runtime);

    const snapshot = runtime.getSnapshot();
    const runningTasks = Object.values(snapshot.tasks).filter((task) => task.status === "running");
    const staleTask = Object.values(snapshot.tasks).find((task) => task.roomId === staleRoomId && task.memberId === staleLead.id);

    expect(runningTasks).toHaveLength(0);
    expect(executeCount).toBe(0);
    expect(staleTask?.status).toBe("completed");
    expect((snapshot.taskTraceOrderByTask[staleTask!.id] ?? []).some((traceId) => snapshot.taskTraces[traceId]?.kind === "error")).toBe(true);
  });

  it("defers watcher runs while the room already has a running task", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-watcher-backoff-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "lead") {
            await new Promise<void>(() => undefined);
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const { roomId } = await runtime.createProject({
      projectName: "Watcher Backoff",
      templateId: "template-product-pod",
    });
    await runtime.sendUserMessage({
      roomId,
      content: "先让 lead 挂起一会儿",
    });
    const watcherId = runtime.getSnapshot().rooms[roomId]?.watcherIds[0];

    expect(watcherId).toBeDefined();
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.runWatcherNow(watcherId);

    const snapshot = runtime.getSnapshot();
    const digestMessages = (snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => snapshot.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(digestMessages).toHaveLength(0);
    expect(snapshot.watchers[watcherId]?.lastConsumedMessageId).toBeUndefined();
  });
});
