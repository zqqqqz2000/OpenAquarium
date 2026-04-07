// @vitest-environment node

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { DefaultChatTransport } from "ai";
import { afterEach, describe, expect, it } from "vitest";

import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND } from "@/lib/acp";
import { getVisibleRoomMessages } from "@/lib/chat/workspace-ui-message";
import { createModelProfileDraft } from "@/lib/global-config-draft";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import type { TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";
import { OpenAquariumGlobalConfigManager } from "@/server/global-config";
import { WorkspacePersistence } from "@/server/persistence";
import { handleWorkspaceJsonApiRequest, startWorkspaceHttpServer } from "@/server/http-server";
import { syncRoomContextFiles } from "@/server/room-context-files";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";
import type { ExecutorCallbacks, ExecutionRequest, MemberExecutor, MemberExecutorFactory } from "@/server/executor";

const ORIGINAL_BOOTSTRAP_ADMIN_HANDLE = process.env.OA_BOOTSTRAP_ADMIN_HANDLE;
const ORIGINAL_BOOTSTRAP_ADMIN_PASSWORD = process.env.OA_BOOTSTRAP_ADMIN_PASSWORD;
const ORIGINAL_BOOTSTRAP_ADMIN_DISPLAY_NAME = process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME;

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

function configureBootstrapAdmin(args: { handle: string; password: string; displayName: string }): void {
  process.env.OA_BOOTSTRAP_ADMIN_HANDLE = args.handle;
  process.env.OA_BOOTSTRAP_ADMIN_PASSWORD = args.password;
  process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME = args.displayName;
}

describe("workspace http api routing", () => {
  const runtimes: WorkspaceRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
    if (ORIGINAL_BOOTSTRAP_ADMIN_HANDLE === undefined) {
      delete process.env.OA_BOOTSTRAP_ADMIN_HANDLE;
    } else {
      process.env.OA_BOOTSTRAP_ADMIN_HANDLE = ORIGINAL_BOOTSTRAP_ADMIN_HANDLE;
    }
    if (ORIGINAL_BOOTSTRAP_ADMIN_PASSWORD === undefined) {
      delete process.env.OA_BOOTSTRAP_ADMIN_PASSWORD;
    } else {
      process.env.OA_BOOTSTRAP_ADMIN_PASSWORD = ORIGINAL_BOOTSTRAP_ADMIN_PASSWORD;
    }
    if (ORIGINAL_BOOTSTRAP_ADMIN_DISPLAY_NAME === undefined) {
      delete process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME;
    } else {
      process.env.OA_BOOTSTRAP_ADMIN_DISPLAY_NAME = ORIGINAL_BOOTSTRAP_ADMIN_DISPLAY_NAME;
    }
  });

  it("serves state and accepts member/message configuration mutations", async () => {
    configureBootstrapAdmin({ handle: "alice", password: "secret-pass", displayName: "Alice" });
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
    const login = await runtime.login({
      handle: "alice",
      password: "secret-pass",
      displayName: "Alice",
    });
    const authHeaders = {
      authorization: `Bearer ${login.sessionToken}`,
    };

    const stateResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: "/api/state",
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
    });
    const entryPayload = entryResult?.payload as { snapshot: { rooms: Record<string, { entryMemberId: string }> } };
    expect(entryPayload.snapshot.rooms[roomId].entryMemberId).toBe(builderId);

    const watcherResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/watcher`,
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
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

  it("returns credentialed CORS headers for localhost split-origin auth, room read, and assets requests", async () => {
    configureBootstrapAdmin({ handle: "alice-cors", password: "secret-pass", displayName: "Alice CORS" });
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-cors-auth-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createSeedWorkspace(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const server = await startWorkspaceHttpServer({
      runtime,
      host: "127.0.0.1",
      port: await reservePort(),
    });

    const frontendOrigin = "http://localhost:5173";
    const roomId = runtime.getSnapshot().selection.roomId;
    if (!roomId) {
      throw new Error("Expected seed room");
    }

    try {
      const loginPreflight = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "OPTIONS",
        headers: {
          Origin: frontendOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(loginPreflight.status).toBe(204);
      expect(loginPreflight.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(loginPreflight.headers.get("access-control-allow-credentials")).toBe("true");
      expect(loginPreflight.headers.get("access-control-allow-methods")).toContain("POST");
      expect(loginPreflight.headers.get("vary")).toContain("Origin");

      const loginResponse = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: {
          Origin: frontendOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          handle: "alice-cors",
          password: "secret-pass",
          displayName: "Alice CORS",
        }),
      });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(loginResponse.headers.get("access-control-allow-credentials")).toBe("true");
      const loginPayload = await loginResponse.json() as { authenticated: boolean; sessionToken?: string };
      expect(loginPayload.authenticated).toBe(true);
      expect(loginPayload.sessionToken).toBeTruthy();
      const sessionToken = loginPayload.sessionToken;
      if (!sessionToken) {
        throw new Error("Expected session token");
      }

      const sessionPreflight = await fetch(`http://127.0.0.1:${server.port}/api/auth/session`, {
        method: "OPTIONS",
        headers: {
          Origin: frontendOrigin,
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "x-openaquarium-session",
        },
      });

      expect(sessionPreflight.status).toBe(204);
      expect(sessionPreflight.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(sessionPreflight.headers.get("access-control-allow-headers")).toContain("x-openaquarium-session");

      const sessionResponse = await fetch(`http://127.0.0.1:${server.port}/api/auth/session`, {
        headers: {
          Origin: frontendOrigin,
          "x-openaquarium-session": sessionToken,
        },
      });
      expect(sessionResponse.status).toBe(200);
      expect(sessionResponse.headers.get("access-control-allow-origin")).toBe(frontendOrigin);

      const membershipsResponse = await fetch(`http://127.0.0.1:${server.port}/api/me/projects`, {
        headers: {
          Origin: frontendOrigin,
          "x-openaquarium-session": sessionToken,
        },
      });
      expect(membershipsResponse.status).toBe(200);
      expect(membershipsResponse.headers.get("access-control-allow-origin")).toBe(frontendOrigin);

      const roomReadPreflight = await fetch(`http://127.0.0.1:${server.port}/api/rooms/${roomId}/read`, {
        method: "OPTIONS",
        headers: {
          Origin: frontendOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,x-openaquarium-session",
        },
      });
      expect(roomReadPreflight.status).toBe(204);
      expect(roomReadPreflight.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(roomReadPreflight.headers.get("access-control-allow-credentials")).toBe("true");

      const roomReadResponse = await fetch(`http://127.0.0.1:${server.port}/api/rooms/${roomId}/read`, {
        method: "POST",
        headers: {
          Origin: frontendOrigin,
          "content-type": "application/json",
          "x-openaquarium-session": sessionToken,
        },
        body: JSON.stringify({}),
      });
      expect(roomReadResponse.status).toBe(200);
      expect(roomReadResponse.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(roomReadResponse.headers.get("access-control-allow-credentials")).toBe("true");

      const assetsPreflight = await fetch(
        `http://127.0.0.1:${server.port}/api/rooms/${roomId}/assets?fileName=${encodeURIComponent("cors-proof.png")}`,
        {
          method: "OPTIONS",
          headers: {
            Origin: frontendOrigin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-openaquarium-session",
          },
        },
      );
      expect(assetsPreflight.status).toBe(204);
      expect(assetsPreflight.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(assetsPreflight.headers.get("access-control-allow-credentials")).toBe("true");

      const assetResponse = await fetch(
        `http://127.0.0.1:${server.port}/api/rooms/${roomId}/assets?fileName=${encodeURIComponent("cors-proof.png")}`,
        {
          method: "POST",
          headers: {
            Origin: frontendOrigin,
            "content-type": "image/png",
            "x-openaquarium-session": sessionToken,
          },
          body: Buffer.from("iVBORw0KGgo=", "base64"),
        },
      );
      expect(assetResponse.status).toBe(200);
      expect(assetResponse.headers.get("access-control-allow-origin")).toBe(frontendOrigin);
      expect(assetResponse.headers.get("access-control-allow-credentials")).toBe("true");
    } finally {
      await server.close();
    }
  });

  it("rejects unconfigured non-loopback origins before auth mutations run", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-cors-blocked-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const server = await startWorkspaceHttpServer({
      runtime,
      host: "127.0.0.1",
      port: await reservePort(),
    });

    try {
      const blockedOrigin = "https://example.com";
      const preflight = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "OPTIONS",
        headers: {
          Origin: blockedOrigin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });

      expect(preflight.status).toBe(403);
      expect(preflight.headers.get("access-control-allow-origin")).toBeNull();

      const loginResponse = await fetch(`http://127.0.0.1:${server.port}/api/auth/login`, {
        method: "POST",
        headers: {
          Origin: blockedOrigin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          handle: "mallory",
          password: "malicious-pass",
          displayName: "Mallory",
        }),
      });

      expect(loginResponse.status).toBe(403);
      expect(await loginResponse.json()).toEqual({ error: "Origin not allowed" });
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

  it("inspects a manually entered project path through the JSON API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-inspect-"));
    const projectRoot = path.join(workspaceRoot, "manual-project");
    await mkdir(projectRoot, { recursive: true });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const result = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/system/project-path/inspect",
      body: {
        path: projectRoot,
      },
    });

    expect(result?.statusCode).toBe(200);
    if (!result || typeof result.payload !== "object" || result.payload === null) {
      throw new Error("Expected inspection payload");
    }

    const payload = result.payload as Record<string, unknown>;
    expect(payload.path).toBe(projectRoot);
    expect(payload.projectName).toBe("manual-project");
    expect(payload.canImport).toBe(false);
    expect(payload.roomCount).toBe(0);
  });

  it("returns an error when inspecting a missing project path through the HTTP API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-inspect-missing-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);
    const server = await startWorkspaceHttpServer({
      runtime,
      host: "127.0.0.1",
      port: await reservePort(),
    });
    const missingPath = path.join(workspaceRoot, "missing-project");

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/system/project-path/inspect`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ path: missingPath }),
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Project directory does not exist.",
      });
    } finally {
      await server.close();
    }
  });

  it("browses project directories through the JSON API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-project-path-"));
    const projectRoot = path.join(workspaceRoot, "manual-project");
    await mkdir(projectRoot, { recursive: true });
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const result = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/system/project-path/browse",
      body: {
        path: workspaceRoot,
      },
    });

    expect(result?.statusCode).toBe(200);
    if (!result || typeof result.payload !== "object" || result.payload === null) {
      throw new Error("Expected browse payload");
    }

    const payload = result.payload as Record<string, unknown>;
    expect(payload.path).toBe(workspaceRoot);
    expect(payload.parentPath).toBe(path.dirname(workspaceRoot));
    expect(payload.isWorkspaceRoot).toBe(true);

    const entries = payload.entries;
    if (!Array.isArray(entries)) {
      throw new Error("Expected browse entries");
    }
    expect(entries).toContainEqual(expect.objectContaining({
      name: "manual-project",
      path: projectRoot,
    }));

    const inspection = payload.inspection;
    if (typeof inspection !== "object" || inspection === null) {
      throw new Error("Expected browse inspection payload");
    }
    expect((inspection as Record<string, unknown>).path).toBe(workspaceRoot);
    expect((inspection as Record<string, unknown>).projectName).toBe(path.basename(workspaceRoot));
    expect((inspection as Record<string, unknown>).canImport).toBe(false);
    expect((inspection as Record<string, unknown>).roomCount).toBe(0);
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

  it("returns room todo tree files through the JSON API", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-todo-"));
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-http-todo-project-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Todo API",
      templateId: "template-product-pod",
      path: projectRoot,
    });

    const result = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "GET",
      pathname: `/api/rooms/${created.roomId}/todo-trees`,
    });
    const payload = result?.payload as {
      files: Array<{ fileName: string }>;
      projectInteractiveDirectory: string;
      roomInteractiveDirectory: string;
      providerAssociationNotice: string;
      roomId: string;
    };

    expect(result?.statusCode).toBe(200);
    expect(payload.roomId).toBe(created.roomId);
    expect(payload.projectInteractiveDirectory).toContain(
      path.join(projectRoot, ".openaquarium", "interactive"),
    );
    expect(payload.roomInteractiveDirectory).toContain(
      path.join(projectRoot, ".openaquarium", "interactive", "rooms", created.roomId, "interactive"),
    );
    expect(payload.files[0]?.fileName).toBe("main.aqtree.xml");
    expect(payload.providerAssociationNotice).toContain(
      "re-associate the project from the room UI",
    );
  });

  it("serves room assets through the binary asset route", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-asset-"));
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-http-asset-project-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Asset API",
      templateId: "template-product-pod",
      path: projectRoot,
    });
    const assetRelativePath = "evidence/proof.png";
    const assetAbsolutePath = path.join(projectRoot, assetRelativePath);

    await mkdir(path.dirname(assetAbsolutePath), { recursive: true });
    await writeFile(
      assetAbsolutePath,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oZx2kcAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    const server = await startWorkspaceHttpServer({
      runtime,
      host: "127.0.0.1",
      port: await reservePort(),
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/rooms/${created.roomId}/assets?path=${encodeURIComponent(assetRelativePath)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer()).byteLength).toBeGreaterThan(
        0,
      );
    } finally {
      await server.close();
    }
  });

  it("uploads room chat images as room assets and serves them back through the asset route", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-upload-asset-"));
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-http-upload-asset-project-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Uploaded Asset API",
      templateId: "template-product-pod",
      path: projectRoot,
    });
    const imageBody = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9oZx2kcAAAAASUVORK5CYII=",
      "base64",
    );
    const server = await startWorkspaceHttpServer({
      runtime,
      host: "127.0.0.1",
      port: await reservePort(),
    });

    try {
      const uploadResponse = await fetch(
        `http://127.0.0.1:${server.port}/api/rooms/${created.roomId}/assets?fileName=${encodeURIComponent("Flow Diagram.png")}`,
        {
          method: "POST",
          headers: {
            "content-type": "image/png",
          },
          body: imageBody,
        },
      );

      expect(uploadResponse.status).toBe(200);
      const payload = await uploadResponse.json() as { path: string; markdown: string };

      expect(payload.path).toContain(`.openaquarium/interactive/rooms/${created.roomId}/assets/user-chat/`);
      expect(payload.markdown).toContain(`![Flow Diagram](${payload.path})`);

      const readResponse = await fetch(
        `http://127.0.0.1:${server.port}/api/rooms/${created.roomId}/assets?path=${encodeURIComponent(payload.path)}`,
      );

      expect(readResponse.status).toBe(200);
      expect(readResponse.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await readResponse.arrayBuffer())).toEqual(imageBody);
    } finally {
      await server.close();
    }
  });

  it("imports an existing project through the JSON API without requiring templateId", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-http-import-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-http-import-project-"),
    );
    const seedSnapshot = createSeedWorkspace();
    const seedRoom = seedSnapshot.rooms[seedSnapshot.selection.roomId!];
    const seedProject = {
      ...seedSnapshot.projects[seedRoom.projectId],
      path: projectRoot,
    };

    seedSnapshot.projects[seedProject.id] = seedProject;

    await syncRoomContextFiles({
      workspaceRoot,
      next: seedSnapshot,
    });

    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const result = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/projects",
      body: {
        projectName: "HTTP Imported",
        path: projectRoot,
      },
    });
    const payload = result?.payload as {
      projectId: string;
      roomId: string;
      snapshot: {
        projects: Record<string, { name: string; path?: string }>;
        rooms: Record<string, { name: string; memberIds: string[] }>;
        selection: { projectId?: string; roomId?: string };
      };
    };

    expect(result?.statusCode).toBe(200);
    expect(payload.projectId).toBe(payload.snapshot.selection.projectId);
    expect(payload.roomId).toBe(payload.snapshot.selection.roomId);
    expect(payload.snapshot.projects[payload.projectId]?.name).toBe(
      "HTTP Imported",
    );
    expect(payload.snapshot.projects[payload.projectId]?.path).toBe(projectRoot);
    expect(payload.snapshot.rooms[payload.roomId]?.name).toBe(seedRoom.name);
    expect(payload.snapshot.rooms[payload.roomId]?.memberIds).toHaveLength(
      seedRoom.memberIds.length,
    );
  });

  it("accepts room human handles for internal direct member messages", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-human-direct-"));
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createSeedWorkspace(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const snapshot = runtime.getSnapshot();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const memberId = room.entryMemberId;

    snapshot.humans = {
      ...(snapshot.humans ?? {}),
      human_alice: {
        id: "human_alice",
        roomId,
        displayName: "Alice",
        handle: "alice",
        kind: "human",
      },
    };
    snapshot.humanOrderByRoom = {
      ...(snapshot.humanOrderByRoom ?? {}),
      [roomId]: [...(snapshot.humanOrderByRoom?.[roomId] ?? []), "human_alice"],
    };

    const result = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: "/api/internal/member-message",
      body: {
        roomId,
        memberId,
        content: "请确认 path",
        targetHandle: "alice",
      },
    });

    expect(result?.statusCode).toBe(200);

    const payload = result?.payload as {
      snapshot: {
        messageOrderByRoom: Record<string, string[]>;
        messages: Record<string, { transport: string; recipientHumanIds?: string[]; content: string }>;
      };
    };
    const messageId = payload.snapshot.messageOrderByRoom[roomId]?.at(-1);

    expect(messageId).toBeTruthy();
    expect(payload.snapshot.messages[messageId!]).toMatchObject({
      content: "请确认 path",
      transport: "direct",
      recipientHumanIds: ["human_alice"],
    });
  });

  it("accepts authorHumanId and directHumanId for room user messages", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-user-human-chain-"));
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

    const result = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/rooms/${roomId}/messages`,
      body: {
        content: "只发给 Bob",
        authorHumanId: "human_alice",
        directHumanId: "human_bob",
      },
    });

    expect(result?.statusCode).toBe(200);

    const payload = result?.payload as {
      snapshot: {
        messageOrderByRoom: Record<string, string[]>;
        messages: Record<string, {
          content: string;
          transport: string;
          author: { humanId?: string; handle?: string; label?: string };
          recipientHumanIds?: string[];
        }>;
      };
    };
    const messageId = payload.snapshot.messageOrderByRoom[roomId]?.at(-1);

    expect(messageId).toBeTruthy();
    expect(payload.snapshot.messages[messageId!]).toMatchObject({
      content: "只发给 Bob",
      transport: "direct",
      author: {
        humanId: "human_alice",
        handle: "alice",
        label: "Alice",
      },
      recipientHumanIds: ["human_bob"],
    });
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
