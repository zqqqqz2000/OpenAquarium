// @vitest-environment node

import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND } from "@/lib/acp";
import { WorkspacePersistence } from "@/server/persistence";
import { handleWorkspaceJsonApiRequest } from "@/server/http-server";
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

describe("workspace http api routing", () => {
  const runtimes: WorkspaceRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
  });

  it("serves state and accepts member/message configuration mutations", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-http-"));
    const executorFactory: MemberExecutorFactory = () => new EchoExecutor();
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(path.join(workspaceRoot, ".openaquarium", "state.json")),
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
            observeAllRoomMessages: true,
            skills: [
              {
                id: "send",
                name: "发送消息",
                description: "发群消息",
                command: "./bin/oa-room-send --scope group",
              },
            ],
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
            skills: [
              {
                id: "inspect",
                name: "查看状态",
                description: "检查 room 状态",
                command: "./bin/oa-room-state --room \"$ROOM\"",
              },
            ],
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
    };
    const projectId = statePayload.snapshot.selection.projectId;
    const roomId = statePayload.snapshot.selection.roomId;
    expect(projectId).toBeDefined();
    expect(roomId).toBeDefined();
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
    const builderId = room.memberIds[2];
    expect(builderId).toBeDefined();
    if (!builderId) {
      throw new Error("Expected builder id");
    }

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

    const configResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/config`,
      body: {
        summary: "Builder v2",
        prompt: "新的 builder prompt",
        acceptsDirectMessages: false,
        skills: [
          {
            id: "ship",
            name: "Ship",
            description: "发送群消息",
            command: "./bin/oa-room-send --scope group",
          },
        ],
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
    const configPayload = configResult?.payload as { snapshot: { members: Record<string, { provider: { command: string }; summary: string }> } };

    const entryResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/entry`,
    });
    const entryPayload = entryResult?.payload as { snapshot: { rooms: Record<string, { entryMemberId: string }> } };

    const watcherResult = await handleWorkspaceJsonApiRequest({
      runtime,
      method: "POST",
      pathname: `/api/members/${builderId}/watcher`,
      body: {
        enabled: true,
        intervalMinutes: 6,
      },
    });
    const watcherPayload = watcherResult?.payload as {
      snapshot: {
        rooms: Record<string, { watcherIds: string[] }>;
        watchers: Record<string, { memberId: string; intervalMinutes: number }>;
      };
    };

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

    expect(contents.some((content) => content.includes("@builder"))).toBe(true);
    expect(configPayload.snapshot.members[builderId]?.provider.command).toBe("claude-code");
    expect(configPayload.snapshot.members[builderId]?.summary).toBe("Builder v2");
    expect(entryPayload.snapshot.rooms[roomId].entryMemberId).toBe(builderId);
    expect(
      watcherPayload.snapshot.rooms[roomId].watcherIds.some(
        (watcherId) => watcherPayload.snapshot.watchers[watcherId]?.memberId === builderId
          && watcherPayload.snapshot.watchers[watcherId]?.intervalMinutes === 6,
      ),
    ).toBe(true);
    expect(templatePayload.template.id).toBe("template-http-generated");
    expect(templatePayload.snapshot.templates["template-http-generated"]?.description).toBe("生成一个新的协作模板");
    expect(createRoomPayload.snapshot.rooms[createRoomPayload.roomId]?.projectId).toBe(projectId);
    expect(createRoomPayload.snapshot.rooms[createRoomPayload.roomId]?.name).toBe("New room");
    expect(createRoomPayload.snapshot.rooms[createRoomPayload.roomId]?.topic).toBe("");
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
});
