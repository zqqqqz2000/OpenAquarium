import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCodexAcpProvider, createGenericAcpProvider } from "@/lib/acp";

interface MockSessionMode {
  id: string;
  name: string;
}

interface MockSessionResponse {
  sessionId: string;
  modes?: {
    currentModeId?: string;
    availableModes?: MockSessionMode[];
  };
  models?: {
    currentModelId?: string;
  };
}

interface MockAcpModel {
  provider: "mock";
  connection:
    | {
        cancel?: (params: { sessionId: string }) => Promise<void>;
        unstable_forkSession?: (params: { sessionId: string; cwd: string }) => Promise<MockSessionResponse>;
      }
    | null;
  sessionId: string | null;
  sessionResponse: MockSessionResponse | null;
  isFreshSession: boolean;
  currentModeId: string | null;
  currentModelId: string | null;
  modelId?: string;
  modeId?: string;
}

interface MockProviderRecord {
  config: {
    existingSessionId?: string;
    session?: {
      cwd?: string;
    };
  };
  model: MockAcpModel;
}

const AVAILABLE_MODES: MockSessionMode[] = [
  { id: "read-only", name: "Read Only" },
  { id: "full-access", name: "Full Access" },
];

function createMockSessionResponse(sessionId: string, currentModeId = "read-only"): MockSessionResponse {
  return {
    sessionId,
    modes: {
      currentModeId,
      availableModes: AVAILABLE_MODES,
    },
  };
}

const {
  initSessionMock,
  cancelSessionMock,
  setModeMock,
  cleanupMock,
  languageModelMock,
  streamTextMock,
  createACPProviderMock,
  providerRecords,
} = vi.hoisted(() => ({
  initSessionMock: vi.fn(),
  cancelSessionMock: vi.fn(),
  setModeMock: vi.fn(),
  cleanupMock: vi.fn(),
  languageModelMock: vi.fn(),
  streamTextMock: vi.fn(),
  createACPProviderMock: vi.fn(),
  providerRecords: [] as MockProviderRecord[],
}));

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME: "acp-agent-tool",
  acpTools: (tools: object) => tools,
  createACPProvider: createACPProviderMock.mockImplementation((config: MockProviderRecord["config"]) => {
    const model: MockAcpModel = {
      provider: "mock",
      connection: {
        cancel: (params) => cancelSessionMock(params, { config, model }),
      },
      sessionId: config.existingSessionId ?? null,
      sessionResponse: config.existingSessionId ? createMockSessionResponse(config.existingSessionId) : null,
      isFreshSession: !config.existingSessionId,
      currentModeId: config.existingSessionId ? "read-only" : null,
      currentModelId: null,
    };
    const provider = {
      model,
      initSession: async (tools?: object) => {
        const response = await initSessionMock({ config, model, tools });
        model.sessionId = response.sessionId;
        model.sessionResponse = response;
        model.isFreshSession = !config.existingSessionId;
        model.currentModeId = response.modes?.currentModeId ?? model.currentModeId;
        model.currentModelId = response.models?.currentModelId ?? model.currentModelId;
        return response;
      },
      setMode: async (modeId: string) => {
        await setModeMock(modeId, { config, model });
        model.currentModeId = modeId;
        if (model.sessionResponse?.modes) {
          model.sessionResponse.modes.currentModeId = modeId;
        }
      },
      cleanup: () => {
        cleanupMock({ config, model });
        model.connection = null;
        model.sessionId = null;
        model.sessionResponse = null;
      },
      getSessionId: () => model.sessionId,
      languageModel: (modelId?: string, modeId?: string) => {
        languageModelMock(modelId, modeId, { config, model });
        if (modelId) {
          model.modelId = modelId;
        }
        if (modeId) {
          model.modeId = modeId;
        }
        return model;
      },
    };
    providerRecords.push({ config, model });
    return provider;
  }),
}));

vi.mock("ai", () => ({
  streamText: streamTextMock,
  tool: (definition: object) => definition,
}));

import { AcpMemberExecutor } from "@/server/acp-executor";
import type { DiagnosticsLogger } from "@/server/diagnostics";
import type { ExecutionPreparationRequest, ExecutionRequest } from "@/server/executor";
import type { MemberToolHost } from "@/server/acp-executor";

function createRequest(provider = createCodexAcpProvider()): ExecutionRequest {
  return {
    project: {
      id: "project_1",
      name: "Project",
      createdAt: "2026-03-10T12:00:00.000Z",
    },
    room: {
      id: "room_1",
      projectId: "project_1",
      name: "Room",
      topic: "Topic",
      templateId: "template_1",
      memberIds: ["member_1"],
      watcherIds: [],
      entryMemberId: "member_1",
      createdAt: "2026-03-10T12:00:00.000Z",
    },
    member: {
      id: "member_1",
      roomId: "room_1",
      blueprintId: "blueprint_1",
      roleId: "blueprint_1",
      roleName: "lead",
      name: "Lead",
      handle: "lead",
      summary: "Lead member",
      prompt: "Handle the room",
      accentTone: "paper",
      allowedSkillIds: [],
      provider,
      acceptsDirectMessages: true,
      isEntryMember: true,
      status: "idle",
    },
    task: {
      id: "task_1",
      roomId: "room_1",
      memberId: "member_1",
      sourceMessageId: "message_1",
      title: "Respond",
      status: "running",
      startedAt: "2026-03-10T12:00:00.000Z",
      updatedAt: "2026-03-10T12:00:00.000Z",
    },
    snapshot: {
      projects: {},
      projectOrder: [],
      rooms: {},
      roomOrderByProject: {},
      templates: {},
      templateOrder: [],
      members: {},
      messages: {},
      messageOrderByRoom: {},
      tasks: {},
      taskTraces: {},
      taskTraceOrderByTask: {},
      watchers: {},
      selection: {},
      currentUserName: "You",
    },
    prompt: "Reply to the user",
  };
}

function createHost(overrides: Partial<MemberToolHost> = {}): MemberToolHost {
  return {
    sendGroupMessage: () => Promise.resolve(),
    sendDirectMessage: () => Promise.resolve(),
    addRoleEmployee: () => Promise.resolve({ ok: true, notices: ["ok"] }),
    removeRoleEmployee: () => Promise.resolve({ ok: true, notices: ["ok"] }),
    renameRoleEmployee: () => Promise.resolve({ ok: true, notices: ["ok"] }),
    runWatcher: () => Promise.resolve(),
    inspectRoomState: () => Promise.resolve("state"),
    ...overrides,
  };
}

function toPreparationRequest(request: ExecutionRequest): ExecutionPreparationRequest {
  return {
    project: request.project,
    room: request.room,
    member: request.member,
    task: request.task,
    snapshot: request.snapshot,
  };
}

describe("AcpMemberExecutor", () => {
  beforeEach(() => {
    vi.useRealTimers();
    createACPProviderMock.mockClear();
    providerRecords.length = 0;
    initSessionMock.mockReset();
    initSessionMock.mockImplementation(async ({ config }: { config: MockProviderRecord["config"] }) =>
      createMockSessionResponse(config.existingSessionId ?? "session_1"),
    );
    cancelSessionMock.mockReset();
    cancelSessionMock.mockResolvedValue(undefined);
    setModeMock.mockReset();
    setModeMock.mockResolvedValue(undefined);
    cleanupMock.mockReset();
    languageModelMock.mockReset();
    languageModelMock.mockImplementation(() => undefined);
    streamTextMock.mockReset();
    streamTextMock.mockReturnValue({
      text: Promise.resolve("done"),
      finishReason: Promise.resolve("stop"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("switches codex sessions to full-access before streaming", async () => {
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: createRequest().member,
      host: createHost(),
    });

    await executor.execute(createRequest(), {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    expect(initSessionMock).toHaveBeenCalledTimes(1);
    expect(setModeMock).toHaveBeenCalledWith("full-access", expect.anything());
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("exposes structured role staffing tools and routes them through the host", async () => {
    const request = createRequest();
    const addRoleEmployee: MemberToolHost["addRoleEmployee"] = vi.fn(() =>
      Promise.resolve({ ok: true, notices: ["added"] }),
    );
    const removeRoleEmployee: MemberToolHost["removeRoleEmployee"] = vi.fn(() =>
      Promise.resolve({ ok: true, notices: ["removed"] }),
    );
    const renameRoleEmployee: MemberToolHost["renameRoleEmployee"] = vi.fn(() =>
      Promise.resolve({ ok: true, notices: ["renamed"] }),
    );
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost({
        addRoleEmployee,
        removeRoleEmployee,
        renameRoleEmployee,
      }),
    });

    await executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    const streamCall = streamTextMock.mock.calls[0]?.[0] as { tools: Record<string, { execute: (input: unknown) => Promise<string> }> } | undefined;
    expect(streamCall?.tools.oa_role_add_employee).toBeDefined();
    expect(streamCall?.tools.oa_role_remove_employee).toBeDefined();
    expect(streamCall?.tools.oa_role_rename_employee).toBeDefined();

    const addResult = await streamCall?.tools.oa_role_add_employee.execute({
      role: "@checker",
      employeeHandle: "checker-2",
      reason: "parallel acceptance",
    });
    const removeResult = await streamCall?.tools.oa_role_remove_employee.execute({
      role: "checker",
      employeeHandle: "@checker-2",
      reason: "done",
    });
    const renameResult = await streamCall?.tools.oa_role_rename_employee.execute({
      employeeHandle: "@checker-2",
      name: "Second Checker",
    });

    expect(addResult).toEqual({ ok: true, notices: ["added"] });
    expect(removeResult).toEqual({ ok: true, notices: ["removed"] });
    expect(renameResult).toEqual({ ok: true, notices: ["renamed"] });

    expect(addRoleEmployee).toHaveBeenCalledWith({
      roomId: "room_1",
      memberId: "member_1",
      role: "@checker",
      employeeHandle: "checker-2",
      reason: "parallel acceptance",
    });
    expect(removeRoleEmployee).toHaveBeenCalledWith({
      roomId: "room_1",
      memberId: "member_1",
      role: "checker",
      employeeHandle: "@checker-2",
      reason: "done",
    });
    expect(renameRoleEmployee).toHaveBeenCalledWith({
      roomId: "room_1",
      memberId: "member_1",
      employeeHandle: "@checker-2",
      name: "Second Checker",
    });
  });

  it("carries codex context across turns without resetting the provider", async () => {
    const request = createRequest();
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    await executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    await executor.execute(
      {
        ...request,
        task: {
          ...request.task,
          id: "task_2",
        },
      },
      {
        onDraft: () => Promise.resolve(),
        onStatus: () => Promise.resolve(),
        onComplete: () => Promise.resolve(),
        onError: () => Promise.resolve(),
      },
    );

    expect(initSessionMock).toHaveBeenCalledTimes(2);
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it("treats a provider-rotated codex session id as fresh and persists it after success", async () => {
    const persistMemberSession = vi.fn(() => Promise.resolve());
    const baseRequest = createRequest();
    const request = {
      ...baseRequest,
      member: {
        ...baseRequest.member,
        providerSessionId: "session_stable",
      },
    };
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost({
        persistMemberSession,
      }),
    });
    initSessionMock.mockResolvedValueOnce(createMockSessionResponse("session_rotated"));

    const preparation = await executor.prepareExecution(toPreparationRequest(request));

    expect(preparation).toEqual({ sessionContinuation: "fresh" });
    expect(persistMemberSession).not.toHaveBeenCalled();

    await executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    expect(persistMemberSession).toHaveBeenCalledWith({
      memberId: "member_1",
      sessionId: "session_rotated",
    });
  });

  it("drops an uncommitted rotated session after a visible failure and retries from the persisted session", async () => {
    const persistMemberSession = vi.fn(() => Promise.resolve());
    const baseRequest = createRequest();
    const request = {
      ...baseRequest,
      member: {
        ...baseRequest.member,
        providerSessionId: "session_stable",
      },
    };
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost({
        persistMemberSession,
      }),
    });
    const onError = vi.fn(() => Promise.resolve());

    initSessionMock
      .mockResolvedValueOnce(createMockSessionResponse("session_rotated"))
      .mockResolvedValueOnce(createMockSessionResponse("session_stable"));
    streamTextMock
      .mockReturnValueOnce({
        text: Promise.reject(new Error("stream exploded")),
        finishReason: Promise.resolve("error"),
      })
      .mockReturnValueOnce({
        text: Promise.resolve("done"),
        finishReason: Promise.resolve("stop"),
      });

    await executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError,
    });

    expect(onError).toHaveBeenCalledWith("stream exploded");
    expect(persistMemberSession).not.toHaveBeenCalled();

    const nextRequest: ExecutionRequest = {
      ...request,
      task: {
        ...request.task,
        id: "task_2",
        updatedAt: "2026-03-10T12:05:00.000Z",
      },
    };
    const preparation = await executor.prepareExecution(toPreparationRequest(nextRequest));
    expect(preparation).toEqual({ sessionContinuation: "resumed" });

    await executor.execute(nextRequest, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    expect(persistMemberSession).not.toHaveBeenCalled();
  });

  it("prepares the next turn as resumed after cancelling a visible turn", async () => {
    const persistMemberSession = vi.fn(() => Promise.resolve());
    let resolvePromptVisible: (() => void) | undefined;
    const promptVisible = new Promise<void>((resolve) => {
      resolvePromptVisible = resolve;
    });
    let releaseFirstTurn: (() => void) | undefined;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    streamTextMock
      .mockReturnValueOnce({
        text: new Promise<string>((resolve) => {
          void firstTurn.then(() => {
            resolve("first turn");
          });
        }),
        finishReason: new Promise<string>((resolve) => {
          void firstTurn.then(() => {
            resolve("stop");
          });
        }),
      })
      .mockReturnValueOnce({
        text: Promise.resolve("second turn"),
        finishReason: Promise.resolve("stop"),
      });
    initSessionMock.mockResolvedValue(createMockSessionResponse("session_fresh"));

    const request = createRequest();
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost({
        persistMemberSession,
      }),
    });

    const firstRun = executor.execute(request, {
      onPromptVisible: () => {
        resolvePromptVisible?.();
        return Promise.resolve();
      },
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });
    await promptVisible;

    const nextRequest: ExecutionRequest = {
      ...request,
      task: {
        ...request.task,
        id: "task_2",
      },
    };
    const preparationPromise = executor.prepareExecution(toPreparationRequest(nextRequest));
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseFirstTurn?.();
    const preparation = await preparationPromise;

    expect(preparation).toEqual({ sessionContinuation: "resumed" });

    const secondComplete = vi.fn(() => Promise.resolve());
    const secondRun = executor.execute(
      nextRequest,
      {
        onDraft: () => Promise.resolve(),
        onStatus: () => Promise.resolve(),
        onComplete: secondComplete,
        onError: () => Promise.resolve(),
      },
    );

    await secondRun;
    await firstRun;

    expect(cancelSessionMock).toHaveBeenCalledWith(
      { sessionId: "session_fresh" },
      expect.anything(),
    );
    expect(persistMemberSession).toHaveBeenCalledWith({
      memberId: "member_1",
      sessionId: "session_fresh",
    });
    expect(createACPProviderMock).toHaveBeenCalledTimes(1);
    expect(secondComplete).toHaveBeenCalledWith("second turn", "stop");
  });

  it("resets a stale persisted codex session and retries once", async () => {
    initSessionMock
      .mockRejectedValueOnce(new Error("Resource not found"))
      .mockResolvedValueOnce(createMockSessionResponse("session_2"));

    const persistMemberSession = vi.fn(() => Promise.resolve());
    const request = createRequest();
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: {
        ...request.member,
        providerSessionId: "session_stale",
      },
      host: {
        ...createHost(),
        persistMemberSession,
      },
    });

    await executor.execute(
      {
        ...request,
        member: {
          ...request.member,
          providerSessionId: "session_stale",
        },
      },
      {
        onDraft: () => Promise.resolve(),
        onStatus: () => Promise.resolve(),
        onComplete: () => Promise.resolve(),
        onError: () => Promise.resolve(),
      },
    );

    expect(initSessionMock).toHaveBeenCalledTimes(2);
    expect(cleanupMock).toHaveBeenCalledTimes(1);
    expect(createACPProviderMock).toHaveBeenCalledTimes(2);
    expect(persistMemberSession).toHaveBeenNthCalledWith(1, {
      memberId: "member_1",
      sessionId: undefined,
    });
    expect(persistMemberSession).toHaveBeenNthCalledWith(2, {
      memberId: "member_1",
      sessionId: "session_2",
    });
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("leaves generic ACP sessions unchanged", async () => {
    const provider = createGenericAcpProvider({
      label: "Claude Code",
      command: "claude-code",
      args: ["--stdio"],
      capabilities: ["prompt", "cancel"],
    });
    const request = createRequest(provider);
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    await executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    expect(initSessionMock).not.toHaveBeenCalled();
    expect(setModeMock).not.toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledTimes(1);
  });

  it("allows a turn to continue past five minutes without chunks", async () => {
    streamTextMock.mockReturnValue({
      text: new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("done");
        }, 30);
      }),
      finishReason: Promise.resolve("stop"),
    });

    const request = createRequest();
    const onError = vi.fn(() => Promise.resolve());
    const onComplete = vi.fn(() => Promise.resolve());
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    const runPromise = executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete,
      onError,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await runPromise;

    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith("done", "stop");
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it("keeps streaming updates working while a long turn is still in progress", async () => {
    streamTextMock.mockImplementation(({ onChunk }: { onChunk: (event: { chunk: { type: string; text: string } }) => Promise<void> }) => {
      setTimeout(() => {
        void onChunk({
          chunk: {
            type: "text-delta",
            text: "still working",
          },
        });
      }, 20);

      return {
        text: new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve("done");
          }, 40);
        }),
        finishReason: Promise.resolve("stop"),
      };
    });

    const request = createRequest();
    const onComplete = vi.fn(() => Promise.resolve());
    const onError = vi.fn(() => Promise.resolve());
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    const runPromise = executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete,
      onError,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    await Promise.resolve();
    expect(onError).not.toHaveBeenCalled();

    await new Promise((resolve) => setTimeout(resolve, 25));
    await runPromise;

    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith("done", "stop");
    expect(cleanupMock).not.toHaveBeenCalled();
  });

  it("lets a new turn continue after cancel times out on a stuck prior turn", async () => {
    let releaseStuckTurn: (() => void) | undefined;
    const stuckTurn = new Promise<void>((resolve) => {
      releaseStuckTurn = resolve;
    });
    streamTextMock
      .mockReturnValueOnce({
        text: new Promise<string>((resolve) => {
          void stuckTurn.then(() => {
            resolve("first turn");
          });
        }),
        finishReason: new Promise<string>((resolve) => {
          void stuckTurn.then(() => {
            resolve("stop");
          });
        }),
      })
      .mockReturnValueOnce({
        text: Promise.resolve("second turn"),
        finishReason: Promise.resolve("stop"),
      });

    const request = createRequest();
    const firstExecutor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    const firstRun = firstExecutor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });
    await Promise.resolve();

    const secondComplete = vi.fn(() => Promise.resolve());
    const secondRun = firstExecutor.execute(
      {
        ...request,
        task: {
          ...request.task,
          id: "task_2",
        },
      },
      {
        onDraft: () => Promise.resolve(),
        onStatus: () => Promise.resolve(),
        onComplete: secondComplete,
        onError: () => Promise.resolve(),
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 5_100));
    await secondRun;

    expect(secondComplete).toHaveBeenCalledWith("second turn", "stop");
    expect(cleanupMock).toHaveBeenCalledTimes(1);

    releaseStuckTurn?.();
    await firstRun;
  }, 8_000);

  it("starts ACP sessions inside the project path when one is configured", async () => {
    const projectPath = path.resolve(process.cwd(), "../agent-target");
    const request = createRequest();
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      project: {
        path: projectPath,
      },
      member: request.member,
      host: createHost(),
    });

    await executor.execute(
      {
        ...request,
        project: {
          ...request.project,
          path: projectPath,
        },
      },
      {
        onDraft: () => Promise.resolve(),
        onStatus: () => Promise.resolve(),
        onComplete: () => Promise.resolve(),
        onError: () => Promise.resolve(),
      },
    );

    expect(createACPProviderMock).toHaveBeenCalled();
    expect(createACPProviderMock.mock.calls[0]?.[0]).toMatchObject({
      session: {
        cwd: projectPath,
      },
    });
  });

  it("records full streaming details to diagnostics logs", async () => {
    const logger: DiagnosticsLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      shouldLog: vi.fn(() => true),
    };
    streamTextMock.mockImplementation(({ onChunk }: { onChunk: (event: { chunk: { type: string; text?: string; toolName?: string } }) => Promise<void> }) => {
      void onChunk({ chunk: { type: "text-delta", text: "transport warning" } });
      void onChunk({ chunk: { type: "tool-result", toolName: "oa_room_state" } });

      return {
        text: Promise.resolve("transport warning"),
        finishReason: Promise.resolve("stop"),
      };
    });

    const request = createRequest();
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      logger,
      host: createHost(),
    });

    await executor.execute(request, {
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    expect(logger.info).toHaveBeenCalledWith(
      "acp-stream-text-delta",
      expect.objectContaining({
        taskId: "task_1",
        deltaChars: "transport warning".length,
        accumulatedChars: "transport warning".length,
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      "acp-stream-finish",
      expect.objectContaining({
        taskId: "task_1",
        finishReason: "stop",
        finalText: "transport warning",
      }),
    );
  });
});
