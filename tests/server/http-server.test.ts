// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { DefaultChatTransport } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND } from "@/lib/acp";
import { getVisibleRoomMessages } from "@/lib/chat/workspace-ui-message";
import { createModelProfileDraft } from "@/lib/global-config-draft";
import type { TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";
import { OpenAquariumGlobalConfigManager } from "@/server/global-config";
import { WorkspacePersistence } from "@/server/persistence";
import { handleWorkspaceJsonApiRequest, startWorkspaceHttpServer } from "@/server/http-server";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";
import type { ExecutorCallbacks, ExecutionRequest, MemberExecutor, MemberExecutorFactory } from "@/server/executor";

class EchoExecutor implements MemberExecutor {
  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await callbacks.onComplete(`${request.member.handle} handled`, "end_turn");
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

async function reservePort(): Promise<number> {
  const server = createNetServer();

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to resolve reserved port"));
        return;
      }
      resolve(address.port);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return port;
}

describe("workspace http api routing", () => {
  const runtimes: WorkspaceRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
  });

  it("serves state and accepts member/message configuration mutations", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-"));
    const configDirPath = path.join(workspaceRoot, ".config");
    const globalConfigManager = new OpenAquariumGlobalConfigManager(configDirPath);
    const loadedGlobalConfig = await globalConfigManager.load();
    const executorFactory: MemberExecutorFactory = () => new EchoExecutor();
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      globalConfigManager,
      globalConfig: loadedGlobalConfig.config,
      templateStudioChatService: {
        chat: () => Promise.resolve({
          assistantMessage: "Template updated from chat.",
          modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId ?? loadedGlobalConfig.config.modelProfiles[0]?.id ?? "model-codex-acp-default",
        }),
        getModelCatalog: () =>
          Promise.resolve({
            source: "runtime",
            providerType: "acp",
            providerKind: loadedGlobalConfig.config.modelProfiles[0]?.binding.kind ?? "codex-acp",
            providerLabel: loadedGlobalConfig.config.modelProfiles[0]?.binding.label ?? "Codex",
            selectedProfileId:
              loadedGlobalConfig.config.templateChatModelProfileId ??
              loadedGlobalConfig.config.modelProfiles[0]?.id ??
              "model-codex-acp-default",
            availableModels: [],
          }),
        getModelCatalogForProfile: ({ profile }) =>
          Promise.resolve({
            source: "runtime",
            providerType: profile.providerType,
            providerKind: profile.binding.kind,
            providerLabel: profile.binding.label,
            selectedProfileId: profile.id,
            availableModels: [],
          }),
        testProfile: ({ modelId, profile, prompt }) =>
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
        stream: () => Promise.resolve({
          modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId ?? loadedGlobalConfig.config.modelProfiles[0]?.id ?? "model-codex-acp-default",
          result: {
            consumeStream: () => Promise.resolve(),
            toUIMessageStream: () => new ReadableStream(),
          },
          cleanup: () => Promise.resolve(),
        }),
        dispose: () => Promise.resolve(),
      },
      workspaceRoot,
      executorFactory,
      templateGenerator: (brief) => Promise.resolve({
        id: "template-http-generated",
        name: "HTTP Generated Template",
        description: brief,
        accentTone: "paper",
        members: [
          {
            id: "entry",
            name: "Lead Koi",
            handle: "lead",
            summary: "入口成员",
            prompt: "组织团队",
            accentTone: "postit",
            provider: {
              kind: "codex-acp",
              label: "Codex ACP",
              command: CODEX_ACP_NPX_COMMAND,
              args: CODEX_ACP_NPX_ARGS,
              env: {},
              capabilities: ["prompt", "cancel", "loadSession"],
            },
            isEntryMember: true,
            allowedSkillIds: ["room-send-group"],
          },
          {
            id: "builder",
            name: "Forge Crab",
            handle: "builder",
            summary: "实现成员",
            prompt: "负责实现",
            accentTone: "paper",
            provider: {
              kind: "generic-acp",
              label: "Builder ACP",
              command: "claude-code",
              args: ["--stdio"],
              env: {},
              capabilities: ["prompt", "cancel"],
            },
            allowedSkillIds: ["room-state"],
          },
        ],
      }),
    });
    runtimes.push(runtime);

    await runtime.createProject({
      projectName: "HTTP Check",
      templateId: "template-product-pod",
    });

    const stateResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/state",
    });
    const statePayload = stateResult?.payload as {
      snapshot: {
        selection: { projectId?: string; roomId?: string };
        rooms: Record<string, { memberIds: string[] }>;
      };
      globalConfig: {
        modelProfiles: Array<{ id: string }>;
      };
    };
    const projectId = statePayload.snapshot.selection.projectId;
    const roomId = statePayload.snapshot.selection.roomId;
    expect(projectId).toBeDefined();
    expect(roomId).toBeDefined();
    expect(statePayload.globalConfig.modelProfiles.length).toBeGreaterThan(0);
    if (!projectId || !roomId) {
      throw new Error("Expected project and room ids");
    }
    const room = statePayload.snapshot.rooms[roomId];
    expect(room).toBeDefined();
    if (!room) {
      throw new Error("Expected room");
    }
    const memberId = room.memberIds[0];
    expect(memberId).toBeDefined();
    const researchId = room.memberIds[1];
    expect(researchId).toBeDefined();
    const builderId = room.memberIds[2];
    expect(builderId).toBeDefined();
    if (!builderId || !researchId) {
      throw new Error("Expected builder and research ids");
    }

    const configResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/config`,
      body: {
        summary: "Builder v2",
        prompt: "新的 builder prompt",
        modelProfileId: loadedGlobalConfig.config.modelProfiles[0]?.id,
        acceptsDirectMessages: false,
        allowedSkillIds: ["room-send-group"],
        provider: {
          kind: "codex-acp",
          label: "Claude Code",
          command: "claude-code",
          args: ["--stdio"],
          env: {
            ANTHROPIC_API_KEY: "demo",
          },
          capabilities: ["prompt", "cancel"],
        },
      },
    });
    const configPayload = configResult?.payload as {
      snapshot: { members: Record<string, { provider: { command: string }; summary: string; modelProfileId?: string }> };
    };
    expect(configPayload.snapshot.members[builderId]?.provider.command).toBe(runtime.getSnapshot().members[builderId]?.provider.command);
    expect(configPayload.snapshot.members[builderId]?.summary).toBe("Builder v2");
    expect(configPayload.snapshot.members[builderId]?.modelProfileId).toBe(loadedGlobalConfig.config.modelProfiles[0]?.id);

    const entryResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/entry`,
    });
    const entryPayload = entryResult?.payload as { snapshot: { rooms: Record<string, { entryMemberId: string }> } };
    expect(entryPayload.snapshot.rooms[roomId].entryMemberId).toBe(builderId);

    const watcherResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/watcher`,
      body: {
        enabled: true,
        intervalMinutes: 6,
        persistent: true,
        prompt: "Only summarize unseen changes.",
      },
    });
    const watcherPayload = watcherResult?.payload as {
      snapshot: {
        rooms: Record<string, { watcherIds: string[] }>;
        watchers: Record<string, { memberId: string; intervalMinutes: number; persistent?: boolean; prompt?: string }>;
      };
    };
    expect(
      watcherPayload.snapshot.rooms[roomId].watcherIds.some(
        (watcherId) => watcherPayload.snapshot.watchers[watcherId]?.memberId === builderId
          && watcherPayload.snapshot.watchers[watcherId]?.intervalMinutes === 6,
      ),
    ).toBe(true);
    expect(
      Object.values(watcherPayload.snapshot.watchers).some(
        (watcher) =>
          watcher.memberId === builderId
          && watcher.persistent === true
          && watcher.prompt === "Only summarize unseen changes.",
      ),
    ).toBe(true);

    const roomReadResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/rooms/${roomId}/read`,
    });
    expect(roomReadResult?.statusCode).toBe(200);
    const roomReadPayload = roomReadResult?.payload as {
      snapshot: { rooms: Record<string, { id: string }> };
    };
    expect(roomReadPayload.snapshot.rooms[roomId]?.id).toBe(roomId);

    const roomWatcherSuspensionResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/rooms/${roomId}/watcher-suspension/toggle`,
    });
    expect(roomWatcherSuspensionResult?.statusCode).toBe(200);
    const roomWatcherSuspensionPayload = roomWatcherSuspensionResult?.payload as {
      snapshot: { rooms: Record<string, { watchersSuspended?: boolean }> };
    };
    expect(roomWatcherSuspensionPayload.snapshot.rooms[roomId]?.watchersSuspended).toBe(true);

    const roomTeamResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/rooms/${roomId}/team`,
      body: {
        teamName: "HTTP Room Team",
        teamDescription: "只对当前 room 生效",
        teamAccentTone: "blueprint",
        members: room.memberIds
          .filter((candidate) => candidate !== researchId)
          .map((candidate) => runtime.getSnapshot().members[candidate])
          .filter(Boolean)
          .map((member) =>
            member.id === builderId
              ? {
                  memberId: member.id,
                  name: member.name,
                  handle: member.handle,
                  summary: "HTTP builder summary",
                  prompt: member.prompt,
                  accentTone: member.accentTone,
                  modelProfileId: member.modelProfileId,
                  allowedSkillIds: member.allowedSkillIds,
                  provider: member.provider,
                  isEntryMember: member.isEntryMember,
                  acceptsDirectMessages: member.acceptsDirectMessages,
                  watch: {
                    enabled: true,
                    intervalMinutes: 6,
                  },
                }
              : {
                  memberId: member.id,
                  name: member.name,
                  handle: member.handle,
                  summary: member.summary,
                  prompt: member.prompt,
                  accentTone: member.accentTone,
                  modelProfileId: member.modelProfileId,
                  allowedSkillIds: member.allowedSkillIds,
                  provider: member.provider,
                  isEntryMember: member.isEntryMember,
                  acceptsDirectMessages: member.acceptsDirectMessages,
                },
          )
          .concat([
            {
              memberId: "qa-temp",
              name: "Signal Heron",
              handle: "qa",
              summary: "HTTP QA",
              prompt: "检查当前 room 的回归风险。",
              accentTone: "paper" as const,
              modelProfileId: loadedGlobalConfig.config.modelProfiles[0]?.id,
              allowedSkillIds: [],
              provider: runtime.getSnapshot().members[builderId].provider,
              isEntryMember: false,
              acceptsDirectMessages: true,
            },
          ]),
      },
    });
    const roomTeamPayload = roomTeamResult?.payload as {
      snapshot: {
        rooms: Record<string, { teamName?: string; teamDescription?: string; teamAccentTone?: string; memberIds: string[] }>;
        members: Record<string, { handle: string; summary: string; archivedAt?: string }>;
      };
    };
    const memberMessageResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/internal/member-message",
      body: {
        roomId,
        memberId,
        content: "@builder 请看这里",
      },
    });
    const payload = memberMessageResult?.payload as { snapshot: { messageOrderByRoom: Record<string, string[]>; messages: Record<string, { content: string }> } };
    const contents = (payload.snapshot.messageOrderByRoom[roomId] ?? []).map(
      (messageId) => payload.snapshot.messages[messageId]?.content ?? "",
    );

    const templateResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/templates/generate",
      body: {
        brief: "生成一个新的协作模板",
      },
    });
    const templatePayload = templateResult?.payload as {
      template: { id: string; name: string };
      snapshot: { templates: Record<string, { description: string }> };
    };
    const existingTemplate = runtime.getSnapshot().templates["template-product-pod"];
    const templateConfigResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/templates/${existingTemplate.id}/config`,
      body: {
        name: "Product Pod v2",
        description: "新的模板描述",
        accentTone: "correction",
        members: existingTemplate.members.map((member) =>
          member.handle === "builder"
            ? {
                ...member,
                summary: "新的模板 builder summary",
                provider: {
                  ...member.provider,
                  command: "claude-code",
                },
              }
            : member),
      },
    });
    const templateConfigPayload = templateConfigResult?.payload as {
      snapshot: {
        templates: Record<string, { name: string; accentTone: string; members: Array<{ handle: string; summary: string; provider: { command: string } }> }>;
      };
    };

    const createRoomResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/projects/${projectId}/rooms`,
      body: {
        templateId: "template-product-pod",
      },
    });
    const createRoomPayload = createRoomResult?.payload as {
      roomId: string;
      snapshot: { rooms: Record<string, { name: string; projectId: string; topic: string }> };
    };
    const globalConfigResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/config",
      body: {
        modelProfiles: loadedGlobalConfig.config.modelProfiles,
        templateChatModelProfileId: loadedGlobalConfig.config.templateChatModelProfileId,
      },
    });
    const globalConfigPayload = globalConfigResult?.payload as {
      globalConfig: {
        templateChatModelProfileId?: string;
      };
    };
    const templateChatResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/template-studio/chat",
      body: {
        templateId: existingTemplate.id,
        messages: [{ role: "user", content: "Update the template with chat." }],
      },
    });
    const templateChatPayload = templateChatResult?.payload as {
      assistantMessage: string;
      modelProfileId: string;
    };

    expect(contents.some((content) => content.includes("@builder"))).toBe(true);
    expect(roomTeamPayload.snapshot.rooms[roomId]?.teamName).toBe("HTTP Room Team");
    expect(roomTeamPayload.snapshot.rooms[roomId]?.teamDescription).toBe("只对当前 room 生效");
    expect(roomTeamPayload.snapshot.rooms[roomId]?.teamAccentTone).toBe("blueprint");
    expect(roomTeamPayload.snapshot.members[researchId]?.archivedAt).toBeDefined();
    expect(
      roomTeamPayload.snapshot.rooms[roomId]?.memberIds.some(
        (activeMemberId) => roomTeamPayload.snapshot.members[activeMemberId]?.handle === "qa",
      ),
    ).toBe(true);
    expect(roomTeamPayload.snapshot.members[builderId]?.summary).toBe("HTTP builder summary");
    expect(templatePayload.template.id).toBe("template-http-generated");
    expect(templatePayload.snapshot.templates["template-http-generated"]?.description).toBe("生成一个新的协作模板");
    expect(templateConfigPayload.snapshot.templates[existingTemplate.id]?.name).toBe("Product Pod v2");
    expect(templateConfigPayload.snapshot.templates[existingTemplate.id]?.accentTone).toBe("correction");
    expect(templateConfigPayload.snapshot.templates[existingTemplate.id]?.members.find((member) => member.handle === "builder")?.summary).toBe("新的模板 builder summary");
    expect(templateConfigPayload.snapshot.templates[existingTemplate.id]?.members.find((member) => member.handle === "builder")?.provider.command).toBe("claude-code");
    expect(createRoomPayload.snapshot.rooms[createRoomPayload.roomId]?.projectId).toBe(projectId);
    expect(createRoomPayload.snapshot.rooms[createRoomPayload.roomId]?.name).toBe("New room");
    expect(createRoomPayload.snapshot.rooms[createRoomPayload.roomId]?.topic).toBe("");
    expect(globalConfigPayload.globalConfig.templateChatModelProfileId).toBe(loadedGlobalConfig.config.templateChatModelProfileId);
    expect(templateChatPayload.assistantMessage).toBe("Template updated from chat.");
  });

  it("streams template studio chat chunks and emits a sync payload", async () => {
    if ("Bun" in globalThis) {
      return;
    }

    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-stream-"));
    const configDirPath = path.join(workspaceRoot, ".config");
    const globalConfigManager = new OpenAquariumGlobalConfigManager(configDirPath);
    const loadedGlobalConfig = await globalConfigManager.load();
    const runtime = await WorkspaceRuntime.create({
      workspaceRoot,
      stateFilePath: path.join(workspaceRoot, ".openaquarium", "state.json"),
      configDirPath,
      executorFactory: () => new EchoExecutor(),
      templateStudioChatService: {
        chat: () => Promise.resolve({
          assistantMessage: "unused",
          modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId ?? loadedGlobalConfig.config.modelProfiles[0]?.id ?? "model-codex-acp-default",
        }),
        getModelCatalog: () =>
          Promise.resolve({
            source: "runtime",
            providerType: "acp",
            providerKind: loadedGlobalConfig.config.modelProfiles[0]?.binding.kind ?? "codex-acp",
            providerLabel: loadedGlobalConfig.config.modelProfiles[0]?.binding.label ?? "Codex",
            selectedProfileId:
              loadedGlobalConfig.config.templateChatModelProfileId ??
              loadedGlobalConfig.config.modelProfiles[0]?.id ??
              "model-codex-acp-default",
            availableModels: [],
          }),
        getModelCatalogForProfile: ({ profile }) =>
          Promise.resolve({
            source: "runtime",
            providerType: profile.providerType,
            providerKind: profile.binding.kind,
            providerLabel: profile.binding.label,
            selectedProfileId: profile.id,
            availableModels: [],
          }),
        testProfile: ({ modelId, profile, prompt }) =>
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
        stream: ({ templates, templateId }) => {
          const nextTemplates = templates.map((template) =>
            template.id === templateId
              ? {
                  ...template,
                  description: "Stream updated description",
                }
              : template,
          );

          return globalConfigManager.saveTemplates(nextTemplates).then(() => ({
            modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId ?? loadedGlobalConfig.config.modelProfiles[0]?.id ?? "model-codex-acp-default",
            result: {
              consumeStream: () => Promise.resolve(),
              toUIMessageStream: () =>
                new ReadableStream({
                  start(controller) {
                    controller.enqueue({ type: "start", messageId: "assistant-stream" });
                    controller.enqueue({ type: "text-start", id: "text-stream" });
                    controller.enqueue({ type: "text-delta", id: "text-stream", delta: "Streaming " });
                    controller.enqueue({ type: "text-delta", id: "text-stream", delta: "template chat." });
                    controller.enqueue({ type: "text-end", id: "text-stream" });
                    controller.enqueue({ type: "finish", finishReason: "stop" });
                    controller.close();
                  },
                }),
            },
            cleanup: () => Promise.resolve(),
          }));
        },
        dispose: () => Promise.resolve(),
      },
    });
    runtimes.push(runtime);

    const existingTemplate = runtime.getSnapshot().templates["template-product-pod"];
    expect(existingTemplate).toBeDefined();
    if (!existingTemplate) {
      throw new Error("Expected product pod template");
    }

    const server = await startWorkspaceHttpServer({
      runtime,
      host: "127.0.0.1",
      port: await reservePort(),
    });

    try {
      const transport = new DefaultChatTransport<TemplateStudioUIMessage>({
        api: `http://127.0.0.1:${server.port}/api/template-studio/chat`,
      });
      const stream = await transport.sendMessages({
        chatId: "template-chat-test",
        trigger: "submit-message",
        messageId: undefined,
        abortSignal: undefined,
        headers: undefined,
        metadata: undefined,
        body: {
          templateId: existingTemplate.id,
          modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId,
        },
        messages: [
          {
            id: "user-1",
            role: "user",
            parts: [{ type: "text", text: "Update the selected template." }],
          },
        ],
      });

      const reader = stream.getReader();
      const chunkTypes: string[] = [];
      while (true) {
        const next = await reader.read();
        if (next.done) {
          break;
        }
        chunkTypes.push(next.value.type);
      }

      expect(chunkTypes).toContain("text-delta");
      expect(chunkTypes).toContain("data-templateStudioSync");
      expect(runtime.getSnapshot().templates[existingTemplate.id]?.description).toBe("Stream updated description");
    } finally {
      await server.close();
    }
  });

  it("returns model catalogs and test results for provider profile drafts", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-provider-test-"));
    const configDirPath = path.join(workspaceRoot, ".config");
    const globalConfigManager = new OpenAquariumGlobalConfigManager(configDirPath);
    const loadedGlobalConfig = await globalConfigManager.load();
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      globalConfigManager,
      globalConfig: loadedGlobalConfig.config,
      templateStudioChatService: {
        chat: () => Promise.resolve({
          assistantMessage: "unused",
          modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId ?? loadedGlobalConfig.config.modelProfiles[0]?.id ?? "model-codex-acp-default",
        }),
        getModelCatalog: () =>
          Promise.resolve({
            source: "runtime",
            providerType: "acp",
            providerKind: loadedGlobalConfig.config.modelProfiles[0]?.binding.kind ?? "codex-acp",
            providerLabel: loadedGlobalConfig.config.modelProfiles[0]?.binding.label ?? "Codex",
            selectedProfileId:
              loadedGlobalConfig.config.templateChatModelProfileId ??
              loadedGlobalConfig.config.modelProfiles[0]?.id ??
              "model-codex-acp-default",
            availableModels: [],
          }),
        getModelCatalogForProfile: ({ profile }) =>
          Promise.resolve({
            source: "runtime",
            providerType: profile.providerType,
            providerKind: profile.binding.kind,
            providerLabel: profile.binding.label,
            selectedProfileId: profile.id,
            currentModelId: "gpt-5.4",
            availableModels: [{ id: "gpt-5.4", label: "gpt-5.4" }],
          }),
        testProfile: ({ modelId, profile, prompt }) =>
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
        stream: () => Promise.resolve({
          modelProfileId: loadedGlobalConfig.config.templateChatModelProfileId ?? loadedGlobalConfig.config.modelProfiles[0]?.id ?? "model-codex-acp-default",
          result: {
            consumeStream: () => Promise.resolve(),
            toUIMessageStream: () => new ReadableStream(),
          },
          cleanup: () => Promise.resolve(),
        }),
        dispose: () => Promise.resolve(),
      },
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const draft = createModelProfileDraft(loadedGlobalConfig.config.modelProfiles[0]);
    const catalogResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/provider-profiles/model-catalog",
      body: { draft },
    });
    const testResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/provider-profiles/test",
      body: {
        draft,
        modelId: "gpt-5.4",
      },
    });

    expect(catalogResult?.statusCode).toBe(200);
    expect(catalogResult?.payload).toMatchObject({
      source: "runtime",
      selectedProfileId: draft.id,
      availableModels: [{ id: "gpt-5.4", label: "gpt-5.4" }],
    });
    expect(testResult?.statusCode).toBe(200);
    expect(testResult?.payload).toMatchObject({
      profileId: draft.id,
      modelId: "gpt-5.4",
      responseText: "Provider test ok.",
    });
  });

  it("rejects legacy firstPrompt payloads for project and room creation", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-legacy-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const projectResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/projects",
      body: {
        projectName: "Legacy",
        templateId: "template-product-pod",
        firstPrompt: "legacy prompt",
      },
    });

    expect(projectResult).toEqual({
      statusCode: 400,
      payload: { error: "firstPrompt is no longer supported. Create the room first, then send the first message." },
    });

    const created = await runtime.createProject({
      projectName: "Modern",
      templateId: "template-product-pod",
    });

    const roomResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/projects/${created.projectId}/rooms`,
      body: {
        templateId: "template-product-pod",
        firstPrompt: "legacy prompt",
      },
    });

    expect(roomResult).toEqual({
      statusCode: 400,
      payload: { error: "firstPrompt is no longer supported. Create the room first, then send the first message." },
    });
  });

  it("returns cursor-paged room history through the JSON API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-history-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "History API",
      templateId: "template-product-pod",
    });

    await runtime.sendUserMessage({ roomId: created.roomId, content: "history api first" });
    await runtime.sendUserMessage({ roomId: created.roomId, content: "history api second" });
    await runtime.sendUserMessage({ roomId: created.roomId, content: "history api third" });

    const snapshot = runtime.getSnapshot();
    const room = snapshot.rooms[created.roomId];
    if (!room) {
      throw new Error("Expected room");
    }

    const visibleMessages = getVisibleRoomMessages(snapshot, room);
    const beforeMessageId = visibleMessages.at(-1)?.id;
    if (!beforeMessageId) {
      throw new Error("Expected visible messages");
    }

    const historyResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: `/api/rooms/${created.roomId}/history`,
      searchParams: new URLSearchParams({
        before: beforeMessageId,
        limit: "2",
      }),
    });
    const historyPayload = historyResult?.payload as {
      messages: Array<{ id: string }>;
      hasMore: boolean;
    };

    expect(historyResult?.statusCode).toBe(200);
    expect(historyPayload.messages.map((message) => message.id)).toEqual(visibleMessages.slice(-3, -1).map((message) => message.id));
    expect(historyPayload.hasMore).toBe(visibleMessages.length > 3);
  });

  it("supports deleting templates, rooms, and projects through the JSON API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-delete-"));
    const configDirPath = path.join(workspaceRoot, ".config");
    const globalConfigManager = new OpenAquariumGlobalConfigManager(configDirPath);
    const loadedGlobalConfig = await globalConfigManager.load();
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      globalConfigManager,
      globalConfig: loadedGlobalConfig.config,
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Delete API",
      templateId: "template-product-pod",
    });

    const deleteTemplateResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "DELETE",
      pathname: "/api/templates/template-incident-pod",
    });
    const deleteTemplatePayload = deleteTemplateResult?.payload as {
      snapshot: { templates: Record<string, { id: string }> };
    };

    const deleteRoomResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "DELETE",
      pathname: `/api/rooms/${created.roomId}`,
    });
    const deleteRoomPayload = deleteRoomResult?.payload as {
      snapshot: { rooms: Record<string, { id: string }>; selection: { roomId?: string; projectId?: string } };
    };

    const deleteProjectResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "DELETE",
      pathname: `/api/projects/${created.projectId}`,
    });
    const deleteProjectPayload = deleteProjectResult?.payload as {
      snapshot: { projects: Record<string, { id: string }>; selection: { projectId?: string } };
    };

    expect(deleteTemplatePayload.snapshot.templates["template-incident-pod"]).toBeUndefined();
    expect(deleteRoomPayload.snapshot.rooms[created.roomId]).toBeUndefined();
    expect(deleteRoomPayload.snapshot.selection.projectId).toBe(created.projectId);
    expect(deleteRoomPayload.snapshot.selection.roomId).toBeUndefined();
    expect(deleteProjectPayload.snapshot.projects[created.projectId]).toBeUndefined();
    expect(deleteProjectPayload.snapshot.selection.projectId).toBeUndefined();
  });
});
