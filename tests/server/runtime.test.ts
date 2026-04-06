import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { GlobalWorkspaceConfig } from "@/domain/model";
import { createRuntimeContext } from "@/domain/identity";
import {
  createProjectWithRoom,
  createWorkspaceSnapshot,
  postUserMessage,
} from "@/domain/workspace";
import { defaultTemplates } from "@/lib/sample-data/templates";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { OpenAquariumGlobalConfigManager } from "@/server/global-config";
import type {
  ExecutorCallbacks,
  ExecutionRequest,
  MemberExecutor,
  MemberExecutorFactory,
} from "@/server/executor";
import { WorkspacePersistence } from "@/server/persistence";
import { getMemberHistoryFilePath, getRoomTranscriptFilePath } from "@/server/room-transcript-files";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";

class FakeExecutor implements MemberExecutor {
  private readonly handler: (
    request: ExecutionRequest,
    callbacks: ExecutorCallbacks,
  ) => Promise<void>;

  constructor(
    handler: (
      request: ExecutionRequest,
      callbacks: ExecutorCallbacks,
    ) => Promise<void>,
  ) {
    this.handler = handler;
  }

  async execute(
    request: ExecutionRequest,
    callbacks: ExecutorCallbacks,
  ): Promise<void> {
    await callbacks.onPromptVisible?.();
    await this.handler(request, callbacks);
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

class EchoExecutor implements MemberExecutor {
  async execute(
    _request: ExecutionRequest,
    callbacks: ExecutorCallbacks,
  ): Promise<void> {
    await callbacks.onPromptVisible?.();
    await callbacks.onComplete("echo complete", "end_turn");
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

async function waitFor(
  assertion: () => void | Promise<void>,
  timeoutMs = 800,
): Promise<void> {
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

describe("WorkspaceRuntime", () => {
  const runtimes: WorkspaceRuntime[] = [];

  function createRuntimeGlobalConfig(): GlobalWorkspaceConfig {
    return {
      directory: "/tmp/openaquarium-config",
      modelProfiles: [
        {
          id: "model-codex",
          name: "Codex ACP",
          description: "default acp profile",
          providerType: "acp",
          binding: {
            kind: "codex-acp",
            label: "Codex ACP",
            command: "npx",
            args: ["@zed-industries/codex-acp@latest"],
            env: {},
            capabilities: ["prompt", "cancel", "loadSession"],
          },
        },
        {
          id: "model-openai-compatible",
          name: "OpenAI-Compatible API",
          description: "stateless http provider",
          providerType: "openai-compatible",
          binding: {
            kind: "openai-compatible",
            label: "OpenAI-Compatible API",
            baseURL: "https://example.test/v1",
            apiKeyEnvVar: "OPENAI_API_KEY",
            headersFormat: "kv",
            headers: {},
            extraBodyFormat: "json",
            extraBody: {},
            mcpServers: [],
          },
        },
      ],
      templateChatModelProfileId: "model-codex",
    };
  }

  async function createStartedRuntimeRoom(
    runtime: WorkspaceRuntime,
    projectName: string,
    firstMessage: string,
  ) {
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
    vi.useRealTimers();
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
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory,
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(
      runtime,
      "Runtime Check",
      "把 ACP runtime 接起来",
    );

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;

      expect(leadTask.status).toBe("completed");
    });

    let snapshot = runtime.getSnapshot();
    const roomId = snapshot.selection.roomId!;
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === roomId && task.memberId === lead.id,
    )!;

    await runtime.sendMemberMessage({
      roomId,
      memberId: lead.id,
      taskId: leadTask.id,
      content: "@>builder 先把 ACP runtime 和 CLI 接起来。",
    });

    await waitFor(() => {
      const current = runtime.getSnapshot();
      const builder = current.rooms[roomId].memberIds
        .map((memberId) => current.members[memberId])
        .find((member) => member.handle === "builder")!;
      const builderTask = Object.values(current.tasks).find(
        (task) => task.roomId === roomId && task.memberId === builder.id,
      )!;
      expect(builderTask.status).toBe("completed");
    });

    snapshot = runtime.getSnapshot();
    const messages = (snapshot.messageOrderByRoom[roomId] ?? []).map(
      (messageId) => snapshot.messages[messageId].content,
    );
    expect(messages.some((message) => message.includes("@>builder"))).toBe(
      true,
    );
    expect(
      messages.some((message) => message.includes("lead internal plan")),
    ).toBe(false);
    expect(
      messages.some((message) => message.includes("builder internal result")),
    ).toBe(false);
    const leadTraceKinds = (
      snapshot.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => snapshot.taskTraces[traceId]?.kind);

    expect(leadTraceKinds).toContain("task-started");
    expect(leadTraceKinds).toContain("task-prompt");
    expect(leadTraceKinds).toContain("completed");
  });

  it("preserves authorHumanId and directHumanId through sendUserMessage", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-human-chain-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createSeedWorkspace(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const snapshot = runtime.getSnapshot();
    const roomId = snapshot.selection.roomId!;
    snapshot.humans = {
      ...(snapshot.humans ?? {}),
      human_alice: {
        id: "human_alice",
        roomId,
        displayName: "Alice",
        handle: "alice",
        kind: "human",
      },
      human_bob: {
        id: "human_bob",
        roomId,
        displayName: "Bob",
        handle: "bob",
        kind: "human",
      },
    };
    snapshot.humanOrderByRoom = {
      ...(snapshot.humanOrderByRoom ?? {}),
      [roomId]: [...(snapshot.humanOrderByRoom?.[roomId] ?? []), "human_alice", "human_bob"],
    };

    await runtime.sendUserMessage({
      roomId,
      content: "只发给 Bob",
      authorHumanId: "human_alice",
      directHumanId: "human_bob",
    });

    const next = runtime.getSnapshot();
    const messageId = next.messageOrderByRoom[roomId]?.at(-1);

    expect(messageId).toBeTruthy();
    expect(next.messages[messageId!]).toMatchObject({
      content: "只发给 Bob",
      transport: "direct",
      author: expect.objectContaining({
        humanId: "human_alice",
        handle: "alice",
        label: "Alice",
      }),
      recipientHumanIds: ["human_bob"],
    });
  });

  it("persists the latest snapshot to disk", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-persist-"));
    const stateFilePath = path.join(
      workspaceRoot,
      ".openaquarium",
      "state.json",
    );
    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath: path.join(workspaceRoot, ".config"),
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
      const payload = JSON.parse(raw) as {
        snapshot: { projectOrder: string[] };
      };
      expect(payload.snapshot.projectOrder.length).toBeGreaterThan(0);
    });
  });

  it("resolves openai-compatible model profiles for member execution", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-openai-profile-"));
    const seenProviderKinds: string[] = [];
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      globalConfig: createRuntimeGlobalConfig(),
      executorFactory: ({ member }) => {
        seenProviderKinds.push(member.provider.kind);
        return new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        });
      },
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "OpenAI Profile Runtime",
      templateId: "template-product-pod",
    });
    const snapshot = runtime.getSnapshot();
    const room = snapshot.rooms[created.roomId];
    const lead = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead");

    if (!lead) {
      throw new Error("Expected the lead member");
    }

    await runtime.updateMemberConfig({
      memberId: lead.id,
      isRole: lead.isRole,
      summary: lead.summary,
      prompt: lead.prompt,
      modelProfileId: "model-openai-compatible",
      modelId: "gpt-4.1-mini",
      acceptsDirectMessages: lead.acceptsDirectMessages,
      codexThinkingDepth: lead.codexThinkingDepth,
      allowedSkillIds: lead.allowedSkillIds,
      provider: lead.provider,
    });
    await runtime.sendUserMessage({
      roomId: room.id,
      content: "@>lead 用 openai-compatible provider 回一下",
    });
    await waitFor(() => {
      expect(seenProviderKinds).toContain("openai-compatible");
      const current = runtime.getSnapshot();
      const latestLead = current.rooms[room.id].memberIds
        .map((memberId) => current.members[memberId])
        .find((member) => member.handle === "lead");
      const latestTask = latestLead?.activeTaskId ? current.tasks[latestLead.activeTaskId] : undefined;
      expect(latestTask?.status).not.toBe("running");
    });

    expect(seenProviderKinds).toContain("openai-compatible");
  });

  it("lets room members inherit openai-compatible MCP profile config from their template model profile", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-openai-template-mcp-"));
    const seenBindings: Array<ExecutionRequest["member"]["provider"]> = [];
    const initialSnapshot = createEmptyRuntimeSnapshot();
    const template = initialSnapshot.templates["template-product-pod"];
    if (!template) {
      throw new Error("Expected template-product-pod template");
    }

    initialSnapshot.templates[template.id] = {
      ...template,
      members: template.members.map((member) =>
        member.handle === "lead"
          ? {
              ...member,
              modelProfileId: "model-openai-compatible",
              modelId: "gpt-4.1-mini",
            }
          : member),
    };

    const globalConfig = createRuntimeGlobalConfig();
    const openAIProfile = globalConfig.modelProfiles.find((profile) => profile.id === "model-openai-compatible");
    if (!openAIProfile || openAIProfile.providerType !== "openai-compatible") {
      throw new Error("Expected openai-compatible model profile");
    }
    openAIProfile.binding.mcpServers = [
      {
        id: "local-files",
        transport: "stdio",
        command: "node",
        args: ["./mcp-server.js"],
        env: {
          MCP_MODE: "test",
        },
        cwd: "./mcp",
      },
    ];

    const runtime = new WorkspaceRuntime({
      initialSnapshot,
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      globalConfig,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (request, callbacks) => {
          seenBindings.push(request.member.provider);
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Template MCP Inheritance",
      templateId: "template-product-pod",
    });
    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "@>lead 试一下继承模板里的 openai-compatible MCP profile",
    });

    await waitFor(() => {
      expect(seenBindings.length).toBeGreaterThan(0);
      expect(seenBindings.some((binding) => binding.kind === "openai-compatible")).toBe(true);
    });

    expect(seenBindings.find((binding) => binding.kind === "openai-compatible")).toMatchObject({
      kind: "openai-compatible",
      mcpServers: [
        {
          id: "local-files",
          transport: "stdio",
          command: "node",
        },
      ],
    });
  });

  it("persists openai-compatible conversation history across turns", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-openai-history-"));
    const seenRequests: ExecutionRequest[] = [];
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      globalConfig: createRuntimeGlobalConfig(),
      executorFactory: ({ member }) =>
        new FakeExecutor(async (request, callbacks) => {
          seenRequests.push(request);
          await callbacks.onComplete(`${member.handle} done`, "end_turn", {
            nextOpenAICompatibleConversation: {
              messages: [
                ...(request.messageHistory ?? []),
                {
                  role: "user",
                  content: request.prompt,
                },
                {
                  role: "assistant",
                  content: `${member.handle} done`,
                },
              ],
            },
          });
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "OpenAI History Runtime",
      templateId: "template-product-pod",
    });
    const initial = runtime.getSnapshot();
    const room = initial.rooms[created.roomId];
    const lead = room.memberIds
      .map((memberId) => initial.members[memberId])
      .find((member) => member.handle === "lead");

    if (!lead) {
      throw new Error("Expected the lead member");
    }

    await runtime.updateMemberConfig({
      memberId: lead.id,
      isRole: lead.isRole,
      summary: lead.summary,
      prompt: lead.prompt,
      modelProfileId: "model-openai-compatible",
      modelId: "gpt-4.1-mini",
      acceptsDirectMessages: lead.acceptsDirectMessages,
      codexThinkingDepth: lead.codexThinkingDepth,
      allowedSkillIds: lead.allowedSkillIds,
      provider: lead.provider,
    });
    await runtime.sendUserMessage({
      roomId: room.id,
      content: "@>lead 第一轮 openai compatible 历史",
    });
    await waitFor(() => {
      expect(seenRequests.length).toBeGreaterThanOrEqual(1);
      expect(runtime.getSnapshot().members[lead.id]?.openAICompatibleConversation?.messages.length).toBe(2);
    });

    await runtime.sendUserMessage({
      roomId: room.id,
      content: "@>lead 第二轮 openai compatible 历史",
    });
    await waitFor(() => {
      expect(seenRequests.length).toBeGreaterThanOrEqual(2);
    });

    expect(seenRequests[0]?.messageHistory ?? []).toEqual([]);
    expect(seenRequests[0]?.prompt).toContain("prompt mode: full");
    expect(seenRequests[1]?.messageHistory).toEqual([
      {
        role: "user",
        content: seenRequests[0]?.prompt ?? "",
      },
      {
        role: "assistant",
        content: "lead done",
      },
    ]);
    expect(seenRequests[1]?.prompt).toContain("prompt mode: delta");
  });

  it("normalizes project paths against the OpenAquarium workspace root", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-path-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      globalConfigManager: new OpenAquariumGlobalConfigManager(
        path.join(workspaceRoot, ".config"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Path Check",
      templateId: "template-product-pod",
      path: "../real-repo",
    });

    expect(runtime.getSnapshot().projects[created.projectId]?.path).toBe(
      path.resolve(workspaceRoot, "../real-repo"),
    );
  });

  it("keeps the same executor after persisting a provider session id", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-session-key-"),
    );
    let disposeCount = 0;
    const executors: MemberExecutor[] = [];
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: () => {
        const executor: MemberExecutor = {
          execute: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          dispose: () => {
            disposeCount += 1;
            return Promise.resolve();
          },
        };
        executors.push(executor);
        return executor;
      },
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Session Key Check",
      templateId: "template-product-pod",
    });
    const snapshot = runtime.getSnapshot();
    const room = snapshot.rooms[created.roomId];
    const project = snapshot.projects[created.projectId];
    const lead = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead");

    expect(lead).toBeDefined();

    const firstExecutor = (runtime as never as {
      getExecutor: (
        memberId: string,
        member: (typeof snapshot.members)[string],
        roomArg: typeof room,
        projectArg: typeof project,
      ) => MemberExecutor;
    }).getExecutor(lead!.id, lead!, room, project);

    expect(executors).toHaveLength(1);

    await (runtime as never as {
      persistMemberProviderSession: (memberId: string, sessionId?: string) => Promise<void>;
    }).persistMemberProviderSession(lead!.id, "session_1");

    const updatedSnapshot = runtime.getSnapshot();
    const updatedLead = updatedSnapshot.members[lead!.id];
    const secondExecutor = (runtime as never as {
      getExecutor: (
        memberId: string,
        member: (typeof updatedSnapshot.members)[string],
        roomArg: typeof room,
        projectArg: typeof project,
      ) => MemberExecutor;
    }).getExecutor(updatedLead.id, updatedLead, room, project);

    expect(secondExecutor).toBe(firstExecutor);
    expect(executors).toHaveLength(1);
    expect(disposeCount).toBe(0);
  });

  it("deletes a room and project while cleaning their runtime state", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-delete-"),
    );
    let disposeCount = 0;
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: () => ({
        execute: async () => {
          await new Promise<void>(() => undefined);
        },
        cancel: () => Promise.resolve(),
        dispose: () => {
          disposeCount += 1;
          return Promise.resolve();
        },
      }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Delete Check",
      templateId: "template-product-pod",
    });
    const roomBeforeDelete = runtime.getSnapshot().rooms[created.roomId];
    if (!roomBeforeDelete) {
      throw new Error("Expected created room");
    }

    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "先让 lead 开始处理",
    });

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      expect(
        Object.values(snapshot.tasks).some(
          (task) => task.roomId === created.roomId && task.status === "running",
        ),
      ).toBe(true);
    });

    const roomSnapshot = await runtime.deleteRoom(created.roomId);
    expect(roomSnapshot.rooms[created.roomId]).toBeUndefined();
    expect(roomSnapshot.selection.projectId).toBe(created.projectId);
    expect(roomSnapshot.selection.roomId).toBeUndefined();
    roomBeforeDelete.memberIds.forEach((memberId) => {
      expect(roomSnapshot.members[memberId]).toBeUndefined();
    });
    roomBeforeDelete.watcherIds.forEach((watcherId) => {
      expect(roomSnapshot.watchers[watcherId]).toBeUndefined();
    });
    expect((roomSnapshot.messageOrderByRoom[created.roomId] ?? []).length).toBe(
      0,
    );
    expect(disposeCount).toBeGreaterThan(0);

    const projectSnapshot = await runtime.deleteProject(created.projectId);
    expect(projectSnapshot.projects[created.projectId]).toBeUndefined();
    expect(
      projectSnapshot.roomOrderByProject[created.projectId],
    ).toBeUndefined();
    expect(projectSnapshot.selection.projectId).toBeUndefined();
  });

  it("materializes room transcript files on startup from persisted state", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-transcript-"),
    );
    const stateFilePath = path.join(
      workspaceRoot,
      ".openaquarium",
      "state.json",
    );
    const persistence = new WorkspacePersistence(stateFilePath);
    const context = createRuntimeContext(1200, "2026-03-10T12:30:00.000Z");
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "Transcript Boot",
        templateId: "template-product-pod",
      },
      context,
    );
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: snapshot.selection.roomId!,
        content: "把这条历史消息写入 transcript 文件。",
      },
      context,
    );
    const room = snapshot.rooms[snapshot.selection.roomId!];
    await persistence.save(snapshot);

    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath: path.join(workspaceRoot, ".config"),
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const transcriptPath = getRoomTranscriptFilePath(workspaceRoot, room);
    const transcript = await readFile(transcriptPath, "utf8");

    expect(transcript).toContain("把这条历史消息写入 transcript 文件。");
    expect(transcript).toContain(`# ${room.name}`);
  });

  it("prunes snapshot-only team templates that are no longer in global config and not used by any room", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-template-prune-"),
    );
    const stateFilePath = path.join(
      workspaceRoot,
      ".openaquarium",
      "state.json",
    );
    const persistence = new WorkspacePersistence(stateFilePath);
    const snapshot = createWorkspaceSnapshot([
      ...defaultTemplates,
      {
        id: "template-unused-browser-chat-check",
        name: "Unused Browser Chat Check",
        description: "stale template",
        accentTone: "paper",
        members: [
          {
            id: "unused-member",
            name: "Unused Member",
            handle: "unused",
            summary: "unused",
            prompt: "unused",
            accentTone: "paper",
            provider: {
              kind: "codex-acp",
              label: "Codex ACP",
              command: "npx",
              args: ["@zed-industries/codex-acp@^0.7.0"],
              env: {},
              capabilities: ["prompt", "cancel", "loadSession"],
            },
            isEntryMember: true,
            acceptsDirectMessages: true,
            allowedSkillIds: [],
          },
        ],
      },
    ]);
    await persistence.save(snapshot);

    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath: path.join(workspaceRoot, ".config"),
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    expect(runtime.getSnapshot().templateOrder).not.toContain(
      "template-unused-browser-chat-check",
    );
    expect(
      runtime.getSnapshot().templates["template-unused-browser-chat-check"],
    ).toBeUndefined();
  });

  it("publishes executor-reported failures as room status without exposing them to members", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-error-message-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "lead") {
            await callbacks.onError(
              "executor reported @builder failure\nwith details",
            );
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(
      runtime,
      "Failure Check",
      "@lead 请回应一下",
    );

    await waitFor(async () => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const room = snapshot.rooms[roomId];
      const lead = room.memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;
      const leadTraceEntries = (
        snapshot.taskTraceOrderByTask[leadTask.id] ?? []
      ).map((traceId) => snapshot.taskTraces[traceId]);
      const roomMessages = (snapshot.messageOrderByRoom[roomId] ?? []).map(
        (messageId) => snapshot.messages[messageId],
      );
      const transcript = await readFile(
        getRoomTranscriptFilePath(workspaceRoot, room),
        "utf8",
      );
      const memberHistory = await readFile(
        getMemberHistoryFilePath(workspaceRoot, room, lead),
        "utf8",
      );
      const roomState = (
        runtime as unknown as { describeRoomState: (roomId: string) => string }
      ).describeRoomState(roomId);

      expect(leadTask.status).toBe("completed");
      expect(
        leadTraceEntries.some(
          (entry) =>
            entry?.kind === "error" &&
            entry.content ===
              "executor reported @builder failure\nwith details",
        ),
      ).toBe(true);
      expect(
        roomMessages.some(
          (message) =>
            message.author.kind === "system" &&
            message.transport === "status" &&
            message.content ===
              "@lead 任务执行失败：executor reported @builder failure with details",
        ),
      ).toBe(true);
      expect(transcript).not.toContain(
        "@lead 任务执行失败：executor reported @builder failure with details",
      );
      expect(memberHistory).not.toContain(
        "executor reported @builder failure",
      );
      expect(roomState).not.toContain(
        "@lead 任务执行失败：executor reported @builder failure with details",
      );
      expect(
        Object.values(snapshot.tasks).some(
          (task) => snapshot.members[task.memberId]?.handle === "builder",
        ),
      ).toBe(false);
    });
  });

  it("publishes crash failures as room status without exposing them to members", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-crash-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(() => {
          if (member.handle === "lead") {
            return Promise.reject(new Error("executor crashed @builder"));
          }

          return Promise.resolve();
        }),
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(runtime, "Crash Check", "@lead 请回应一下");

    await waitFor(async () => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const room = snapshot.rooms[roomId];
      const lead = room.memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;
      const leadTraceEntries = (
        snapshot.taskTraceOrderByTask[leadTask.id] ?? []
      ).map((traceId) => snapshot.taskTraces[traceId]);
      const roomMessages = (snapshot.messageOrderByRoom[roomId] ?? []).map(
        (messageId) => snapshot.messages[messageId],
      );
      const transcript = await readFile(
        getRoomTranscriptFilePath(workspaceRoot, room),
        "utf8",
      );
      const memberHistory = await readFile(
        getMemberHistoryFilePath(workspaceRoot, room, lead),
        "utf8",
      );
      const roomState = (
        runtime as unknown as { describeRoomState: (roomId: string) => string }
      ).describeRoomState(roomId);

      expect(leadTask.status).toBe("completed");
      expect(
        leadTraceEntries.some(
          (entry) =>
            entry?.kind === "error" &&
            entry.content === "executor crashed @builder",
        ),
      ).toBe(true);
      expect(
        roomMessages.some(
          (message) =>
            message.author.kind === "system" &&
            message.transport === "status" &&
            message.content === "@lead 任务执行失败：executor crashed @builder",
        ),
      ).toBe(true);
      expect(transcript).not.toContain("@lead 任务执行失败：executor crashed @builder");
      expect(memberHistory).not.toContain("executor crashed @builder");
      expect(roomState).not.toContain("@lead 任务执行失败：executor crashed @builder");
      expect(
        Object.values(snapshot.tasks).some(
          (task) => snapshot.members[task.memberId]?.handle === "builder",
        ),
      ).toBe(false);
    });
  });

  it("fails a task when the executor returns without a completion signal", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-no-settle-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 200,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "lead") {
            void callbacks;
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "No Settle",
      templateId: "template-product-pod",
    });

    const observedErrors: string[] = [];
    await runtime.streamUserMessage(
      {
        roomId: created.roomId,
        content: "@lead 请回应一下",
      },
      {
        onError(route) {
          observedErrors.push(route.message);
        },
      },
    );

    const snapshot = runtime.getSnapshot();
    const lead = snapshot.rooms[created.roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === created.roomId && task.memberId === lead.id,
    )!;
    const leadTraceEntries = (
      snapshot.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => snapshot.taskTraces[traceId]);
    const roomMessages = (
      snapshot.messageOrderByRoom[created.roomId] ?? []
    ).map((messageId) => snapshot.messages[messageId]);

    expect(leadTask.status).toBe("completed");
    expect(observedErrors).toEqual([
      "Executor returned without reporting completion or failure.",
    ]);
    expect(
      leadTraceEntries.some(
        (entry) =>
          entry?.kind === "error" &&
          entry.title === "Task ended without completion signal" &&
          entry.content ===
            "Executor returned without reporting completion or failure.",
      ),
    ).toBe(true);
    expect(
      roomMessages.some(
        (message) =>
          message.author.kind === "system" &&
          message.transport === "status" &&
          message.content.includes(
            "Executor returned without reporting completion or failure.",
          ),
      ),
    ).toBe(true);
  });

  it("fails a task after the executor stops making progress", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-stall-timeout-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 40,
      taskExecutionMaxRetries: 0,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "lead") {
            await callbacks.onDraft("正在处理中");
            await new Promise<void>(() => undefined);
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Stall Timeout",
      templateId: "template-product-pod",
    });

    const observedErrors: string[] = [];
    await runtime.streamUserMessage(
      {
        roomId: created.roomId,
        content: "@lead 请继续",
      },
      {
        onError(route) {
          observedErrors.push(route.message);
        },
      },
    );

    const snapshot = runtime.getSnapshot();
    const lead = snapshot.rooms[created.roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === created.roomId && task.memberId === lead.id,
    )!;
    const leadTraceEntries = (
      snapshot.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => snapshot.taskTraces[traceId]);
    const room = snapshot.rooms[created.roomId];
    const transcript = await readFile(
      getRoomTranscriptFilePath(workspaceRoot, room),
      "utf8",
    );
    const memberHistory = await readFile(
      getMemberHistoryFilePath(workspaceRoot, room, lead),
      "utf8",
    );
    const roomMessages = (
      snapshot.messageOrderByRoom[created.roomId] ?? []
    ).map((messageId) => snapshot.messages[messageId]);
    const roomState = (
      runtime as unknown as { describeRoomState: (roomId: string) => string }
    ).describeRoomState(created.roomId);

    expect(leadTask.status).toBe("completed");
    expect(observedErrors[0]).toContain("没有新的进度或完成信号");
    expect(
      leadTraceEntries.filter((entry) => entry?.kind === "draft"),
    ).toHaveLength(1);
    expect(
      leadTraceEntries.some(
        (entry) =>
          entry?.kind === "error" &&
          entry.title === "Task timed out waiting for executor progress" &&
          entry.content.includes("没有新的进度或完成信号"),
      ),
    ).toBe(true);
    expect(
      roomMessages.some(
        (message) =>
          message.author.kind === "system" &&
          message.transport === "status" &&
          message.content.includes("没有新的进度或完成信号"),
      ),
    ).toBe(true);
    expect(transcript).not.toContain("没有新的进度或完成信号");
    expect(memberHistory).not.toContain("没有新的进度或完成信号");
    expect(roomState).not.toContain("没有新的进度或完成信号");
  });

  it("reaps a zombie running task when its last progress is older than the inactivity timeout", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-zombie-reaper-"),
    );
    const staleContext = createRuntimeContext(0, "2026-03-16T10:00:00.000Z");
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "Zombie Reaper",
        templateId: "template-product-pod",
      },
      staleContext,
    );
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: snapshot.selection.roomId!,
        content: "@lead 继续处理",
      },
      staleContext,
    );

    const runtime = new WorkspaceRuntime({
      initialSnapshot: snapshot,
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 40,
      taskExecutionMaxRetries: 0,
      executorFactory: () =>
        new FakeExecutor(async () => {
          await new Promise<void>(() => undefined);
        }),
    });
    runtimes.push(runtime);

    await waitFor(() => {
      const current = runtime.getSnapshot();
      const lead = current.rooms[snapshot.selection.roomId!].memberIds
        .map((memberId) => current.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(current.tasks).find(
        (task) =>
          task.roomId === snapshot.selection.roomId! &&
          task.memberId === lead.id,
      )!;

      expect(leadTask.status).toBe("completed");
    }, 300);

    const current = runtime.getSnapshot();
    const lead = current.rooms[snapshot.selection.roomId!].memberIds
      .map((memberId) => current.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(current.tasks).find(
      (task) =>
        task.roomId === snapshot.selection.roomId! &&
        task.memberId === lead.id,
    )!;
    const leadTraceEntries = (
      current.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => current.taskTraces[traceId]);

    expect(leadTask.status).toBe("completed");
    expect(
      leadTraceEntries.some(
        (entry) =>
          entry?.kind === "error" &&
          entry.title === "Task timed out waiting for executor progress" &&
          entry.content.includes("没有新的进度或完成信号"),
      ),
    ).toBe(true);
  });

  it("retries a timed out task and succeeds on a later attempt", async () => {
    vi.useRealTimers();
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-timeout-retry-success-"),
    );
    let leadAttemptCount = 0;
    let releaseCurrentAttempt: (() => void) | undefined;
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 40,
      taskExecutionMaxRetries: 2,
      executorFactory: ({ member }) => ({
        execute: async (_request, callbacks) => {
          if (member.handle === "lead") {
            leadAttemptCount += 1;
            if (leadAttemptCount < 3) {
              await callbacks.onDraft(`尝试 ${leadAttemptCount}`);
              await new Promise<void>((resolve) => {
                releaseCurrentAttempt = resolve;
              });
              return;
            }

            await callbacks.onComplete("第三次成功", "end_turn");
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        },
        cancel: () => {
          releaseCurrentAttempt?.();
          releaseCurrentAttempt = undefined;
          return Promise.resolve();
        },
        dispose: () => Promise.resolve(),
      }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Retry Success",
      templateId: "template-product-pod",
    });

    const completionPromise = runtime.streamUserMessage(
      {
        roomId: created.roomId,
        content: "@lead 请处理并重试",
      },
      {},
    );

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      expect(
        Object.values(snapshot.tasks).some(
          (task) => task.roomId === created.roomId && task.status === "running",
        ),
      ).toBe(false);
    }, 1_000);
    await completionPromise;

    const snapshot = runtime.getSnapshot();
    const lead = snapshot.rooms[created.roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === created.roomId && task.memberId === lead.id,
    )!;
    const leadTraceEntries = (
      snapshot.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => snapshot.taskTraces[traceId]);

    expect(leadAttemptCount).toBe(3);
    expect(leadTask.status).toBe("completed");
    expect(
      leadTraceEntries.filter(
        (entry) => entry?.title === "Task retry scheduled",
      ),
    ).toHaveLength(2);
    expect(
      leadTraceEntries.some(
        (entry) =>
          entry?.kind === "completed" && entry.content === "第三次成功",
      ),
    ).toBe(true);
  });

  it("fails a task after exhausting timeout retries", async () => {
    vi.useRealTimers();
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-timeout-retry-fail-"),
    );
    let leadAttemptCount = 0;
    let releaseCurrentAttempt: (() => void) | undefined;
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 40,
      taskExecutionMaxRetries: 2,
      executorFactory: ({ member }) => ({
        execute: async (_request, callbacks) => {
          if (member.handle === "lead") {
            leadAttemptCount += 1;
            await callbacks.onDraft(`尝试 ${leadAttemptCount}`);
            await new Promise<void>((resolve) => {
              releaseCurrentAttempt = resolve;
            });
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        },
        cancel: () => {
          releaseCurrentAttempt?.();
          releaseCurrentAttempt = undefined;
          return Promise.resolve();
        },
        dispose: () => Promise.resolve(),
      }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Retry Fail",
      templateId: "template-product-pod",
    });

    const observedErrors: string[] = [];
    const completionPromise = runtime.streamUserMessage(
      {
        roomId: created.roomId,
        content: "@lead 请处理并持续卡住",
      },
      {
        onError(route) {
          observedErrors.push(route.message);
        },
      },
    );

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      expect(
        Object.values(snapshot.tasks).some(
          (task) => task.roomId === created.roomId && task.status === "running",
        ),
      ).toBe(false);
    }, 1_000);
    await completionPromise;

    const snapshot = runtime.getSnapshot();
    const lead = snapshot.rooms[created.roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === created.roomId && task.memberId === lead.id,
    )!;
    const leadTraceEntries = (
      snapshot.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => snapshot.taskTraces[traceId]);

    expect(leadAttemptCount).toBe(3);
    expect(leadTask.status).toBe("completed");
    expect(observedErrors).toHaveLength(1);
    expect(observedErrors[0]).toContain("没有新的进度或完成信号");
    expect(
      leadTraceEntries.filter(
        (entry) => entry?.title === "Task retry scheduled",
      ),
    ).toHaveLength(2);
    expect(
      leadTraceEntries.some(
        (entry) =>
          entry?.kind === "error" &&
          entry.title === "Task timed out waiting for executor progress" &&
          entry.content.includes("没有新的进度或完成信号"),
      ),
    ).toBe(true);
  });

  it("keeps long-running tasks active when inactivity timeout is explicitly disabled", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-no-default-timeout-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 0,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "lead") {
            await callbacks.onDraft("开始处理");
            await new Promise<void>(() => undefined);
            return;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "No Default Timeout",
      templateId: "template-product-pod",
    });

    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "@lead 慢慢处理",
    });

    await new Promise((resolve) => setTimeout(resolve, 120));

    const snapshot = runtime.getSnapshot();
    const lead = snapshot.rooms[created.roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === created.roomId && task.memberId === lead.id,
    )!;
    const leadTraceEntries = (
      snapshot.taskTraceOrderByTask[leadTask.id] ?? []
    ).map((traceId) => snapshot.taskTraces[traceId]);

    expect(leadTask.status).toBe("running");
    expect(leadTraceEntries.some((entry) => entry?.kind === "error")).toBe(
      false,
    );
    expect(
      leadTraceEntries.find((entry) => entry?.kind === "draft")?.content,
    ).toBe("开始处理");
  });

  it("records internal draft/status in trace without publishing them into the room transcript", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-status-"),
    );
    let allowCompletion: (() => void) | undefined;
    const completionGate = new Promise<void>((resolve) => {
      allowCompletion = resolve;
    });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
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

    await createStartedRuntimeRoom(
      runtime,
      "Status Check",
      "@lead 看一下当前状态",
    );

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;
      const leadTraceEntries = (
        snapshot.taskTraceOrderByTask[leadTask.id] ?? []
      ).map((traceId) => snapshot.taskTraces[traceId]);
      const statusEntries = leadTraceEntries.filter(
        (entry) => entry?.kind === "status",
      );

      expect(
        (snapshot.messageOrderByRoom[roomId] ?? []).map(
          (messageId) => snapshot.messages[messageId].author.kind,
        ),
      ).toEqual(["user"]);
      expect(
        leadTraceEntries.filter((entry) => entry?.kind === "draft"),
      ).toHaveLength(1);
      expect(statusEntries).toHaveLength(2);
      expect(
        leadTraceEntries.find((entry) => entry?.kind === "draft")?.content,
      ).toBe("正在整理上下文，并补充最新事实");
      expect(statusEntries.map((entry) => entry?.content)).toEqual([
        "Run room state (in_progress)",
        "Inspect room state",
      ]);
    });

    allowCompletion?.();

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;

      expect(leadTask.status).toBe("completed");
      expect(
        (snapshot.messageOrderByRoom[roomId] ?? []).map(
          (messageId) => snapshot.messages[messageId].author.kind,
        ),
      ).toEqual(["user"]);
      expect(
        (snapshot.taskTraceOrderByTask[leadTask.id] ?? []).some(
          (traceId) => snapshot.taskTraces[traceId]?.kind === "completed",
        ),
      ).toBe(true);
    });
  });

  it("accumulates reasoning status like drafts and starts a new block after a tool boundary", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-reasoning-status-"),
    );
    let allowCompletion: (() => void) | undefined;
    const completionGate = new Promise<void>((resolve) => {
      allowCompletion = resolve;
    });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle !== "lead") {
            await callbacks.onComplete(`${member.handle} done`, "end_turn");
            return;
          }

          await callbacks.onStatus("Reasoning: approach ");
          await callbacks.onStatus("Reasoning:plan");
          await callbacks.onStatus("Read room state (called)");
          await callbacks.onStatus("Reasoning: next");
          await callbacks.onStatus("Reasoning: step");
          await completionGate;
          await callbacks.onComplete("整理完成", "end_turn");
        }),
    });
    runtimes.push(runtime);

    await createStartedRuntimeRoom(
      runtime,
      "Reasoning Check",
      "@lead 看一下 reasoning",
    );

    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;
      const leadTraceEntries = (
        snapshot.taskTraceOrderByTask[leadTask.id] ?? []
      ).map((traceId) => snapshot.taskTraces[traceId]);
      const statusEntries = leadTraceEntries.filter(
        (entry) => entry?.kind === "status",
      );

      expect(statusEntries.map((entry) => `${entry?.title}:${entry?.content}`)).toEqual([
        "Reasoning:approach plan",
        "Tool call:Read room state",
        "Reasoning:next step",
      ]);
    });

    allowCompletion?.();
    await waitFor(() => {
      const snapshot = runtime.getSnapshot();
      const roomId = snapshot.selection.roomId!;
      const lead = snapshot.rooms[roomId].memberIds
        .map((memberId) => snapshot.members[memberId])
        .find((member) => member.handle === "lead")!;
      const leadTask = Object.values(snapshot.tasks).find(
        (task) => task.roomId === roomId && task.memberId === lead.id,
      )!;

      expect(leadTask.status).toBe("completed");
    });
  });

  it("streams multi-member user messages until every mentioned task settles", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-multi-route-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await new Promise((resolve) =>
            setTimeout(resolve, member.handle === "research" ? 30 : 10),
          );
          await callbacks.onStatus(`${member.handle} running`);
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Multi Route",
      templateId: "template-product-pod",
    });

    const acceptedHandles: string[] = [];
    const completedHandles: string[] = [];
    await runtime.streamUserMessage(
      {
        roomId: created.roomId,
        content: "先让 @>research 补事实，再让 @>builder 搭骨架。",
      },
      {
        onTaskAccepted(route) {
          acceptedHandles.push(route.memberHandle);
        },
        onComplete(route) {
          completedHandles.push(route.memberHandle);
        },
      },
    );

    expect(acceptedHandles).toEqual(["research", "builder"]);
    expect(completedHandles.sort()).toEqual(["builder", "research"]);

    const snapshot = runtime.getSnapshot();
    const roomTasks = Object.values(snapshot.tasks).filter(
      (task) => task.roomId === created.roomId,
    );
    const routedTasks = roomTasks.filter((task) =>
      ["research", "builder"].includes(snapshot.members[task.memberId].handle),
    );
    const routedHandles = routedTasks
      .filter((task) =>
        ["research", "builder"].includes(
          snapshot.members[task.memberId].handle,
        ),
      )
      .map((task) => snapshot.members[task.memberId].handle)
      .sort();

    expect(routedHandles).toEqual(["builder", "research"]);
    expect(routedTasks.every((task) => task.status !== "running")).toBe(true);
  });

  it("waits for routed follow-up tasks before streamUserMessage resolves", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-stream-follow-up-route-"),
    );
    let runtime: WorkspaceRuntime;
    runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (request, callbacks) => {
          if (member.handle === "research") {
            await runtime.sendMemberMessage({
              roomId: request.room.id,
              memberId: member.id,
              taskId: request.task.id,
              content: "@>lead 我补完事实了，请你收口。",
            });
            await callbacks.onComplete("research done", "end_turn");
            return;
          }

          await new Promise((resolve) =>
            setTimeout(resolve, member.handle === "lead" ? 40 : 10),
          );
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Stream Follow-up Route",
      templateId: "template-product-pod",
    });

    await runtime.streamUserMessage(
      {
        roomId: created.roomId,
        content: "@>research 先补事实。",
      },
      {},
    );

    const snapshot = runtime.getSnapshot();
    const roomTasks = Object.values(snapshot.tasks).filter(
      (task) => task.roomId === created.roomId,
    );
    const leadTask = roomTasks.find(
      (task) => snapshot.members[task.memberId]?.handle === "lead",
    );

    expect(leadTask).toBeDefined();
    expect(roomTasks.every((task) => task.status !== "running")).toBe(true);
  });

  it("continues id allocation after restart instead of colliding with persisted state", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-ids-"),
    );
    const stateFilePath = path.join(
      workspaceRoot,
      ".openaquarium",
      "state.json",
    );
    const executorFactory: MemberExecutorFactory = ({ member }) =>
      new FakeExecutor(async (_request, callbacks) => {
        await callbacks.onComplete(`${member.handle} done`, "end_turn");
      });
    const firstRuntime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath: path.join(workspaceRoot, ".config"),
      executorFactory,
    });
    runtimes.push(firstRuntime);

    const first = await firstRuntime.createProject({
      projectName: "First",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const runningTasks = Object.values(
        firstRuntime.getSnapshot().tasks,
      ).filter((task) => task.status === "running");
      expect(runningTasks.length).toBe(0);
    });

    await firstRuntime.dispose();
    runtimes.pop();

    const secondRuntime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath: path.join(workspaceRoot, ".config"),
      executorFactory,
    });
    runtimes.push(secondRuntime);

    const second = await secondRuntime.createProject({
      projectName: "Second",
      templateId: "template-product-pod",
    });

    await waitFor(() => {
      const runningTasks = Object.values(
        secondRuntime.getSnapshot().tasks,
      ).filter((task) => task.status === "running");
      expect(runningTasks.length).toBe(0);
    });

    expect(second.projectId).not.toBe(first.projectId);
    expect(second.roomId).not.toBe(first.roomId);
  });

  it("expires stale running tasks on startup instead of dispatching them again", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-stale-"),
    );
    const stateFilePath = path.join(
      workspaceRoot,
      ".openaquarium",
      "state.json",
    );
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
      configDirPath: path.join(workspaceRoot, ".config"),
      executorFactory: () =>
        new FakeExecutor(() => {
          executeCount += 1;
          return Promise.resolve();
        }),
    });
    runtimes.push(runtime);

    const snapshot = runtime.getSnapshot();
    const runningTasks = Object.values(snapshot.tasks).filter(
      (task) => task.status === "running",
    );
    const staleTask = Object.values(snapshot.tasks).find(
      (task) => task.roomId === staleRoomId && task.memberId === staleLead.id,
    );

    expect(runningTasks).toHaveLength(0);
    expect(executeCount).toBe(0);
    expect(staleTask?.status).toBe("completed");
    expect(
      (snapshot.taskTraceOrderByTask[staleTask!.id] ?? []).some(
        (traceId) => snapshot.taskTraces[traceId]?.kind === "error",
      ),
    ).toBe(true);
  });

  it("does not defer watcher runs while another member in the room is busy", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-watcher-backoff-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
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
    let snapshot = runtime.getSnapshot();
    const scribe = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");

    expect(scribe).toBeDefined();
    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    await runtime.sendUserMessage({
      roomId,
      content: "先让 lead 挂起一会儿",
    });
    snapshot = runtime.getSnapshot();
    const watcherId = snapshot.rooms[roomId]?.watcherIds.find(
      (candidate) => snapshot.watchers[candidate]?.memberId === scribe.id,
    );

    expect(watcherId).toBeDefined();
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.runWatcherNow(watcherId);

    snapshot = runtime.getSnapshot();
    const digestMessages = (snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => snapshot.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(digestMessages).toHaveLength(0);
    expect(snapshot.watchers[watcherId]?.lastConsumedMessageId).toBeDefined();
  });

  it("keeps unseen watcher messages in the next visible prompt after a pre-prompt failure", async () => {
    vi.useFakeTimers();
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-watcher-visible-prompt-"),
    );
    const promptsSeenByScribe: string[] = [];
    let firstWatcherAttempt = true;
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      globalConfigManager: new OpenAquariumGlobalConfigManager(
        path.join(workspaceRoot, ".config"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) => ({
        execute: async (request, callbacks) => {
          if (member.handle !== "scribe" || request.task.title !== "Review watcher digest") {
            await callbacks.onPromptVisible?.();
            await callbacks.onComplete(`${member.handle} done`, "end_turn");
            return;
          }

          if (firstWatcherAttempt) {
            firstWatcherAttempt = false;
            await callbacks.onError("Authentication required");
            return;
          }

          promptsSeenByScribe.push(request.prompt);
          await callbacks.onPromptVisible?.();
          await callbacks.onComplete("scribe done", "end_turn");
        },
        cancel: () => Promise.resolve(),
        dispose: () => Promise.resolve(),
      }),
    });
    runtimes.push(runtime);

    const { roomId } = await runtime.createProject({
      projectName: "Watcher Prompt Visibility",
      templateId: "template-product-pod",
    });
    await waitForRoomIdle(runtime, roomId);

    let snapshot = runtime.getSnapshot();
    const scribe = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");
    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    const watcherId = snapshot.rooms[roomId].watcherIds.find(
      (candidate) => snapshot.watchers[candidate]?.memberId === scribe.id,
    );
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.sendUserMessage({
      roomId,
      content: "watcher 基线消息",
    });
    await waitForRoomIdle(runtime, roomId);

    await runtime.runWatcherNow(watcherId);
    await waitForRoomIdle(runtime, roomId);

    await runtime.sendUserMessage({
      roomId,
      content: "第一条 watcher 未见消息",
    });
    await waitForRoomIdle(runtime, roomId);

    await runtime.runWatcherNow(watcherId);
    await waitForRoomIdle(runtime, roomId);

    snapshot = runtime.getSnapshot();
    const failedPromptTraces = Object.values(snapshot.taskTraces).filter(
      (trace) => trace.roomId === roomId && trace.memberId === scribe.id && trace.kind === "task-prompt",
    );
    expect(failedPromptTraces).toHaveLength(0);

    await runtime.sendUserMessage({
      roomId,
      content: "第二条 watcher 新消息",
    });
    await waitForRoomIdle(runtime, roomId);

    await runtime.runWatcherNow(watcherId);
    await waitForRoomIdle(runtime, roomId);

    expect(promptsSeenByScribe).toHaveLength(1);
    expect(promptsSeenByScribe[0]).toContain("第一条 watcher 未见消息");
    expect(promptsSeenByScribe[0]).toContain("第二条 watcher 新消息");
  });

  it("runs a deferred watcher as soon as the watched member becomes idle", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-watcher-catch-up-"),
    );
    let holdScribe = false;
    let releaseScribe: (() => void) | undefined;
    const scribeReleasePromise = new Promise<void>((resolve) => {
      releaseScribe = resolve;
    });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "scribe" && holdScribe) {
            await scribeReleasePromise;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const { roomId } = await runtime.createProject({
      projectName: "Watcher Catch Up",
      templateId: "template-product-pod",
    });

    let snapshot = runtime.getSnapshot();
    const scribe = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");
    expect(scribe).toBeDefined();
    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    await runtime.upsertWatcher({
      memberId: scribe.id,
      enabled: true,
      intervalMinutes: 1,
    });

    await runtime.sendUserMessage({
      roomId,
      content: "先建立 watcher 基线",
    });
    await waitFor(() => {
      const current = runtime.getSnapshot();
      expect(
        Object.values(current.tasks).some(
          (task) => task.roomId === roomId && task.status === "running",
        ),
      ).toBe(false);
    });

    snapshot = runtime.getSnapshot();
    const watcherId = snapshot.rooms[roomId].watcherIds.find(
      (candidate) => snapshot.watchers[candidate]?.memberId === scribe.id,
    );
    expect(watcherId).toBeDefined();
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.runWatcherNow(watcherId);

    holdScribe = true;
    await runtime.sendUserMessage({
      roomId,
      directMemberId: scribe.id,
      content: "先让 scribe 忙起来",
    });
    await flushMicrotasks();

    await runtime.sendUserMessage({
      roomId,
      content: "这条消息需要在 busy 结束后被 watcher 补抓到",
    });
    await flushMicrotasks();

    await runtime.runWatcherNow(watcherId);
    await flushMicrotasks(10);

    snapshot = runtime.getSnapshot();
    expect(
      Object.values(snapshot.messages).filter(
        (message) =>
          message.roomId === roomId && message.transport === "watch-digest",
      ),
    ).toHaveLength(0);

    holdScribe = false;
    releaseScribe?.();
    await waitFor(() => {
      snapshot = runtime.getSnapshot();
      const digestMessages = Object.values(snapshot.messages).filter(
        (message) =>
          message.roomId === roomId && message.transport === "watch-digest",
      );
      expect(digestMessages).toHaveLength(1);
      expect(digestMessages[0]?.content).toContain(
        "这条消息需要在 busy 结束后被 watcher 补抓到",
      );
    });
  });

  it("keeps room-level watcher suspension separate from the watcher state and resumes pending work after reopening", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-room-watcher-suspension-"),
    );
    let holdScribe = false;
    let releaseScribe: (() => void) | undefined;
    const scribeReleasePromise = new Promise<void>((resolve) => {
      releaseScribe = resolve;
    });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          if (member.handle === "scribe" && holdScribe) {
            await scribeReleasePromise;
          }

          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const { roomId } = await runtime.createProject({
      projectName: "Room Watcher Suspension",
      templateId: "template-product-pod",
    });

    let snapshot = runtime.getSnapshot();
    const scribe = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");
    expect(scribe).toBeDefined();
    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    await runtime.sendUserMessage({
      roomId,
      content: "先建立 watcher 基线",
    });
    await waitFor(() => {
      const current = runtime.getSnapshot();
      expect(
        Object.values(current.tasks).some(
          (task) => task.roomId === roomId && task.status === "running",
        ),
      ).toBe(false);
    });

    const watcherId = runtime.getSnapshot().rooms[roomId].watcherIds.find(
      (candidate) => runtime.getSnapshot().watchers[candidate]?.memberId === scribe.id,
    );
    expect(watcherId).toBeDefined();
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.runWatcherNow(watcherId);

    holdScribe = true;
    await runtime.sendUserMessage({
      roomId,
      directMemberId: scribe.id,
      content: "先让 scribe 忙起来",
    });
    await flushMicrotasks();

    await runtime.sendUserMessage({
      roomId,
      content: "这条消息应该在 room watcher 恢复后再被处理",
    });
    await flushMicrotasks();

    const busyRun = await runtime.runWatcherNow(watcherId);
    expect(busyRun.outcome).toBe("busy");

    await runtime.toggleRoomWatcherSuspension(roomId);
    snapshot = runtime.getSnapshot();
    expect(snapshot.rooms[roomId].watchersSuspended).toBe(true);
    expect(snapshot.watchers[watcherId].enabled).toBe(true);

    holdScribe = false;
    releaseScribe?.();
    await waitFor(() => {
      const current = runtime.getSnapshot();
      expect(
        Object.values(current.tasks).some(
          (task) => task.roomId === roomId && task.status === "running",
        ),
      ).toBe(false);
    });

    snapshot = runtime.getSnapshot();
    expect(
      Object.values(snapshot.messages).filter(
        (message) => message.roomId === roomId && message.transport === "watch-digest",
      ),
    ).toHaveLength(0);

    const suspendedRun = await runtime.runWatcherNow(watcherId);
    expect(suspendedRun.outcome).toBe("suspended");

    await runtime.toggleRoomWatcherSuspension(roomId);
    await waitFor(() => {
      const current = runtime.getSnapshot();
      const digestMessages = Object.values(current.messages).filter(
        (message) => message.roomId === roomId && message.transport === "watch-digest",
      );
      expect(current.rooms[roomId].watchersSuspended).toBe(false);
      expect(digestMessages).toHaveLength(1);
      expect(digestMessages[0]?.content).toContain(
        "这条消息应该在 room watcher 恢复后再被处理",
      );
    });
  });

  it("reschedules watcher timers when the interval changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-13T01:00:00.000Z"));

    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-watcher-interval-refresh-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      globalConfigManager: new OpenAquariumGlobalConfigManager(
        path.join(workspaceRoot, ".config"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const { roomId } = await runtime.createProject({
      projectName: "Watcher Interval Refresh",
      templateId: "template-product-pod",
    });

    let snapshot = runtime.getSnapshot();
    const scribe = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "scribe");
    expect(scribe).toBeDefined();
    if (!scribe) {
      throw new Error("Expected scribe member");
    }

    await runtime.sendUserMessage({
      roomId,
      content: "先建立 watcher 基线",
    });
    await waitForRoomIdle(runtime, roomId);

    await runtime.upsertWatcher({
      memberId: scribe.id,
      enabled: true,
      intervalMinutes: 1,
    });

    snapshot = runtime.getSnapshot();
    const watcherId = snapshot.rooms[roomId].watcherIds.find(
      (candidate) => snapshot.watchers[candidate]?.memberId === scribe.id,
    );
    expect(watcherId).toBeDefined();
    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    await runtime.runWatcherNow(watcherId);
    await runtime.sendUserMessage({
      roomId,
      content: "interval 改完后应在 1 分钟触发 digest",
    });
    await waitForRoomIdle(runtime, roomId);

    await vi.advanceTimersByTimeAsync(59 * 1000);
    await flushMicrotasks();

    snapshot = runtime.getSnapshot();
    expect(
      Object.values(snapshot.messages).filter(
        (message) =>
          message.roomId === roomId && message.transport === "watch-digest",
      ),
    ).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    let digestMessages = Object.values(runtime.getSnapshot().messages).filter(
      (message) =>
        message.roomId === roomId && message.transport === "watch-digest",
    );
    for (
      let attempt = 0;
      attempt < 20 && digestMessages.length === 0;
      attempt += 1
    ) {
      await vi.advanceTimersByTimeAsync(20);
      await flushMicrotasks(10);
      snapshot = runtime.getSnapshot();
      digestMessages = Object.values(snapshot.messages).filter(
        (message) =>
          message.roomId === roomId && message.transport === "watch-digest",
      );
    }

    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0]?.content).toContain(
      "interval 改完后应在 1 分钟触发 digest",
    );
  });

  it("reloads templates from the global config directory after template studio chat writes them", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-template-chat-"),
    );
    const configDirPath = path.join(workspaceRoot, ".config");
    const globalConfigManager = new OpenAquariumGlobalConfigManager(
      configDirPath,
    );
    const loaded = await globalConfigManager.load();
    const templateStudioChatService = {
      chat: ({
        templates,
        templateId,
      }: {
        templates: typeof loaded.templates;
        templateId: string;
      }) => {
        const nextTemplates = templates.map((template) =>
          template.id === templateId
            ? {
                ...template,
                description: "Updated from template studio chat",
              }
            : template,
        );

        return globalConfigManager.saveTemplates(nextTemplates).then(() => ({
          assistantMessage: "Updated template description.",
          modelProfileId:
            loaded.config.templateChatModelProfileId ??
            loaded.config.modelProfiles[0]?.id ??
            "model-codex-acp-default",
        }));
      },
      getModelCatalog: () =>
        Promise.resolve({
          source: "runtime" as const,
          providerType: "acp" as const,
          providerKind: loaded.config.modelProfiles[0]?.binding.kind ?? "codex-acp",
          providerLabel: loaded.config.modelProfiles[0]?.binding.label ?? "Codex",
          selectedProfileId:
            loaded.config.templateChatModelProfileId ??
            loaded.config.modelProfiles[0]?.id ??
            "model-codex-acp-default",
          availableModels: [],
        }),
      getModelCatalogForProfile: ({ profile }: {
        profile: {
          id: string;
          providerType: "acp" | "openai-compatible";
          binding: {
            kind: "codex-acp" | "generic-acp" | "openai-compatible";
            label: string;
          };
        };
      }) =>
        Promise.resolve({
          source: "runtime" as const,
          providerType: profile.providerType,
          providerKind: profile.binding.kind,
          providerLabel: profile.binding.label,
          selectedProfileId: profile.id,
          availableModels: [],
        }),
      testProfile: ({ modelId, profile, prompt }: {
        modelId?: string;
        profile: {
          id: string;
          providerType: "acp" | "openai-compatible";
          binding: {
            kind: "codex-acp" | "generic-acp" | "openai-compatible";
            label: string;
          };
        };
        prompt: string;
      }) =>
        Promise.resolve({
          profileId: profile.id,
          providerType: profile.providerType,
          providerKind: profile.binding.kind,
          providerLabel: profile.binding.label,
          modelId,
          prompt,
          responseText: "Provider test ok.",
          toolCount: 0,
          testedAt: "2026-03-20T00:00:00.000Z",
        }),
      stream: ({
        templates,
        templateId,
      }: {
        templates: typeof loaded.templates;
        templateId: string;
      }) => {
        const nextTemplates = templates.map((template) =>
          template.id === templateId
            ? {
                ...template,
                description: "Updated from template studio chat",
              }
            : template,
        );

        return globalConfigManager.saveTemplates(nextTemplates).then(() => ({
          modelProfileId:
            loaded.config.templateChatModelProfileId ??
            loaded.config.modelProfiles[0]?.id ??
            "model-codex-acp-default",
          result: {
            consumeStream: () => Promise.resolve(),
            toUIMessageStream: () => new ReadableStream(),
          },
          cleanup: () => Promise.resolve(),
        }));
      },
      dispose: () => Promise.resolve(),
    };
    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath: path.join(workspaceRoot, ".openaquarium", "state.json"),
      configDirPath,
      templateStudioChatService,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    const templateId = runtime.getSnapshot().templateOrder[0];
    expect(templateId).toBeDefined();
    if (!templateId) {
      throw new Error("Expected template id");
    }

    const result = await runtime.chatTemplateStudio({
      templateId,
      messages: [{ role: "user", content: "Update the template description." }],
    });

    expect(result.assistantMessage).toBe("Updated template description.");
    expect(runtime.getSnapshot().templates[templateId]?.description).toBe(
      "Updated from template studio chat",
    );
  });

  it("deletes a team template without breaking existing room-local team data", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-template-delete-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      globalConfigManager: new OpenAquariumGlobalConfigManager(
        path.join(workspaceRoot, ".config"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    await runtime.createProject({
      projectName: "Template Delete Guard",
      templateId: "template-product-pod",
    });

    const projectRoomId = runtime.getSnapshot().selection.roomId!;
    const beforeDeleteRoom = runtime.getSnapshot().rooms[projectRoomId];
    expect(beforeDeleteRoom.teamName).toBe("Product Pod");

    const deletedProductTemplateSnapshot = await runtime.deleteTemplate(
      "template-product-pod",
    );
    expect(
      deletedProductTemplateSnapshot.templates["template-product-pod"],
    ).toBeUndefined();
    expect(deletedProductTemplateSnapshot.rooms[projectRoomId]?.teamName).toBe(
      "Product Pod",
    );
    expect(
      deletedProductTemplateSnapshot.rooms[projectRoomId]?.memberIds.length,
    ).toBeGreaterThan(0);

    await expect(
      runtime.deleteTemplate("template-incident-pod"),
    ).rejects.toThrow("At least one team template must remain.");
  });

  it("updates a room-local team without mutating the source template", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-room-team-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: ({ member }) =>
        new FakeExecutor(async (_request, callbacks) => {
          await callbacks.onComplete(`${member.handle} done`, "end_turn");
        }),
    });
    runtimes.push(runtime);

    await runtime.createProject({
      projectName: "Room Team Runtime",
      templateId: "template-product-pod",
    });

    const before = runtime.getSnapshot();
    const roomId = before.selection.roomId!;
    const room = before.rooms[roomId];
    const roomMembers = room.memberIds.map(
      (memberId) => before.members[memberId],
    );
    const lead = roomMembers.find((member) => member.handle === "lead");
    const builder = roomMembers.find((member) => member.handle === "builder");
    const research = roomMembers.find((member) => member.handle === "research");

    if (!lead || !builder || !research) {
      throw new Error("Expected lead, builder, and research members");
    }

    const snapshot = await runtime.updateRoomTeam({
      roomId,
      teamName: "Runtime Room Team",
      teamDescription: "room local only",
      teamAccentTone: "blueprint",
      members: [
        {
          memberId: lead.id,
          name: lead.name,
          handle: lead.handle,
          summary: lead.summary,
          prompt: lead.prompt,
          accentTone: lead.accentTone,
          modelProfileId: lead.modelProfileId,
          allowedSkillIds: lead.allowedSkillIds,
          provider: lead.provider,
          isEntryMember: true,
          acceptsDirectMessages: lead.acceptsDirectMessages,
        },
        {
          memberId: builder.id,
          name: builder.name,
          handle: builder.handle,
          summary: "Runtime-local builder",
          prompt: builder.prompt,
          accentTone: builder.accentTone,
          modelProfileId: builder.modelProfileId,
          allowedSkillIds: builder.allowedSkillIds,
          provider: builder.provider,
          acceptsDirectMessages: builder.acceptsDirectMessages,
          watch: {
            enabled: true,
            intervalMinutes: 11,
          },
        },
        {
          memberId: "qa-temp",
          name: "Signal Heron",
          handle: "qa",
          summary: "runtime QA",
          prompt: "check runtime regressions",
          accentTone: "paper",
          modelProfileId: builder.modelProfileId,
          allowedSkillIds: builder.allowedSkillIds,
          provider: builder.provider,
          acceptsDirectMessages: true,
        },
      ],
    });

    expect(snapshot.rooms[roomId]?.teamName).toBe("Runtime Room Team");
    expect(snapshot.templates["template-product-pod"]?.name).toBe(
      "Product Pod",
    );
    expect(snapshot.members[research.id]?.archivedAt).toBeDefined();
    expect(
      snapshot.rooms[roomId]?.memberIds.some(
        (memberId) => snapshot.members[memberId]?.handle === "qa",
      ),
    ).toBe(true);
    expect(
      snapshot.rooms[roomId]?.watcherIds.some(
        (watcherId) => snapshot.watchers[watcherId]?.memberId === builder.id,
      ),
    ).toBe(true);
  });

  it("persists saved default templates across restart and makes them available in new workspaces", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-default-template-persist-"),
    );
    const stateFilePath = path.join(
      workspaceRoot,
      ".openaquarium",
      "state.json",
    );
    const configDirPath = path.join(workspaceRoot, ".config");
    const executorFactory: MemberExecutorFactory = ({ member }) =>
      new FakeExecutor(async (_request, callbacks) => {
        await callbacks.onComplete(`${member.handle} done`, "end_turn");
      });

    const firstRuntime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath,
      executorFactory,
    });
    runtimes.push(firstRuntime);

    const templateId = "template-product-pod";
    const originalTemplate = firstRuntime.getSnapshot().templates[templateId];
    if (!originalTemplate) {
      throw new Error("Expected product pod template");
    }

    const updatedTemplateName = "Product Pod Default Persisted";
    const updatedTemplateDescription = "Persists across restart and seeds new rooms.";
    const updatedBuilderSummary = "Builds the shipped implementation after restart.";

    await firstRuntime.updateTemplate({
      templateId,
      name: updatedTemplateName,
      description: updatedTemplateDescription,
      accentTone: originalTemplate.accentTone,
      defaultVisibleMemberBlueprintIds:
        originalTemplate.defaultVisibleMemberBlueprintIds ?? originalTemplate.members.map((member) => member.id),
      members: originalTemplate.members.map((member) =>
        member.handle === "builder"
          ? {
              ...member,
              summary: updatedBuilderSummary,
            }
          : member),
    });

    const persistedTemplates = JSON.parse(
      await readFile(path.join(configDirPath, "templates.json"), "utf8"),
    ) as Array<{ id: string; name: string; description: string; members: Array<{ handle: string; summary: string }> }>;
    expect(
      persistedTemplates.find((template) => template.id === templateId)?.name,
    ).toBe(updatedTemplateName);

    await firstRuntime.dispose();
    runtimes.pop();

    const secondRuntime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath,
      configDirPath,
      executorFactory,
    });
    runtimes.push(secondRuntime);

    expect(secondRuntime.getSnapshot().templates[templateId]?.name).toBe(
      updatedTemplateName,
    );

    const created = await secondRuntime.createProject({
      projectName: "Persisted Template Project",
      templateId,
    });
    const snapshot = secondRuntime.getSnapshot();
    const room = snapshot.rooms[created.roomId];
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");

    expect(room.teamName).toBe(updatedTemplateName);
    expect(room.teamDescription).toBe(updatedTemplateDescription);
    expect(builder?.summary).toBe(updatedBuilderSummary);

    const newWorkspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-default-template-new-workspace-"),
    );
    const thirdRuntime = await WorkspaceRuntime.create({
      workspaceRoot: newWorkspaceRoot,
      stateFilePath: path.join(newWorkspaceRoot, ".openaquarium", "state.json"),
      configDirPath,
      executorFactory,
    });
    runtimes.push(thirdRuntime);

    expect(thirdRuntime.getSnapshot().templates[templateId]?.name).toBe(
      updatedTemplateName,
    );

    const thirdCreated = await thirdRuntime.createProject({
      projectName: "Fresh Workspace Project",
      templateId,
    });
    const thirdSnapshot = thirdRuntime.getSnapshot();
    const thirdRoom = thirdSnapshot.rooms[thirdCreated.roomId];
    const thirdBuilder = thirdRoom.memberIds
      .map((memberId) => thirdSnapshot.members[memberId])
      .find((member) => member.handle === "builder");

    expect(thirdRoom.teamName).toBe(updatedTemplateName);
    expect(thirdRoom.teamDescription).toBe(updatedTemplateDescription);
    expect(thirdBuilder?.summary).toBe(updatedBuilderSummary);
  });
});
