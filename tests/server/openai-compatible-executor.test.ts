import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExecutionRequest } from "@/server/executor";
import type { MemberToolHost } from "@/server/member-workspace-tools";

const {
  openAICompatibleLanguageModelMock,
  openAICompatibleProviderMock,
  streamTextMock,
} = vi.hoisted(() => ({
  openAICompatibleLanguageModelMock: vi.fn((modelId: string) => ({ provider: "openai-compatible", modelId })),
  openAICompatibleProviderMock: vi.fn(),
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
    streamTextMock.mockReset();
    streamTextMock.mockReturnValue({
      text: Promise.resolve("done"),
      finishReason: Promise.resolve("stop"),
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
      prompt: "Full task prompt with complete visible history",
    }));
    expect(onComplete).toHaveBeenCalledWith("done", "stop");
    expect(persistMemberSession).not.toHaveBeenCalled();
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
