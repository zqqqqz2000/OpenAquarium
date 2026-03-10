import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { createUIMessageStream, pipeUIMessageStreamToResponse, validateUIMessages } from "ai";
import { WebSocketServer } from "ws";

import type { WorkspaceUIMessage } from "@/lib/chat/workspace-ui-message";
import { extractLastUserText } from "@/lib/chat/workspace-ui-message";
import type { DiagnosticsLogger } from "./diagnostics";
import { summarizeWorkspaceSnapshot } from "./diagnostics";
import type { WorkspaceRuntime } from "./runtime";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { buildTransportSnapshot } from "./transport-snapshot";

type JsonPayload = object | string | number | boolean | null;

function normalizeChunk(chunk: Buffer | string | Uint8Array): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }

  if (typeof chunk === "string") {
    return Buffer.from(chunk, "utf8");
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }

  throw new Error("Unexpected request body chunk");
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(normalizeChunk(chunk as Buffer | string | Uint8Array));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return (body ? JSON.parse(body) : {}) as T;
}

function sendJson(response: ServerResponse, statusCode: number, payload: JsonPayload): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.end(JSON.stringify(payload));
}

export async function handleWorkspaceJsonApiRequest(args: {
  runtime: WorkspaceRuntime;
  method: string;
  pathname: string;
  body?: JsonPayload;
}): Promise<{ statusCode: number; payload: JsonPayload } | undefined> {
  const { runtime, method, pathname, body } = args;

  if (method === "GET" && pathname === "/api/state") {
    return {
      statusCode: 200,
      payload: { snapshot: runtime.getSnapshot() },
    };
  }

  if (method === "POST" && pathname === "/api/projects") {
    const created = await runtime.createProject(body as { projectName: string; firstPrompt: string; templateId: string });
    return {
      statusCode: 200,
      payload: created,
    };
  }

  const projectRoomsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/rooms$/u);
  if (method === "POST" && projectRoomsMatch) {
    const [, projectId] = projectRoomsMatch;
    if (!projectId) {
      return {
        statusCode: 400,
        payload: { error: "Missing project id" },
      };
    }

    const created = await runtime.createRoom({
      projectId,
      firstPrompt: (body as { firstPrompt: string }).firstPrompt,
      templateId: (body as { templateId: string }).templateId,
    });
    return {
      statusCode: 200,
      payload: created,
    };
  }

  if (method === "POST" && pathname === "/api/templates/generate") {
    const template = await runtime.generateTemplate((body as { brief: string }).brief);
    return {
      statusCode: 200,
      payload: { template, snapshot: runtime.getSnapshot() },
    };
  }

  const roomMessageMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/u);
  if (method === "POST" && roomMessageMatch) {
    const [, roomId] = roomMessageMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }
    const snapshot = await runtime.sendUserMessage({
      roomId,
      content: (body as { content: string }).content,
      directMemberId: (body as { directMemberId?: string }).directMemberId,
    });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  if (method === "POST" && pathname === "/api/internal/member-message") {
    const parsedBody = body as {
      roomId: string;
      memberId: string;
      content: string;
      directMemberId?: string;
      targetHandle?: string;
      taskId?: string;
    };
    const room = runtime.getSnapshot().rooms[parsedBody.roomId];
    const directMemberId =
      parsedBody.directMemberId ??
      room?.memberIds
        .map((memberId) => runtime.getSnapshot().members[memberId])
        .find((member) => member.handle === parsedBody.targetHandle?.replace(/^@/u, ""))?.id;
    const snapshot = await runtime.sendMemberMessage({
      ...parsedBody,
      directMemberId,
    });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const promptMatch = pathname.match(/^\/api\/members\/([^/]+)\/prompt$/u);
  if (method === "POST" && promptMatch) {
    const [, memberId] = promptMatch;
    if (!memberId) {
      return {
        statusCode: 400,
        payload: { error: "Missing member id" },
      };
    }
    const snapshot = await runtime.updatePrompt(memberId, (body as { prompt: string }).prompt);
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const configMatch = pathname.match(/^\/api\/members\/([^/]+)\/config$/u);
  if (method === "POST" && configMatch) {
    const [, memberId] = configMatch;
    if (!memberId) {
      return {
        statusCode: 400,
        payload: { error: "Missing member id" },
      };
    }
    const snapshot = await runtime.updateMemberConfig({
      memberId,
      ...(body as {
        summary: string;
        prompt: string;
        acceptsDirectMessages: boolean;
        skills: Array<{ id: string; name: string; description: string; command: string }>;
        provider: {
          kind: "codex-acp" | "generic-acp";
          label: string;
          command: string;
          args: string[];
          env: Record<string, string>;
          workingDirectory?: string;
          capabilities: string[];
        };
      }),
    });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const entryMatch = pathname.match(/^\/api\/members\/([^/]+)\/entry$/u);
  if (method === "POST" && entryMatch) {
    const [, memberId] = entryMatch;
    if (!memberId) {
      return {
        statusCode: 400,
        payload: { error: "Missing member id" },
      };
    }
    const snapshot = await runtime.setEntryMember(memberId);
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const watcherConfigMatch = pathname.match(/^\/api\/members\/([^/]+)\/watcher$/u);
  if (method === "POST" && watcherConfigMatch) {
    const [, memberId] = watcherConfigMatch;
    if (!memberId) {
      return {
        statusCode: 400,
        payload: { error: "Missing member id" },
      };
    }
    const snapshot = await runtime.upsertWatcher({
      memberId,
      enabled: (body as { enabled: boolean }).enabled,
      intervalMinutes: (body as { intervalMinutes: number }).intervalMinutes,
    });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const monitorMatch = pathname.match(/^\/api\/members\/([^/]+)\/monitor-toggle$/u);
  if (method === "POST" && monitorMatch) {
    const [, memberId] = monitorMatch;
    if (!memberId) {
      return {
        statusCode: 400,
        payload: { error: "Missing member id" },
      };
    }
    const snapshot = await runtime.toggleMemberMonitoring(memberId);
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const watcherToggleMatch = pathname.match(/^\/api\/watchers\/([^/]+)\/toggle$/u);
  if (method === "POST" && watcherToggleMatch) {
    const [, watcherId] = watcherToggleMatch;
    if (!watcherId) {
      return {
        statusCode: 400,
        payload: { error: "Missing watcher id" },
      };
    }
    const snapshot = await runtime.toggleWatcher(watcherId);
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const watcherRunMatch = pathname.match(/^\/api\/watchers\/([^/]+)\/run$/u);
  if (method === "POST" && watcherRunMatch) {
    const [, watcherId] = watcherRunMatch;
    if (!watcherId) {
      return {
        statusCode: 400,
        payload: { error: "Missing watcher id" },
      };
    }
    const snapshot = await runtime.runWatcherNow(watcherId);
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  return undefined;
}

export async function startWorkspaceHttpServer(args: {
  runtime: WorkspaceRuntime;
  port: number;
  host?: string;
  logger?: DiagnosticsLogger;
}): Promise<{ port: number; close(): Promise<void> }> {
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);

    try {
      response.setHeader("access-control-allow-origin", "*");
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");

      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.end();
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        const payload = { snapshot: buildTransportSnapshot(args.runtime.getSnapshot()) };
        if (args.logger?.shouldLog("api-state", 1_000) ?? false) {
          args.logger?.info("api-state", {
            bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
            ...summarizeWorkspaceSnapshot(payload.snapshot),
          });
        }
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await readJson<{ projectName: string; firstPrompt: string; templateId: string }>(request);
        const created = await args.runtime.createProject(body);
        sendJson(response, 200, {
          ...created,
          snapshot: buildTransportSnapshot(created.snapshot),
        });
        return;
      }

      const projectRoomsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/rooms$/u);
      if (request.method === "POST" && projectRoomsMatch) {
        const [, projectId] = projectRoomsMatch;
        if (!projectId) {
          sendJson(response, 400, { error: "Missing project id" });
          return;
        }
        const body = await readJson<{ firstPrompt: string; templateId: string }>(request);
        const created = await args.runtime.createRoom({
          projectId,
          firstPrompt: body.firstPrompt,
          templateId: body.templateId,
        });
        sendJson(response, 200, {
          ...created,
          snapshot: buildTransportSnapshot(created.snapshot),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/templates/generate") {
        const body = await readJson<{ brief: string }>(request);
        const template = await args.runtime.generateTemplate(body.brief);
        sendJson(response, 200, { template, snapshot: buildTransportSnapshot(args.runtime.getSnapshot()) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson<{
          messages: WorkspaceUIMessage[];
          roomId: string;
          directMemberId?: string;
        }>(request);

        if (!body.roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }

        const messages = await validateUIMessages<WorkspaceUIMessage>({
          messages: body.messages ?? [],
        });
        const content = extractLastUserText(messages);
        if (content.length === 0) {
          sendJson(response, 400, { error: "Missing user message content" });
          return;
        }

        const stream = createUIMessageStream<WorkspaceUIMessage>({
          async execute({ writer }) {
            await args.runtime.streamUserMessage(
              {
                roomId: body.roomId,
                content,
                directMemberId: body.directMemberId,
              },
              {
                onTaskAccepted(route) {
                  writer.write({
                    type: "data-taskRoute",
                    transient: true,
                    data: route,
                  });
                },
                onDraft(event) {
                  void event;
                },
                onStatus(event) {
                  writer.write({
                    type: "data-taskStatus",
                    transient: true,
                    data: {
                      taskId: event.taskId,
                      memberId: event.memberId,
                      summary: event.summary,
                    },
                  });
                },
                onComplete(event) {
                  void event;
                },
                onError() {
                  writer.write({
                    type: "data-notification",
                    transient: true,
                    data: {
                      level: "error",
                      message: "当前成员执行失败，请打开成员 Session 查看详情。",
                    },
                  });
                },
              },
            );
          },
        });

        pipeUIMessageStreamToResponse({
          response,
          stream,
        });
        return;
      }

      const roomMessageMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/messages$/u);
      if (request.method === "POST" && roomMessageMatch) {
        const [, roomId] = roomMessageMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }
        const body = await readJson<{ content: string; directMemberId?: string }>(request);
        const snapshot = await args.runtime.sendUserMessage({
          roomId,
          content: body.content,
          directMemberId: body.directMemberId,
        });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/internal/member-message") {
        const body = await readJson<{
          roomId: string;
          memberId: string;
          content: string;
          directMemberId?: string;
          targetHandle?: string;
          taskId?: string;
        }>(request);
        const room = args.runtime.getSnapshot().rooms[body.roomId];
        const directMemberId =
          body.directMemberId ??
          room?.memberIds
            .map((memberId) => args.runtime.getSnapshot().members[memberId])
            .find((member) => member.handle === body.targetHandle?.replace(/^@/u, ""))?.id;
        const snapshot = await args.runtime.sendMemberMessage({
          ...body,
          directMemberId,
        });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const promptMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/prompt$/u);
      if (request.method === "POST" && promptMatch) {
        const [, memberId] = promptMatch;
        if (!memberId) {
          sendJson(response, 400, { error: "Missing member id" });
          return;
        }
        const body = await readJson<{ prompt: string }>(request);
        const snapshot = await args.runtime.updatePrompt(memberId, body.prompt);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const configMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/config$/u);
      if (request.method === "POST" && configMatch) {
        const [, memberId] = configMatch;
        if (!memberId) {
          sendJson(response, 400, { error: "Missing member id" });
          return;
        }
        const body = await readJson<{
          summary: string;
          prompt: string;
          acceptsDirectMessages: boolean;
          skills: Array<{ id: string; name: string; description: string; command: string }>;
          provider: {
            kind: "codex-acp" | "generic-acp";
            label: string;
            command: string;
            args: string[];
            env: Record<string, string>;
            workingDirectory?: string;
            capabilities: string[];
          };
        }>(request);
        const snapshot = await args.runtime.updateMemberConfig({
          memberId,
          ...body,
        });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const entryMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/entry$/u);
      if (request.method === "POST" && entryMatch) {
        const [, memberId] = entryMatch;
        if (!memberId) {
          sendJson(response, 400, { error: "Missing member id" });
          return;
        }
        const snapshot = await args.runtime.setEntryMember(memberId);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const watcherConfigMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/watcher$/u);
      if (request.method === "POST" && watcherConfigMatch) {
        const [, memberId] = watcherConfigMatch;
        if (!memberId) {
          sendJson(response, 400, { error: "Missing member id" });
          return;
        }
        const body = await readJson<{ enabled: boolean; intervalMinutes: number }>(request);
        const snapshot = await args.runtime.upsertWatcher({
          memberId,
          enabled: body.enabled,
          intervalMinutes: body.intervalMinutes,
        });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const monitorMatch = url.pathname.match(/^\/api\/members\/([^/]+)\/monitor-toggle$/u);
      if (request.method === "POST" && monitorMatch) {
        const [, memberId] = monitorMatch;
        if (!memberId) {
          sendJson(response, 400, { error: "Missing member id" });
          return;
        }
        const snapshot = await args.runtime.toggleMemberMonitoring(memberId);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const watcherToggleMatch = url.pathname.match(/^\/api\/watchers\/([^/]+)\/toggle$/u);
      if (request.method === "POST" && watcherToggleMatch) {
        const [, watcherId] = watcherToggleMatch;
        if (!watcherId) {
          sendJson(response, 400, { error: "Missing watcher id" });
          return;
        }
        const snapshot = await args.runtime.toggleWatcher(watcherId);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const watcherRunMatch = url.pathname.match(/^\/api\/watchers\/([^/]+)\/run$/u);
      if (request.method === "POST" && watcherRunMatch) {
        const [, watcherId] = watcherRunMatch;
        if (!watcherId) {
          sendJson(response, 400, { error: "Missing watcher id" });
          return;
        }
        const snapshot = await args.runtime.runWatcherNow(watcherId);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, {
        error: getErrorMessage(error as RuntimeError),
      });
    }
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  const socketServer = new WebSocketServer({
    server,
    path: "/ws",
  });
  let pendingSnapshot = args.runtime.getSnapshot();
  let pendingBroadcastTimer: ReturnType<typeof setTimeout> | undefined;
  const broadcastSnapshot = (snapshot: typeof pendingSnapshot): void => {
    const transportSnapshot = buildTransportSnapshot(snapshot);
    const payload = JSON.stringify({
      type: "snapshot",
      snapshot: transportSnapshot,
    });
    const clientCount = [...socketServer.clients].filter((client) => client.readyState === client.OPEN).length;
    socketServer.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    });
    if ((args.logger?.shouldLog("ws-broadcast", 1000) ?? false) || payload.length > 500_000) {
      args.logger?.info("ws-broadcast", {
        bytes: payload.length,
        clients: clientCount,
        ...summarizeWorkspaceSnapshot(transportSnapshot),
      });
    }
  };
  const scheduleSnapshotBroadcast = (snapshot: typeof pendingSnapshot): void => {
    pendingSnapshot = snapshot;
    if (pendingBroadcastTimer) {
      return;
    }

    pendingBroadcastTimer = setTimeout(() => {
      pendingBroadcastTimer = undefined;
      broadcastSnapshot(pendingSnapshot);
    }, 80);
  };
  const unsubscribe = args.runtime.subscribe((snapshot) => {
    scheduleSnapshotBroadcast(snapshot);
  });

  socketServer.on("connection", (client) => {
    const transportSnapshot = buildTransportSnapshot(args.runtime.getSnapshot());
    client.send(
      JSON.stringify({
        type: "snapshot",
        snapshot: transportSnapshot,
      }),
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(args.port, args.host ?? "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : args.port;

  return {
    port,
    async close() {
      unsubscribe();
      if (pendingBroadcastTimer) {
        clearTimeout(pendingBroadcastTimer);
        pendingBroadcastTimer = undefined;
      }
      socketServer.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
