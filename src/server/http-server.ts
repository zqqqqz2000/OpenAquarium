import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { WebSocketServer } from "ws";

import type { WorkspaceRuntime } from "./runtime";
import { getErrorMessage } from "./error-utils";

function normalizeChunk(chunk: unknown): Buffer {
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
    chunks.push(normalizeChunk(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return (body ? JSON.parse(body) : {}) as T;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.end(JSON.stringify(payload));
}

export async function startWorkspaceHttpServer(args: {
  runtime: WorkspaceRuntime;
  port: number;
  host?: string;
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
        sendJson(response, 200, { snapshot: args.runtime.getSnapshot() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await readJson<{ projectName: string; firstPrompt: string; templateId: string }>(request);
        const created = await args.runtime.createProject(body);
        sendJson(response, 200, created);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/templates/generate") {
        const body = await readJson<{ brief: string }>(request);
        const template = await args.runtime.generateTemplate(body.brief);
        sendJson(response, 200, { template, snapshot: args.runtime.getSnapshot() });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
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
        sendJson(response, 200, { snapshot });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, 500, {
        error: getErrorMessage(error),
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
  const unsubscribe = args.runtime.subscribe((snapshot) => {
    const payload = JSON.stringify({
      type: "snapshot",
      snapshot,
    });
    socketServer.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    });
  });

  socketServer.on("connection", (client) => {
    client.send(
      JSON.stringify({
        type: "snapshot",
        snapshot: args.runtime.getSnapshot(),
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
