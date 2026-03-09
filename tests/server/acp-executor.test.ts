import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCodexAcpProvider, createGenericAcpProvider } from "@/lib/acp";

const { cleanupMock, initSessionMock, languageModelMock, setModeMock, streamTextMock } = vi.hoisted(() => ({
  initSessionMock: vi.fn(),
  setModeMock: vi.fn(),
  cleanupMock: vi.fn(),
  languageModelMock: vi.fn(() => ({ provider: "mock" })),
  streamTextMock: vi.fn(),
}));

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME: "acp-agent-tool",
  acpTools: (tools: object) => tools,
  createACPProvider: vi.fn(() => ({
    initSession: initSessionMock,
    setMode: setModeMock,
    cleanup: cleanupMock,
    languageModel: languageModelMock,
  })),
}));

vi.mock("ai", () => ({
  streamText: streamTextMock,
  tool: (definition: object) => definition,
}));

import { AcpMemberExecutor } from "@/server/acp-executor";
import type { ExecutionRequest } from "@/server/executor";

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
      name: "Lead",
      handle: "lead",
      summary: "Lead member",
      prompt: "Handle the room",
      accentTone: "paper",
      skills: [],
      provider,
      observeAllRoomMessages: true,
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

describe("AcpMemberExecutor", () => {
  beforeEach(() => {
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
    languageModelMock.mockClear();
    streamTextMock.mockReset();
    streamTextMock.mockReturnValue({
      text: Promise.resolve("done"),
      finishReason: Promise.resolve("stop"),
    });
  });

  it("switches codex sessions to full-access before streaming", async () => {
    const executor = new AcpMemberExecutor({
      workspaceRoot: process.cwd(),
      member: createRequest().member,
      host: {
        sendGroupMessage: () => Promise.resolve(),
        sendDirectMessage: () => Promise.resolve(),
        runWatcher: () => Promise.resolve(),
        inspectRoomState: () => Promise.resolve("state"),
      },
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
      host: {
        sendGroupMessage: () => Promise.resolve(),
        sendDirectMessage: () => Promise.resolve(),
        runWatcher: () => Promise.resolve(),
        inspectRoomState: () => Promise.resolve("state"),
      },
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
});
