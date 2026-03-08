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
});
