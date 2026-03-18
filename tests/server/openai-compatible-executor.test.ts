import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionRequest } from "@/server/executor";
import type { MemberToolHost } from "@/server/member-workspace-tools";

const {
  openAICompatibleLanguageModelMock,
  openAICompatibleProviderMock,
  mcpCloseMock,
  mcpCreateClientMock,
  mcpStdioTransportMock,
  mcpToolsMock,
  streamTextMock,
} = vi.hoisted(() => ({
  openAICompatibleLanguageModelMock: vi.fn((modelId: string) => ({ provider: "openai-compatible", modelId })),
  openAICompatibleProviderMock: vi.fn(),
  mcpCloseMock: vi.fn(() => Promise.resolve()),
  mcpCreateClientMock: vi.fn(),
  mcpStdioTransportMock: vi.fn((options: unknown) => ({ kind: "stdio-transport", options })),
  mcpToolsMock: vi.fn(() => ({})),
  streamTextMock: vi.fn(),
}));

vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: vi.fn((options: unknown) => {
    openAICompatibleProviderMock(options);
    return {
      languageModel: openAICompatibleLanguageModelMock,
    };
  }),
}));

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn((options: unknown) => {
    mcpCreateClientMock(options);
    return Promise.resolve({
      tools: () => Promise.resolve(mcpToolsMock()),
      close: mcpCloseMock,
    });
  }),
}));

vi.mock("@ai-sdk/mcp/mcp-stdio", () => ({
  Experimental_StdioMCPTransport: vi.fn(function Experimental_StdioMCPTransport(options: unknown) {
    mcpStdioTransportMock(options);
    return { kind: "stdio-transport", options };
  }),
}));

vi.mock("ai", () => ({
  streamText: streamTextMock,
  tool: (definition: object) => definition,
}));

function createRequest(): ExecutionRequest {
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
      provider: {
        kind: "openai-compatible",
        label: "OpenAI-Compatible API",
        baseURL: "https://example.test/v1",
        apiKeyEnvVar: "OPENAI_API_KEY",
        headersFormat: "kv",
        headers: {
          "X-Workspace": "OpenAquarium",
        },
        extraBodyFormat: "json",
        extraBody: {
          provider: {
            order: ["reasoning"],
          },
        },
        mcpServers: [],
      },
      acceptsDirectMessages: true,
      isEntryMember: true,
      status: "idle",
      modelId: "gpt-4.1-mini",
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
    prompt: "Full task prompt with complete visible history",
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
    persistMemberSession: () => Promise.resolve(),
    ...overrides,
  };
}

describe("OpenAICompatibleMemberExecutor", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    openAICompatibleLanguageModelMock.mockClear();
    openAICompatibleProviderMock.mockReset();
    mcpCloseMock.mockClear();
    mcpCreateClientMock.mockReset();
    mcpStdioTransportMock.mockReset();
    mcpToolsMock.mockReset();
    mcpToolsMock.mockReturnValue({});
    streamTextMock.mockReset();
    streamTextMock.mockReturnValue({
      text: Promise.resolve("done"),
      finishReason: Promise.resolve("stop"),
      response: Promise.resolve({
        messages: [
          {
            role: "assistant",
            content: "done",
          },
        ],
      }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the openai-compatible provider without session persistence", async () => {
    const persistMemberSession = vi.fn(() => Promise.resolve());
    const request = createRequest();
    const { OpenAICompatibleMemberExecutor } = await import("@/server/openai-compatible-executor");
    const executor = new OpenAICompatibleMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost({
        persistMemberSession,
      }),
    });
    const onComplete = vi.fn(() => Promise.resolve());

    await executor.execute(request, {
      onPromptVisible: () => Promise.resolve(),
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete,
      onError: () => Promise.resolve(),
    });

    expect(openAICompatibleProviderMock).toHaveBeenCalledWith({
      name: "OpenAI-Compatible API",
      baseURL: "https://example.test/v1",
      apiKey: undefined,
      headers: {
        "X-Workspace": "OpenAquarium",
      },
      transformRequestBody: expect.any(Function),
    });
    expect(openAICompatibleLanguageModelMock).toHaveBeenCalledWith("gpt-4.1-mini");
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        {
          role: "user",
          content: "Full task prompt with complete visible history",
        },
      ],
    }));
    expect(onComplete).toHaveBeenCalledWith("done", "stop", {
      nextOpenAICompatibleConversation: {
        messages: [
          {
            role: "user",
            content: "Full task prompt with complete visible history",
          },
          {
            role: "assistant",
            content: "done",
          },
        ],
      },
    });
    expect(persistMemberSession).not.toHaveBeenCalled();
  });

  it("merges configured MCP tools into the openai-compatible tool set", async () => {
    const request = createRequest();
    if (request.member.provider.kind !== "openai-compatible") {
      throw new Error("Expected openai-compatible provider");
    }
    request.member.provider.mcpServers = [
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
    mcpToolsMock.mockReturnValue({
      mcp_echo: {
        description: "Echo via MCP",
        inputSchema: {},
        execute: vi.fn(),
      },
    });
    const { OpenAICompatibleMemberExecutor } = await import("@/server/openai-compatible-executor");
    const executor = new OpenAICompatibleMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    await executor.execute(request, {
      onPromptVisible: () => Promise.resolve(),
      onDraft: () => Promise.resolve(),
      onStatus: () => Promise.resolve(),
      onComplete: () => Promise.resolve(),
      onError: () => Promise.resolve(),
    });

    expect(mcpStdioTransportMock).toHaveBeenCalledWith({
      command: "node",
      args: ["./mcp-server.js"],
      env: {
        MCP_MODE: "test",
      },
      cwd: path.join(process.cwd(), "mcp"),
    });
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.objectContaining({
        oa_send_group_message: expect.any(Object),
        exec_command: expect.any(Object),
        apply_patch: expect.any(Object),
        mcp_echo: expect.objectContaining({
          description: "Echo via MCP",
        }),
      }),
    }));
    expect(mcpCloseMock).toHaveBeenCalled();
  });

  it("replays persisted message history on subsequent turns", async () => {
    const request = createRequest();
    const { OpenAICompatibleMemberExecutor } = await import("@/server/openai-compatible-executor");
    const executor = new OpenAICompatibleMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    await executor.execute(
      {
        ...request,
        messageHistory: [
          {
            role: "user",
            content: "Earlier full prompt",
          },
          {
            role: "assistant",
            content: "Earlier answer",
          },
        ],
        openAICompatibleConversation: {
          messages: [
            {
              role: "user",
              content: "Earlier full prompt",
            },
            {
              role: "assistant",
              content: "Earlier answer",
            },
          ],
        },
        prompt: "Delta task update",
      },
      {
        onPromptVisible: () => Promise.resolve(),
        onDraft: () => Promise.resolve(),
        onStatus: () => Promise.resolve(),
        onComplete: () => Promise.resolve(),
        onError: () => Promise.resolve(),
      },
    );

    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        {
          role: "user",
          content: "Earlier full prompt",
        },
        {
          role: "assistant",
          content: "Earlier answer",
        },
        {
          role: "user",
          content: "Delta task update",
        },
      ],
    }));
  });

  it("runs visible compaction with a dedicated model and persists summary plus the last 10 messages", async () => {
    const request = createRequest();
    if (request.member.provider.kind !== "openai-compatible") {
      throw new Error("Expected openai-compatible provider");
    }

    request.member.provider.modelLimits = {
      "gpt-4.1-mini": {
        context: 80,
      },
    };
    request.member.provider.compactionModelId = "gpt-4.1-nano";
    request.member.provider.compactionReservedTokens = 10;
    request.member.provider.compactionOffloadThresholdChars = 10;
    request.messageHistory = Array.from({ length: 12 }, (_, index) => (
      index % 2 === 0
        ? {
            role: "user" as const,
            content: `Earlier prompt ${index} with enough text to force compaction`,
          }
        : {
            role: "assistant" as const,
            content: `Earlier answer ${index} with enough text to force compaction`,
          }
    ));

    streamTextMock
      .mockReset()
      .mockReturnValueOnce({
        text: Promise.resolve("<analysis>compaction</analysis>\n\n1. Primary Request and Intent\n- summary"),
        finishReason: Promise.resolve("stop"),
        response: Promise.resolve({
          messages: [
            {
              role: "assistant",
              content: "summary",
            },
          ],
        }),
      })
      .mockReturnValueOnce({
        text: Promise.resolve("done"),
        finishReason: Promise.resolve("stop"),
        response: Promise.resolve({
          messages: [
            {
              role: "assistant",
              content: "done",
            },
          ],
        }),
      });

    const onStatus = vi.fn(() => Promise.resolve());
    const onComplete = vi.fn(() => Promise.resolve());
    const { OpenAICompatibleMemberExecutor } = await import("@/server/openai-compatible-executor");
    const executor = new OpenAICompatibleMemberExecutor({
      workspaceRoot: process.cwd(),
      member: request.member,
      host: createHost(),
    });

    await executor.execute(request, {
      onPromptVisible: () => Promise.resolve(),
      onDraft: () => Promise.resolve(),
      onStatus,
      onComplete,
      onError: () => Promise.resolve(),
    });

    expect(openAICompatibleLanguageModelMock).toHaveBeenNthCalledWith(1, "gpt-4.1-nano");
    expect(openAICompatibleLanguageModelMock).toHaveBeenNthCalledWith(2, "gpt-4.1-mini");
    expect(streamTextMock).toHaveBeenCalledTimes(2);
    expect(streamTextMock.mock.calls[0]?.[0]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("[OA_COMPACTION_AGENT]"),
        }),
        expect.objectContaining({
          role: "user",
          content: expect.stringContaining("Primary Request and Intent"),
        }),
      ]),
    });
    expect(streamTextMock.mock.calls[1]?.[0]).toMatchObject({
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("The conversation begins with a compaction summary."),
        }),
        expect.objectContaining({
          role: "assistant",
          content: "<analysis>compaction</analysis>\n\n1. Primary Request and Intent\n- summary",
        }),
      ]),
    });
    expect(onStatus).toHaveBeenCalledWith("Compacting conversation history...");
    expect(onStatus).toHaveBeenCalledWith("Compaction completed.");
    expect(onComplete).toHaveBeenCalledWith("done", "stop", {
      nextOpenAICompatibleConversation: expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            summary: expect.objectContaining({
              tailMessageCount: 10,
              modelId: "gpt-4.1-nano",
            }),
          }),
          expect.objectContaining({
            role: "user",
            content: "Full task prompt with complete visible history",
          }),
          expect.objectContaining({
            role: "assistant",
            content: "done",
          }),
        ]),
      }),
    });
  });

  it("fails early when the openai-compatible member has no model id", async () => {
    const request = createRequest();
    const { OpenAICompatibleMemberExecutor } = await import("@/server/openai-compatible-executor");
    const executor = new OpenAICompatibleMemberExecutor({
      workspaceRoot: process.cwd(),
      member: {
        ...request.member,
        modelId: undefined,
      },
      host: createHost(),
    });

    await expect(
      executor.execute(
        {
          ...request,
          member: {
            ...request.member,
            modelId: undefined,
          },
        },
        {
          onDraft: () => Promise.resolve(),
          onStatus: () => Promise.resolve(),
          onComplete: () => Promise.resolve(),
          onError: () => Promise.resolve(),
        },
      ),
    ).rejects.toThrow('requires a model id');
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
