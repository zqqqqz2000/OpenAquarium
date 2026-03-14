import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GlobalWorkspaceConfig,
  ProviderModelProfile,
  TeamTemplate,
} from "@/domain/model";
import { CODEX_ACP_MIN_VERSION_PACKAGE_SPEC } from "@/lib/acp";
import type { TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";

const {
  cleanupMock,
  generateTextMock,
  languageModelMock,
  streamTextMock,
  streamConsumeMock,
  streamUiMessageMock,
} = vi.hoisted(() => ({
  cleanupMock: vi.fn(),
  languageModelMock: vi.fn(() => ({ provider: "mock" })),
  generateTextMock: vi.fn(),
  streamConsumeMock: vi.fn(),
  streamUiMessageMock: vi.fn(),
  streamTextMock: vi.fn(),
}));

vi.mock("@mcpc-tech/acp-ai-provider", () => ({
  createACPProvider: vi.fn(() => ({
    cleanup: cleanupMock,
    languageModel: languageModelMock,
  })),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    generateText: generateTextMock,
    streamText: streamTextMock,
  };
});

function createProfile(
  kind: "codex-acp" | "generic-acp",
): ProviderModelProfile {
  return {
    id: `model-${kind}`,
    name: kind === "codex-acp" ? "Codex ACP" : "Generic ACP",
    description: "profile",
    providerType: "acp",
    binding: {
      kind,
      label: kind,
      command: kind === "codex-acp" ? "npx" : "generic-acp",
      args:
        kind === "codex-acp"
          ? [CODEX_ACP_MIN_VERSION_PACKAGE_SPEC]
          : ["--stdio"],
      env: kind === "codex-acp" ? { OA_CODEX_ACP_MODE: "full-access" } : {},
      capabilities: ["prompt", "cancel", "loadSession"],
    },
  };
}

function createTemplate(): TeamTemplate {
  return {
    id: "template_1",
    name: "Template One",
    description: "desc",
    accentTone: "paper",
    members: [
      {
        id: "member_1",
        name: "Lead",
        handle: "lead",
        summary: "summary",
        prompt: "prompt",
        accentTone: "paper",
        provider: {
          kind: "codex-acp",
          label: "Codex ACP",
          command: "npx",
          args: [CODEX_ACP_MIN_VERSION_PACKAGE_SPEC],
          env: {},
          capabilities: ["prompt", "cancel", "loadSession"],
        },
        isEntryMember: true,
        acceptsDirectMessages: true,
        skills: [],
      },
    ],
  };
}

function createGlobalConfig(
  profile: ProviderModelProfile,
): GlobalWorkspaceConfig {
  return {
    directory: "/tmp/openaquarium-config",
    modelProfiles: [profile],
    templateChatModelProfileId: profile.id,
  };
}

describe("TemplateStudioChatService", () => {
  beforeEach(() => {
    cleanupMock.mockReset();
    languageModelMock.mockClear();
    generateTextMock.mockReset();
    streamConsumeMock.mockReset();
    streamUiMessageMock.mockReset();
    streamTextMock.mockReset();
    generateTextMock.mockResolvedValue({
      text: "updated",
    });
    streamTextMock.mockReturnValue({
      consumeStream: streamConsumeMock,
      toUIMessageStream: streamUiMessageMock,
    });
  });

  it("builds a plain ACP-backed generateText call for template chat", async () => {
    const { TemplateStudioChatService } =
      await import("@/server/template-studio-chat");
    const profile = createProfile("codex-acp");

    const service = new TemplateStudioChatService();
    const result = await service.chat({
      configDirectory: "/tmp/openaquarium-config",
      templateId: "template_1",
      messages: [{ role: "user", content: "Update the selected template." }],
      templates: [createTemplate()],
      globalConfig: createGlobalConfig(profile),
      modelProfileId: profile.id,
    });

    const generateTextCall = generateTextMock.mock.calls[0]?.[0] as
      | {
          tools?: unknown;
          system: string;
          messages: Array<{ role: string }>;
        }
      | undefined;

    expect(result.assistantMessage).toBe("updated");
    expect(generateTextCall?.tools).toBeUndefined();
    expect(generateTextCall?.system).toContain(
      "Edit OpenAquarium team templates by changing the real files in the working directory.",
    );
    expect(generateTextCall?.system).toContain(
      "Read template.schema.json and templates.json before editing.",
    );
    expect(generateTextCall?.system).toContain(
      "By default, edit only the selected template.",
    );
    expect(generateTextCall?.system).toContain(
      "Working directory: /tmp/openaquarium-config",
    );
    expect(generateTextCall?.messages).toHaveLength(1);
    expect(generateTextCall?.messages[0]?.role).toBe("user");
    expect(generateTextCall?.messages[0]).toMatchObject({
      content: [{ type: "text", text: "Update the selected template." }],
    });
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the same simple prompt path for generic ACP chat", async () => {
    const { TemplateStudioChatService } =
      await import("@/server/template-studio-chat");
    const profile = createProfile("generic-acp");

    const service = new TemplateStudioChatService();
    await service.chat({
      configDirectory: "/tmp/openaquarium-config",
      templateId: "template_1",
      messages: [{ role: "user", content: "Update the selected template." }],
      templates: [createTemplate()],
      globalConfig: createGlobalConfig(profile),
      modelProfileId: profile.id,
    });

    const generateTextCall = generateTextMock.mock.calls[0]?.[0] as
      | { tools?: unknown; system: string }
      | undefined;

    expect(generateTextCall?.tools).toBeUndefined();
    expect(generateTextCall?.system).toContain(
      "Edit OpenAquarium team templates by changing the real files in the working directory.",
    );
    expect(generateTextCall?.system).toContain("[Selected Team Template]");
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });

  it("builds a plain ACP-backed streamText call for streaming template chat", async () => {
    const { TemplateStudioChatService } =
      await import("@/server/template-studio-chat");
    const profile = createProfile("codex-acp");
    const messages: TemplateStudioUIMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Stream the selected template update." }],
      },
    ];

    const service = new TemplateStudioChatService();
    const result = await service.stream({
      configDirectory: "/tmp/openaquarium-config",
      templateId: "template_1",
      messages,
      templates: [createTemplate()],
      globalConfig: createGlobalConfig(profile),
      modelProfileId: profile.id,
    });

    const streamTextCall = streamTextMock.mock.calls[0]?.[0] as
      | {
          tools?: unknown;
          system: string;
          messages: Array<{ role: string }>;
          abortSignal?: AbortSignal;
        }
      | undefined;

    expect(result.modelProfileId).toBe(profile.id);
    expect(streamTextCall?.tools).toBeUndefined();
    expect(streamTextCall?.system).toContain(
      "Read template.schema.json and templates.json before editing.",
    );
    expect(streamTextCall?.messages).toHaveLength(1);
    expect(streamTextCall?.messages[0]?.role).toBe("user");
    expect(streamTextCall?.messages[0]).toMatchObject({
      content: [{ type: "text", text: "Stream the selected template update." }],
    });

    await result.cleanup();
    expect(cleanupMock).toHaveBeenCalledTimes(1);
  });
});
