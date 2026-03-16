import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCodexAcpProvider, createGenericAcpProvider } from "@/lib/acp";

const initSessionMock = vi.fn();
const setModeMock = vi.fn();
const cleanupMock = vi.fn();
const getSessionIdMock = vi.fn(() => "session_1");
const languageModelMock = vi.fn(() => ({ provider: "mock" }));
const streamTextMock = vi.fn();
const createACPProviderMock = vi.fn();

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME: "acp-agent-tool",
  acpTools: (tools: object) => tools,
  createACPProvider: createACPProviderMock.mockImplementation(() => ({
    initSession: initSessionMock,
    setMode: setModeMock,
    cleanup: cleanupMock,
    getSessionId: getSessionIdMock,
    languageModel: languageModelMock,
  })),
}));

vi.mock("ai", () => ({
  streamText: streamTextMock,
  tool: (definition: object) => definition,
}));

import { AcpMemberExecutor } from "@/server/acp-executor";
import type { DiagnosticsLogger } from "@/server/diagnostics";
import type { ExecutionRequest } from "@/server/executor";
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

describe("AcpMemberExecutor", () => {
  beforeEach(() => {
    vi.useRealTimers();
    createACPProviderMock.mockClear();
    initSessionMock.mockReset();
    initSessionMock.mockResolvedValue({
      sessionId: "session_1",
      modes: {
        currentModeId: "read-only",
        availableModes: [{ id: "read-only", name: "Read Only" }, { id: "full-access", name: "Full Access" }],
      },
    });
    setModeMock.mockReset();
    setModeMock.mockResolvedValue(undefined);
    cleanupMock.mockReset();
    getSessionIdMock.mockReset();
    getSessionIdMock.mockReturnValue("session_1");
    languageModelMock.mockClear();
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
    expect(setModeMock).toHaveBeenCalledWith("full-access");
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

  it("reuses the same codex session across turns", async () => {
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

  it("resets a stale persisted codex session and retries once", async () => {
    initSessionMock
      .mockRejectedValueOnce(new Error("Resource not found"))
      .mockResolvedValue({
        sessionId: "session_2",
        modes: {
          currentModeId: "read-only",
          availableModes: [{ id: "read-only", name: "Read Only" }, { id: "full-access", name: "Full Access" }],
        },
      });
    getSessionIdMock.mockReturnValue("session_2");

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
