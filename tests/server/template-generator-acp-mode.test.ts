import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cleanupMock,
  generateTextMock,
  initSessionMock,
  isCommandAvailableMock,
  setModeMock,
} = vi.hoisted(() => ({
  initSessionMock: vi.fn(),
  setModeMock: vi.fn(),
  cleanupMock: vi.fn(),
  generateTextMock: vi.fn(),
  isCommandAvailableMock: vi.fn(),
}));

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  createACPProvider: vi.fn(() => ({
    initSession: initSessionMock,
    setMode: setModeMock,
    cleanup: cleanupMock,
    languageModel: vi.fn(() => ({ provider: "mock" })),
    tools: undefined,
  })),
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

vi.mock("@/server/acp-session", () => ({
  isCommandAvailable: isCommandAvailableMock,
}));

describe("AcpTemplateGenerationTransport", () => {
  beforeEach(() => {
    vi.resetModules();
    initSessionMock.mockReset();
    initSessionMock.mockResolvedValue({
      sessionId: "session_1",
      modes: {
        currentModeId: "read-only",
        availableModes: [
          { id: "read-only", name: "Read Only" },
          { id: "full-access", name: "Full Access" },
        ],
      },
    });
    setModeMock.mockReset();
    setModeMock.mockResolvedValue(undefined);
    cleanupMock.mockReset();
    isCommandAvailableMock.mockReset();
    isCommandAvailableMock.mockReturnValue(true);
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue({
      text: JSON.stringify({
        name: "Generated Pod",
        description: "desc",
        accentTone: "paper",
        members: [
          {
            id: "lead",
            name: "Lead",
            handle: "lead",
            summary: "summary",
            prompt: "prompt",
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
            allowedSkillIds: [
              {
                id: "state",
                name: "state",
                description: "state",
                command: './bin/oa-room-state --room "$ROOM"',
              },
            ],
          },
          {
            id: "builder",
            name: "Builder",
            handle: "builder",
            summary: "summary",
            prompt: "prompt",
            accentTone: "paper",
            provider: {
              kind: "codex-acp",
              label: "Codex ACP",
              command: "npx",
              args: ["@zed-industries/codex-acp@^0.7.0"],
              env: {},
              capabilities: ["prompt", "cancel", "loadSession"],
            },
            acceptsDirectMessages: true,
            allowedSkillIds: [
              {
                id: "send",
                name: "send",
                description: "send",
                command: './bin/oa-room-send --scope group --text "ok"',
              },
            ],
          },
        ],
      }),
    });
  });

  it("forces codex template generation sessions into full-access by default", async () => {
    const { generateTemplateFromBrief } =
      await import("@/server/template-generator");

    await generateTemplateFromBrief("coding pod", {
      workspaceRoot: process.cwd(),
      env: {},
    });

    expect(initSessionMock).toHaveBeenCalledTimes(1);
    expect(setModeMock).toHaveBeenCalledWith("full-access");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("allows overriding the codex mode for template generation", async () => {
    const { generateTemplateFromBrief } =
      await import("@/server/template-generator");
    initSessionMock.mockResolvedValueOnce({
      sessionId: "session_1",
      modes: {
        currentModeId: "read-only",
        availableModes: [
          { id: "read-only", name: "Read Only" },
          { id: "auto", name: "Default" },
          { id: "full-access", name: "Full Access" },
        ],
      },
    });

    await generateTemplateFromBrief("coding pod", {
      workspaceRoot: process.cwd(),
      env: {
        OA_TEMPLATE_ACP_MODE: "auto",
      },
    });

    expect(setModeMock).toHaveBeenCalledWith("auto");
  });
});
