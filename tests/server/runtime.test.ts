import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
  });

  it("routes a member's @mention reply into another member task", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-"));
    const executorFactory: MemberExecutorFactory = ({ member }) =>
      new FakeExecutor(async (_request, callbacks) => {
        if (member.handle === "lead") {
          await callbacks.onDraft("我先分派给 builder。");
          await callbacks.onComplete("@builder 先把 ACP runtime 和 CLI 接起来。", "end_turn");
          return;
        }

        if (member.handle === "builder") {
          await callbacks.onComplete("builder 已收到，并开始实现 runtime。", "end_turn");
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

    await runtime.createProject({
      projectName: "Runtime Check",
      firstPrompt: "把 ACP runtime 接起来",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const messages = (snapshot.messageOrderByRoom[roomId] ?? []).map((messageId) => snapshot.messages[messageId].content);
      expect(messages.some((message) => message.includes("@builder"))).toBe(true);
      expect(messages.some((message) => message.includes("builder 已收到"))).toBe(true);
    });

    const snapshot = runtime.getSnapshot();
    const roomId = snapshot.selection.roomId!;
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;
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
      firstPrompt: "确认 state 会被落盘",
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

    await runtime.createProject({
      projectName: "Crash Check",
      firstPrompt: "@lead 请回应一下",
      templateId: "template-product-pod",
    });

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

  it("records ACP status in trace without rewriting the streaming draft body", async () => {
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
          await callbacks.onStatus("Run room state (in_progress)");
          await completionGate;
          await callbacks.onComplete("整理完成", "end_turn");
        }),
    });
    runtimes.push(runtime);

    await runtime.createProject({
      projectName: "Status Check",
      firstPrompt: "@lead 看一下当前状态",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find((task) => task.roomId === roomId && task.memberId === lead.id)!;
      const draftMessageId = leadTask.draftMessageId;

      expect(draftMessageId).toBeDefined();
      expect(snapshot.messages[draftMessageId!]?.content).toBe("正在整理上下文");
      expect((snapshot.taskTraceOrderByTask[leadTask.id] ?? []).some((traceId) => snapshot.taskTraces[traceId]?.kind === "status")).toBe(true);
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
      expect(snapshot.messages[leadTask.draftMessageId!]?.content).toBe("整理完成");
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
      firstPrompt: "first prompt",
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
      firstPrompt: "second prompt",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const runningTasks = Object.values(secondRuntime.getSnapshot().tasks).filter((task) => task.status === "running");
      expect(runningTasks.length).toBe(0);
    });

    expect(second.projectId).not.toBe(first.projectId);
    expect(second.roomId).not.toBe(first.roomId);
  });
});
