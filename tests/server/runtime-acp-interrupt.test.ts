import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
}

interface MockAcpModel {
  provider: "mock";
  connection:
    | {
        cancel?: (params: { sessionId: string }) => Promise<void>;
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

vi.mock("@mcpc-tech/acp-ai-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mcpc-tech/acp-ai-provider")>();

  return {
    ...actual,
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
        initSession: async (tools?: object) => {
          const response = await initSessionMock({ config, model, tools });
          model.sessionId = response.sessionId;
          model.sessionResponse = response;
          model.isFreshSession = !config.existingSessionId;
          model.currentModeId = response.modes?.currentModeId ?? model.currentModeId;
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
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();

  return {
    ...actual,
    streamText: streamTextMock,
    tool: (definition: object) => definition,
  };
});

import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { OpenAquariumGlobalConfigManager } from "@/server/global-config";
import { WorkspacePersistence } from "@/server/persistence";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 1_500): Promise<void> {
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

describe("WorkspaceRuntime ACP interrupt integration", () => {
  const runtimes: WorkspaceRuntime[] = [];

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
  });

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
  });

  it("keeps interrupted @> follow-ups on delta prompts within the same acp session", async () => {
    let releaseFirstTurn: (() => void) | undefined;
    const firstTurn = new Promise<void>((resolve) => {
      releaseFirstTurn = resolve;
    });
    cancelSessionMock.mockImplementation(async () => {
      releaseFirstTurn?.();
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

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-runtime-acp-interrupt-"));
    const configDir = path.join(workspaceRoot, ".config");
    const globalConfigManager = new OpenAquariumGlobalConfigManager(configDir);
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      globalConfigManager,
      globalConfig: createDefaultGlobalWorkspaceConfig(configDir),
      workspaceRoot,
      taskExecutionInactivityTimeoutMs: 0,
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "ACP Interrupt Runtime",
      templateId: "template-product-pod",
    });

    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "先起一轮 lead 任务",
    });

    await waitFor(() => {
      expect(streamTextMock).toHaveBeenCalledTimes(1);
    });

    await runtime.sendUserMessage({
      roomId: created.roomId,
      content: "@>lead 被打断后继续处理",
    });

    await waitFor(() => {
      expect(streamTextMock).toHaveBeenCalledTimes(2);
    });

    const firstPrompt = (streamTextMock.mock.calls[0]?.[0] as { prompt?: string } | undefined)?.prompt ?? "";
    const secondPrompt = (streamTextMock.mock.calls[1]?.[0] as { prompt?: string } | undefined)?.prompt ?? "";

    expect(firstPrompt).toContain("prompt mode: full");
    expect(secondPrompt).toContain("prompt mode: delta");
    expect(cancelSessionMock).toHaveBeenCalledWith(
      { sessionId: "session_1" },
      expect.anything(),
    );
    expect(createACPProviderMock).toHaveBeenCalledTimes(1);
  });
});
