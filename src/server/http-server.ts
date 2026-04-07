import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";

import { createUIMessageStream, pipeUIMessageStreamToResponse, validateUIMessages } from "ai";
import { WebSocketServer } from "ws";

import type { UpdateGlobalConfigInput } from "@/domain/model";
import type { WorkspaceUIMessage } from "@/lib/chat/workspace-ui-message";
import type { ModelProfileDraft } from "@/lib/global-config-draft";
import { extractLastUserText } from "@/lib/chat/workspace-ui-message";
import { resolveDirectTarget } from "@/lib/direct-target";
import type { TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";
import type { DiagnosticsLogger } from "./diagnostics";
import { summarizeWorkspaceSnapshot } from "./diagnostics";
import { ForbiddenRuntimeError, UnauthorizedRuntimeError, type WorkspaceRuntime } from "./runtime";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { buildTransportSnapshot } from "./transport-snapshot";

type JsonPayload = object | string | number | boolean | null;
type ProjectDirectoryBrowsePayload = { path?: string };
type JsonApiResponse = { statusCode: number; payload: JsonPayload; headers?: Record<string, string> };
const SESSION_COOKIE_NAME = "oa_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const CORS_ALLOWED_HEADERS = "content-type, authorization, x-openaquarium-session";
const CORS_ALLOWED_METHODS = "GET,POST,DELETE,OPTIONS";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function containsLegacyFirstPrompt(payload: JsonPayload | undefined): boolean {
  return typeof payload === "object" && payload !== null && Object.prototype.hasOwnProperty.call(payload, "firstPrompt");
}

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

async function readRequestBodyBuffer(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(normalizeChunk(chunk as Buffer | string | Uint8Array));
  }

  return Buffer.concat(chunks);
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader?.trim()) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) {
          return [part, ""];
        }
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function resolveSessionToken(headers?: Record<string, string | string[] | undefined>): string | undefined {
  if (!headers) {
    return undefined;
  }

  const authorization = getFirstHeaderValue(headers.authorization ?? headers.Authorization);
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || undefined;
  }

  const directHeader = getFirstHeaderValue(headers["x-openaquarium-session"] ?? headers["X-OpenAquarium-Session"]);
  if (directHeader?.trim()) {
    return directHeader.trim();
  }

  return parseCookies(getFirstHeaderValue(headers.cookie ?? headers.Cookie))[SESSION_COOKIE_NAME];
}

function normalizeOrigin(origin: string | undefined): string | undefined {
  if (!origin?.trim()) {
    return undefined;
  }

  try {
    const normalized = new URL(origin).origin;
    return normalized === "null" ? undefined : normalized;
  } catch {
    return undefined;
  }
}

function resolveRequestOrigin(request: IncomingMessage): string | undefined {
  const host = request.headers.host?.trim();
  if (!host) {
    return undefined;
  }

  const forwardedProto = getFirstHeaderValue(request.headers["x-forwarded-proto"])
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const protocol = forwardedProto === "https" ? "https" : "http";
  return normalizeOrigin(`${protocol}://${host}`);
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function readConfiguredCorsOrigins(): Set<string> {
  return new Set(
    (process.env.OA_CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => normalizeOrigin(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );
}

function isLoopbackSplitOrigin(request: IncomingMessage, origin: string): boolean {
  const requestOrigin = resolveRequestOrigin(request);
  return Boolean(requestOrigin && isLoopbackOrigin(requestOrigin) && isLoopbackOrigin(origin));
}

function resolveAllowedCorsOrigin(request: IncomingMessage): string | undefined {
  const origin = normalizeOrigin(getFirstHeaderValue(request.headers.origin));
  if (!origin) {
    return undefined;
  }

  if (origin === resolveRequestOrigin(request)) {
    return origin;
  }

  if (isLoopbackSplitOrigin(request, origin)) {
    return origin;
  }

  return readConfiguredCorsOrigins().has(origin) ? origin : undefined;
}

function appendVaryHeader(response: ServerResponse, value: string): void {
  const currentValue = response.getHeader("vary");
  const existingValues = `${currentValue ?? ""}`
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (!existingValues.includes(value)) {
    existingValues.push(value);
  }

  if (existingValues.length > 0) {
    response.setHeader("vary", existingValues.join(", "));
  }
}

function applyCorsHeaders(response: ServerResponse, request: IncomingMessage, allowedOrigin: string | undefined): void {
  response.setHeader("access-control-allow-headers", CORS_ALLOWED_HEADERS);
  response.setHeader("access-control-allow-methods", CORS_ALLOWED_METHODS);

  const privateNetworkRequest = getFirstHeaderValue(request.headers["access-control-request-private-network"])
    ?.trim()
    .toLowerCase();
  if (privateNetworkRequest === "true") {
    response.setHeader("access-control-allow-private-network", "true");
  }

  if (allowedOrigin) {
    response.setHeader("access-control-allow-origin", allowedOrigin);
    response.setHeader("access-control-allow-credentials", "true");
    appendVaryHeader(response, "Origin");
    return;
  }

  if (!getFirstHeaderValue(request.headers.origin)) {
    response.setHeader("access-control-allow-origin", "*");
  }
}

function buildSessionCookie(sessionToken: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;
}

function buildClearedSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function isMyProjectMembershipsPath(pathname: string): boolean {
  return pathname === "/api/me/projects" || pathname === "/api/me/project-members";
}

function getStatusCodeForError(error: unknown): number {
  if (error instanceof UnauthorizedRuntimeError) {
    return 401;
  }
  if (error instanceof ForbiddenRuntimeError) {
    return 403;
  }

  return 500;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: JsonPayload,
  headers: Record<string, string> = {},
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  Object.entries(headers).forEach(([key, value]) => {
    response.setHeader(key, value);
  });
  response.end(JSON.stringify(payload));
}

export async function handleWorkspaceJsonApiRequest(args: {
  runtime: WorkspaceRuntime;
  method: string;
  pathname: string;
  body?: JsonPayload;
  searchParams?: URLSearchParams;
  headers?: Record<string, string | undefined>;
}): Promise<JsonApiResponse | undefined> {
  const { runtime, method, pathname, body, searchParams, headers } = args;
  const sessionToken = resolveSessionToken(headers);

  try {

    if (method === "POST" && pathname === "/api/auth/login") {
      const result = await runtime.login(body as { handle: string; password: string; displayName?: string });
      return {
        statusCode: 200,
        payload: result,
        headers: result.sessionToken ? { "set-cookie": buildSessionCookie(result.sessionToken) } : undefined,
      };
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      const result = await runtime.logout({
        sessionToken: sessionToken ?? (body as { sessionToken?: string } | undefined)?.sessionToken,
      });
      return {
        statusCode: 200,
        payload: result,
        headers: { "set-cookie": buildClearedSessionCookie() },
      };
    }

    if (method === "GET" && pathname === "/api/auth/session") {
      return {
        statusCode: 200,
        payload: await runtime.restoreSession({ sessionToken }),
      };
    }

    if (method === "GET" && pathname === "/api/me") {
      return {
        statusCode: 200,
        payload: await runtime.getMe({ sessionToken }),
      };
    }

    if (method === "POST" && pathname === "/api/me") {
      return {
        statusCode: 200,
        payload: await runtime.updateMe({
          sessionToken,
          ...((body as { handle?: string; displayName?: string } | undefined) ?? {}),
        }),
      };
    }

    if (method === "GET" && isMyProjectMembershipsPath(pathname)) {
      return {
        statusCode: 200,
        payload: await runtime.listMyProjectMemberships({ sessionToken }),
      };
    }

    if (method === "GET" && pathname === "/api/admin/users") {
      return {
        statusCode: 200,
        payload: await runtime.listManagedUsers({ sessionToken }),
      };
    }

    if (method === "POST" && pathname === "/api/admin/users") {
      return {
        statusCode: 200,
        payload: await runtime.createManagedUser({
          sessionToken,
          ...((body as { handle: string; displayName: string; password: string; isAdmin?: boolean } | undefined) ?? {
            handle: "",
            displayName: "",
            password: "",
          }),
        }),
      };
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/u);
    if (method === "POST" && adminUserMatch) {
      const [, userId] = adminUserMatch;
      if (!userId) {
        return {
          statusCode: 400,
          payload: { error: "Missing user id" },
        };
      }

      return {
        statusCode: 200,
        payload: await runtime.updateManagedUser({
          sessionToken,
          userId,
          ...((body as { handle?: string; displayName?: string; password?: string; isAdmin?: boolean } | undefined) ?? {}),
        }),
      };
    }

    if (method === "POST" && pathname === "/api/admin/project-memberships") {
      return {
        statusCode: 200,
        payload: await runtime.setManagedProjectMembership({
          sessionToken,
          ...((body as { userId: string; projectId: string; role?: "owner" | "admin" | "member"; remove?: boolean } | undefined) ?? {
            userId: "",
            projectId: "",
          }),
        }),
      };
    }

    if (method === "GET" && pathname === "/api/state") {
      const state = await runtime.getClientState({ sessionToken });
      return {
        statusCode: 200,
        payload: { snapshot: state.snapshot, globalConfig: runtime.getGlobalConfig(), auth: state.auth },
      };
    }

  if (method === "GET" && pathname === "/api/config") {
    return {
      statusCode: 200,
      payload: { globalConfig: runtime.getGlobalConfig() },
    };
  }

  if (method === "GET" && pathname === "/api/template-studio/models") {
    return {
      statusCode: 200,
      payload: await runtime.getTemplateStudioModelCatalog((body as { modelProfileId?: string } | undefined) ?? {}, { sessionToken }),
    };
  }

  if (method === "POST" && pathname === "/api/provider-profiles/model-catalog") {
    return {
      statusCode: 200,
      payload: await runtime.getProviderProfileModelCatalog(body as { draft: ModelProfileDraft }, { sessionToken }),
    };
  }

  if (method === "POST" && pathname === "/api/provider-profiles/test") {
    return {
      statusCode: 200,
      payload: await runtime.testProviderProfile(body as { draft: ModelProfileDraft; modelId?: string }, { sessionToken }),
    };
  }

  if (method === "GET" && pathname === "/api/skills") {
    return {
      statusCode: 200,
      payload: { skills: await runtime.listSkillCatalog() },
    };
  }

  const roomHistoryMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/history$/u);
  if (method === "GET" && roomHistoryMatch) {
    const [, roomId] = roomHistoryMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }

    const beforeMessageId = searchParams?.get("before") ?? undefined;
    const limitParam = searchParams?.get("limit");
    const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    return {
      statusCode: 200,
      payload: await runtime.getRoomMessageHistoryPage({
        roomId,
        beforeMessageId,
        limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        sessionToken,
      }),
    };
  }

  const roomTodoTreeMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/todo-trees$/u);
  if (method === "GET" && roomTodoTreeMatch) {
    const [, roomId] = roomTodoTreeMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }

    return {
      statusCode: 200,
      payload: await runtime.getRoomTodoTrees({
        roomId,
        sessionToken,
      }),
    };
  }

  if (method === "POST" && pathname === "/api/system/project-path/browse") {
    return {
      statusCode: 200,
      payload: await runtime.browseProjectDirectory((body as ProjectDirectoryBrowsePayload | undefined) ?? {}),
    };
  }

  if (method === "POST" && pathname === "/api/system/project-path/inspect") {
    return {
      statusCode: 200,
      payload: await runtime.inspectProjectPath(body as { path: string }),
    };
  }

  if (method === "POST" && pathname === "/api/projects") {
    if (containsLegacyFirstPrompt(body)) {
      return {
        statusCode: 400,
        payload: { error: "firstPrompt is no longer supported. Create the room first, then send the first message." },
      };
    }
    const created = await runtime.createProject(
      body as { projectName: string; templateId?: string; path?: string },
      { sessionToken },
    );
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
    if (containsLegacyFirstPrompt(body)) {
      return {
        statusCode: 400,
        payload: { error: "firstPrompt is no longer supported. Create the room first, then send the first message." },
      };
    }

    const created = await runtime.createRoom({
      projectId,
      templateId: (body as { templateId: string }).templateId,
    }, { sessionToken });
    return {
      statusCode: 200,
      payload: created,
    };
  }

  const projectMembersMatch = pathname.match(/^\/api\/projects\/([^/]+)\/members$/u);
  if (method === "GET" && projectMembersMatch) {
    const [, projectId] = projectMembersMatch;
    if (!projectId) {
      return {
        statusCode: 400,
        payload: { error: "Missing project id" },
      };
    }

    return {
      statusCode: 200,
      payload: await runtime.getProjectMembers({ projectId, sessionToken }),
    };
  }

  if (method === "POST" && pathname === "/api/templates/generate") {
    const template = await runtime.generateTemplate((body as { brief: string }).brief, { sessionToken });
    return {
      statusCode: 200,
      payload: { template, snapshot: runtime.getSnapshot() },
    };
  }

  if (method === "POST" && pathname === "/api/template-studio/chat") {
    const result = await runtime.chatTemplateStudio(body as {
      templateId: string;
      messages: Array<{
        role: "user" | "assistant";
        content: string;
      }>;
      modelProfileId?: string;
      modelId?: string;
    }, { sessionToken });
    return {
      statusCode: 200,
      payload: result,
    };
  }

  const templateConfigMatch = pathname.match(/^\/api\/templates\/([^/]+)\/config$/u);
  if (method === "POST" && templateConfigMatch) {
    const [, templateId] = templateConfigMatch;
    if (!templateId) {
      return {
        statusCode: 400,
        payload: { error: "Missing template id" },
      };
    }
    const snapshot = await runtime.updateTemplate({
      templateId,
      ...(body as {
        name: string;
        description: string;
        accentTone: "paper" | "postit" | "blueprint" | "correction";
        defaultVisibleMemberBlueprintIds?: string[];
        members: Array<{
          id: string;
          name: string;
          handle: string;
          summary: string;
          prompt: string;
          accentTone: "paper" | "postit" | "blueprint" | "correction";
          allowedSkillIds: string[];
          provider: {
            kind: "codex-acp" | "generic-acp";
            label: string;
            command: string;
            args: string[];
            env: Record<string, string>;
            workingDirectory?: string;
            capabilities: string[];
          };
          isEntryMember?: boolean;
          acceptsDirectMessages?: boolean;
          watch?: {
            intervalMinutes: number;
            enabledByDefault: boolean;
          };
        }>;
      }),
    }, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const templateDeleteMatch = pathname.match(/^\/api\/templates\/([^/]+)$/u);
  if (method === "DELETE" && templateDeleteMatch) {
    const [, templateId] = templateDeleteMatch;
    if (!templateId) {
      return {
        statusCode: 400,
        payload: { error: "Missing template id" },
      };
    }
    const snapshot = await runtime.deleteTemplate(templateId, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  if (method === "POST" && pathname === "/api/config") {
    const globalConfig = await runtime.updateGlobalConfig(body as UpdateGlobalConfigInput, { sessionToken });
    return {
      statusCode: 200,
      payload: { globalConfig, snapshot: runtime.getSnapshot() },
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
      authorHumanId: (body as { authorHumanId?: string }).authorHumanId,
      directMemberId: (body as { directMemberId?: string }).directMemberId,
      directHumanId: (body as { directHumanId?: string }).directHumanId,
      sessionToken,
    });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const roomDeleteMatch = pathname.match(/^\/api\/rooms\/([^/]+)$/u);
  if (method === "DELETE" && roomDeleteMatch) {
    const [, roomId] = roomDeleteMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }
    const snapshot = await runtime.deleteRoom(roomId, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const roomReadMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/read$/u);
  if (method === "POST" && roomReadMatch) {
    const [, roomId] = roomReadMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }
    const snapshot = await runtime.acknowledgeRoom(roomId, sessionToken);
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const roomSettingsMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/settings$/u);
  if (method === "POST" && roomSettingsMatch) {
    const [, roomId] = roomSettingsMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }
    const snapshot = await runtime.updateRoomSettings({
      roomId,
      ...(body as {
        visibleMemberIds: string[];
      }),
    }, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const roomWatcherSuspensionToggleMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/watcher-suspension\/toggle$/u);
  if (method === "POST" && roomWatcherSuspensionToggleMatch) {
    const [, roomId] = roomWatcherSuspensionToggleMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }
    const snapshot = await runtime.toggleRoomWatcherSuspension(roomId, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const roomTeamMatch = pathname.match(/^\/api\/rooms\/([^/]+)\/team$/u);
  if (method === "POST" && roomTeamMatch) {
    const [, roomId] = roomTeamMatch;
    if (!roomId) {
      return {
        statusCode: 400,
        payload: { error: "Missing room id" },
      };
    }
    const snapshot = await runtime.updateRoomTeam({
      roomId,
      ...(body as {
        teamName: string;
        teamDescription: string;
        teamAccentTone: "paper" | "postit" | "blueprint" | "correction";
        members: Array<{
          memberId: string;
          name: string;
          handle: string;
          summary: string;
          prompt: string;
          accentTone: "paper" | "postit" | "blueprint" | "correction";
          modelProfileId?: string;
          allowedSkillIds: string[];
          provider: {
            kind: "codex-acp" | "generic-acp";
            label: string;
            command: string;
            args: string[];
            env: Record<string, string>;
            workingDirectory?: string;
            capabilities: string[];
          };
          isEntryMember?: boolean;
          acceptsDirectMessages?: boolean;
          watch?: {
            enabled: boolean;
            intervalMinutes: number;
          };
        }>;
      }),
    }, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const projectDeleteMatch = pathname.match(/^\/api\/projects\/([^/]+)$/u);
  if (method === "DELETE" && projectDeleteMatch) {
    const [, projectId] = projectDeleteMatch;
    if (!projectId) {
      return {
        statusCode: 400,
        payload: { error: "Missing project id" },
      };
    }
    const snapshot = await runtime.deleteProject(projectId, { sessionToken });
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
      directHumanId?: string;
      directToUser?: boolean;
      targetHandle?: string;
      taskId?: string;
    };
    const target =
      parsedBody.directMemberId || parsedBody.directHumanId || parsedBody.directToUser
        ? {
            directMemberId: parsedBody.directMemberId,
            directHumanId: parsedBody.directHumanId,
            directToUser: parsedBody.directToUser,
          }
        : resolveDirectTarget(runtime.getSnapshot(), parsedBody.roomId, parsedBody.targetHandle);
    if (parsedBody.targetHandle && !target.directMemberId && !target.directHumanId && !target.directToUser) {
      throw new Error(`Unknown direct target "${parsedBody.targetHandle}" in room "${parsedBody.roomId}"`);
    }
    const snapshot = await runtime.sendMemberMessage({
      ...parsedBody,
      ...target,
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
    const snapshot = await runtime.updatePrompt(memberId, (body as { prompt: string }).prompt, { sessionToken });
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
        isRole?: boolean;
        summary: string;
        prompt: string;
        modelProfileId?: string;
        acceptsDirectMessages: boolean;
        codexThinkingDepth?: "low" | "mid" | "high" | "extra-high";
        allowedSkillIds: string[];
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
    }, { sessionToken });
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
    const snapshot = await runtime.setEntryMember(memberId, { sessionToken });
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
      persistent: (body as { persistent?: boolean }).persistent ?? false,
      prompt: (body as { prompt?: string }).prompt,
    }, { sessionToken });
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
    const snapshot = await runtime.toggleWatcher(watcherId, { sessionToken });
    return {
      statusCode: 200,
      payload: { snapshot },
    };
  }

  const watcherPauseMatch = pathname.match(/^\/api\/watchers\/([^/]+)\/pause-until-activity$/u);
  if (method === "POST" && watcherPauseMatch) {
    const [, watcherId] = watcherPauseMatch;
    if (!watcherId) {
      return {
        statusCode: 400,
        payload: { error: "Missing watcher id" },
      };
    }
    const snapshot = await runtime.pauseWatcherUntilActivity(watcherId, { sessionToken });
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
    const result = await runtime.runWatcherNow(watcherId, { sessionToken });
    return {
      statusCode: 200,
      payload: result,
    };
  }

    return undefined;
  } catch (error) {
    return {
      statusCode: getStatusCodeForError(error),
      payload: { error: getErrorMessage(error as RuntimeError) },
    };
  }
}

export async function startWorkspaceHttpServer(args: {
  runtime: WorkspaceRuntime;
  port: number;
  host?: string;
  logger?: DiagnosticsLogger;
}): Promise<{ port: number; close(): Promise<void> }> {
  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const allowedOrigin = resolveAllowedCorsOrigin(request);
    applyCorsHeaders(response, request, allowedOrigin);

    if (!request.url || !request.method) {
      sendJson(response, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);
    const sessionToken = resolveSessionToken(request.headers);

    try {
      if (request.method === "OPTIONS") {
        response.statusCode = getFirstHeaderValue(request.headers.origin) && !allowedOrigin ? 403 : 204;
        response.end();
        return;
      }

      if (getFirstHeaderValue(request.headers.origin) && !allowedOrigin) {
        sendJson(response, 403, { error: "Origin not allowed" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/state") {
        const state = await args.runtime.getClientState({ sessionToken });
        const payload = {
          snapshot: buildTransportSnapshot(state.snapshot),
          globalConfig: args.runtime.getGlobalConfig(),
          auth: state.auth,
        };
        if (args.logger?.shouldLog("api-state", 1_000) ?? false) {
          args.logger?.info("api-state", {
            bytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
            ...summarizeWorkspaceSnapshot(payload.snapshot),
          });
        }
        sendJson(response, 200, payload);
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config") {
        sendJson(response, 200, { globalConfig: args.runtime.getGlobalConfig() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/template-studio/models") {
        sendJson(response, 200, await args.runtime.getTemplateStudioModelCatalog({
          modelProfileId: url.searchParams.get("modelProfileId") ?? undefined,
        }, { sessionToken }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/provider-profiles/model-catalog") {
        const body = await readJson<{ draft: ModelProfileDraft }>(request);
        sendJson(response, 200, await args.runtime.getProviderProfileModelCatalog(body, { sessionToken }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/provider-profiles/test") {
        const body = await readJson<{ draft: ModelProfileDraft; modelId?: string }>(request);
        sendJson(response, 200, await args.runtime.testProviderProfile(body, { sessionToken }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/skills") {
        sendJson(response, 200, { skills: await args.runtime.listSkillCatalog() });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        const body = await readJson<{ handle: string; password: string; displayName?: string }>(request);
        const result = await args.runtime.login(body);
        sendJson(
          response,
          200,
          result,
          result.sessionToken ? { "set-cookie": buildSessionCookie(result.sessionToken) } : {},
        );
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        const body = await readJson<{ sessionToken?: string }>(request);
        const result = await args.runtime.logout({ sessionToken: sessionToken ?? body.sessionToken });
        sendJson(response, 200, result, { "set-cookie": buildClearedSessionCookie() });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/auth/session") {
        sendJson(response, 200, await args.runtime.restoreSession({ sessionToken }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/me") {
        sendJson(response, 200, await args.runtime.getMe({ sessionToken }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/me") {
        const body = await readJson<{ handle?: string; displayName?: string }>(request);
        sendJson(response, 200, await args.runtime.updateMe({ sessionToken, ...body }));
        return;
      }

      if (request.method === "GET" && isMyProjectMembershipsPath(url.pathname)) {
        sendJson(response, 200, await args.runtime.listMyProjectMemberships({ sessionToken }));
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/admin/users") {
        sendJson(response, 200, await args.runtime.listManagedUsers({ sessionToken }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/admin/users") {
        const body = await readJson<{ handle: string; displayName: string; password: string; isAdmin?: boolean }>(request);
        sendJson(response, 200, await args.runtime.createManagedUser({ sessionToken, ...body }));
        return;
      }

      const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/u);
      if (request.method === "POST" && adminUserMatch) {
        const [, userId] = adminUserMatch;
        if (!userId) {
          sendJson(response, 400, { error: "Missing user id" });
          return;
        }

        const body = await readJson<{ handle?: string; displayName?: string; password?: string; isAdmin?: boolean }>(request);
        sendJson(response, 200, await args.runtime.updateManagedUser({ sessionToken, userId, ...body }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/admin/project-memberships") {
        const body = await readJson<{ userId: string; projectId: string; role?: "owner" | "admin" | "member"; remove?: boolean }>(request);
        sendJson(response, 200, await args.runtime.setManagedProjectMembership({ sessionToken, ...body }));
        return;
      }

      const roomHistoryMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/history$/u);
      if (request.method === "GET" && roomHistoryMatch) {
        const [, roomId] = roomHistoryMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }

        const beforeMessageId = url.searchParams.get("before") ?? undefined;
        const limitParam = url.searchParams.get("limit");
        const parsedLimit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
        sendJson(
          response,
          200,
          await args.runtime.getRoomMessageHistoryPage({
            roomId,
            beforeMessageId,
            limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
            sessionToken,
          }),
        );
        return;
      }

      const roomTodoTreeMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/todo-trees$/u);
      if (request.method === "GET" && roomTodoTreeMatch) {
        const [, roomId] = roomTodoTreeMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }

        sendJson(
          response,
          200,
          await args.runtime.getRoomTodoTrees({
            roomId,
            sessionToken,
          }),
        );
        return;
      }

      const roomAssetMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/assets$/u);
      if (request.method === "POST" && roomAssetMatch) {
        const [, roomId] = roomAssetMatch;
        const fileName = url.searchParams.get("fileName");

        if (!roomId || !fileName) {
          sendJson(response, 400, { error: "Missing room id or file name" });
          return;
        }

        const body = await readRequestBodyBuffer(request);
        if (body.byteLength === 0) {
          sendJson(response, 400, { error: "Missing asset body" });
          return;
        }

        const requestContentTypeHeader = request.headers["content-type"] as string | string[] | undefined;
        const requestContentType: string | undefined = Array.isArray(requestContentTypeHeader)
          ? requestContentTypeHeader[0]
          : requestContentTypeHeader;

        sendJson(
          response,
          200,
          await args.runtime.writeRoomAsset({
            roomId,
            fileName,
            contentType: requestContentType,
            body,
            sessionToken,
          }),
        );
        return;
      }

      if (request.method === "GET" && roomAssetMatch) {
        const [, roomId] = roomAssetMatch;
        const filePath = url.searchParams.get("path");
        if (!roomId || !filePath) {
          sendJson(response, 400, { error: "Missing room id or asset path" });
          return;
        }

        const asset = await args.runtime.readRoomAsset({
          roomId,
          filePath,
          sessionToken,
        });
        response.statusCode = 200;
        response.setHeader("content-type", asset.contentType);
        response.setHeader("cache-control", "no-store");
        response.end(asset.body);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/system/project-path/browse") {
        const body = await readJson<ProjectDirectoryBrowsePayload>(request);
        sendJson(response, 200, await args.runtime.browseProjectDirectory(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/system/project-path/inspect") {
        const body = await readJson<{ path: string }>(request);
        sendJson(response, 200, await args.runtime.inspectProjectPath(body));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/projects") {
        const body = await readJson<{ projectName: string; templateId?: string; path?: string }>(request);
        if (containsLegacyFirstPrompt(body)) {
          sendJson(response, 400, {
            error: "firstPrompt is no longer supported. Create the room first, then send the first message.",
          });
          return;
        }
        const created = await args.runtime.createProject(body, { sessionToken });
        sendJson(response, 200, {
          ...created,
          snapshot: buildTransportSnapshot(created.snapshot),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/accounts") {
        const body = await readJson<{ displayName: string; handle?: string; roomId?: string; activate?: boolean }>(request);
        const snapshot = await args.runtime.createWorkspaceAccount(body);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/accounts/active") {
        const body = await readJson<{ accountId: string; roomId?: string }>(request);
        if (!body.accountId) {
          sendJson(response, 400, { error: "Missing account id" });
          return;
        }
        const snapshot = await args.runtime.setActiveAccount(body);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const projectRoomsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/rooms$/u);
      if (request.method === "POST" && projectRoomsMatch) {
        const [, projectId] = projectRoomsMatch;
        if (!projectId) {
          sendJson(response, 400, { error: "Missing project id" });
          return;
        }
        const body = await readJson<{ templateId: string }>(request);
        if (containsLegacyFirstPrompt(body)) {
          sendJson(response, 400, {
            error: "firstPrompt is no longer supported. Create the room first, then send the first message.",
          });
          return;
        }
        const created = await args.runtime.createRoom({
          projectId,
          templateId: body.templateId,
        }, { sessionToken });
        sendJson(response, 200, {
          ...created,
          snapshot: buildTransportSnapshot(created.snapshot),
        });
        return;
      }

      const projectMembersMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/members$/u);
      if (request.method === "GET" && projectMembersMatch) {
        const [, projectId] = projectMembersMatch;
        if (!projectId) {
          sendJson(response, 400, { error: "Missing project id" });
          return;
        }

        sendJson(response, 200, await args.runtime.getProjectMembers({ projectId, sessionToken }));
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/templates/generate") {
        const body = await readJson<{ brief: string }>(request);
        const template = await args.runtime.generateTemplate(body.brief, { sessionToken });
        sendJson(response, 200, { template, snapshot: buildTransportSnapshot(args.runtime.getSnapshot()) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/template-studio/chat") {
        const body = await readJson<{
          templateId: string;
          messages: TemplateStudioUIMessage[];
          modelProfileId?: string;
          modelId?: string;
        }>(request);
        if (!body.templateId) {
          sendJson(response, 400, { error: "Missing template id" });
          return;
        }

        const messages = await validateUIMessages<TemplateStudioUIMessage>({
          messages: body.messages ?? [],
        });
        if (messages.length === 0) {
          sendJson(response, 400, { error: "Template Studio chat requires at least one message." });
          return;
        }

        const abortController = new AbortController();
        response.on("close", () => {
          if (!response.writableEnded && !abortController.signal.aborted) {
            abortController.abort("client_disconnected");
          }
        });

        const stream = createUIMessageStream<TemplateStudioUIMessage>({
          originalMessages: messages,
          onError(error) {
            return getErrorMessage(error as RuntimeError);
          },
          async execute({ writer }) {
            const session = await args.runtime.streamTemplateStudioChat({
              templateId: body.templateId,
              messages,
              modelProfileId: body.modelProfileId,
              modelId: body.modelId,
              abortSignal: abortController.signal,
            }, { sessionToken });

            try {
              writer.merge(
                session.result.toUIMessageStream({
                  originalMessages: messages,
                  sendReasoning: false,
                  sendSources: false,
                }),
              );
              try {
                await session.result.consumeStream();
              } finally {
                const synced = await session.finalize();
                writer.write({
                  type: "data-templateStudioSync",
                  transient: true,
                  data: {
                    snapshot: buildTransportSnapshot(synced.snapshot),
                    globalConfig: synced.globalConfig,
                    modelProfileId: synced.modelProfileId,
                    modelId: synced.modelId,
                  },
                });
              }
            } finally {
              await session.cleanup();
            }
          },
        });

        pipeUIMessageStreamToResponse({
          response,
          stream,
        });
        return;
      }

      const templateDeleteMatch = url.pathname.match(/^\/api\/templates\/([^/]+)$/u);
      if (request.method === "DELETE" && templateDeleteMatch) {
        const [, templateId] = templateDeleteMatch;
        if (!templateId) {
          sendJson(response, 400, { error: "Missing template id" });
          return;
        }
        const snapshot = await args.runtime.deleteTemplate(templateId, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const templateConfigMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/config$/u);
      if (request.method === "POST" && templateConfigMatch) {
        const [, templateId] = templateConfigMatch;
        if (!templateId) {
          sendJson(response, 400, { error: "Missing template id" });
          return;
        }
        const body = await readJson<{
          name: string;
          description: string;
          accentTone: "paper" | "postit" | "blueprint" | "correction";
          defaultVisibleMemberBlueprintIds?: string[];
          members: Array<{
            id: string;
            name: string;
            handle: string;
            isRole?: boolean;
            summary: string;
            prompt: string;
            accentTone: "paper" | "postit" | "blueprint" | "correction";
            modelProfileId?: string;
            modelId?: string;
            allowedSkillIds: string[];
            provider: {
              kind: "codex-acp" | "generic-acp";
              label: string;
              command: string;
              args: string[];
              env: Record<string, string>;
              workingDirectory?: string;
              capabilities: string[];
            };
            isEntryMember?: boolean;
            acceptsDirectMessages?: boolean;
            codexThinkingDepth?: "low" | "mid" | "high" | "extra-high";
            watch?: {
              intervalMinutes: number;
              enabledByDefault: boolean;
              persistent?: boolean;
              prompt?: string;
            };
          }>;
        }>(request);
        const snapshot = await args.runtime.updateTemplate({
          templateId,
          ...body,
        }, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/config") {
        const body = await readJson<UpdateGlobalConfigInput>(request);
        const globalConfig = await args.runtime.updateGlobalConfig(body, { sessionToken });
        sendJson(response, 200, {
          globalConfig,
          snapshot: buildTransportSnapshot(args.runtime.getSnapshot()),
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson<{
          messages: WorkspaceUIMessage[];
          roomId: string;
          authorHumanId?: string;
          directMemberId?: string;
          directHumanId?: string;
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
                authorHumanId: body.authorHumanId,
                directMemberId: body.directMemberId,
                directHumanId: body.directHumanId,
                sessionToken,
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
                  writer.write({
                    type: "data-taskSettled",
                    transient: true,
                    data: {
                      taskId: event.taskId,
                      memberId: event.memberId,
                    },
                  });
                },
                onError(event) {
                  writer.write({
                    type: "data-taskSettled",
                    transient: true,
                    data: {
                      taskId: event.taskId,
                      memberId: event.memberId,
                    },
                  });
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
        const body = await readJson<{
          content: string;
          authorHumanId?: string;
          directMemberId?: string;
          directHumanId?: string;
        }>(request);
        const snapshot = await args.runtime.sendUserMessage({
          roomId,
          content: body.content,
          authorHumanId: body.authorHumanId,
          directMemberId: body.directMemberId,
          directHumanId: body.directHumanId,
          sessionToken,
        });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const roomDeleteMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/u);
      if (request.method === "DELETE" && roomDeleteMatch) {
        const [, roomId] = roomDeleteMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }
        const snapshot = await args.runtime.deleteRoom(roomId, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const roomReadMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/read$/u);
      if (request.method === "POST" && roomReadMatch) {
        const [, roomId] = roomReadMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }
        const snapshot = await args.runtime.acknowledgeRoom(roomId, sessionToken);
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const roomSettingsMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/settings$/u);
      if (request.method === "POST" && roomSettingsMatch) {
        const [, roomId] = roomSettingsMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }
        const body = await readJson<{ visibleMemberIds: string[] }>(request);
        const snapshot = await args.runtime.updateRoomSettings({
          roomId,
          visibleMemberIds: body.visibleMemberIds,
        }, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const roomWatcherSuspensionToggleMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/watcher-suspension\/toggle$/u);
      if (request.method === "POST" && roomWatcherSuspensionToggleMatch) {
        const [, roomId] = roomWatcherSuspensionToggleMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }
        const snapshot = await args.runtime.toggleRoomWatcherSuspension(roomId, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const roomTeamMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/team$/u);
      if (request.method === "POST" && roomTeamMatch) {
        const [, roomId] = roomTeamMatch;
        if (!roomId) {
          sendJson(response, 400, { error: "Missing room id" });
          return;
        }
        const body = await readJson<{
          teamName: string;
          teamDescription: string;
          teamAccentTone: "paper" | "postit" | "blueprint" | "correction";
          members: Array<{
            memberId: string;
            name: string;
            handle: string;
            summary: string;
            prompt: string;
            accentTone: "paper" | "postit" | "blueprint" | "correction";
            modelProfileId?: string;
            allowedSkillIds: string[];
            provider: {
              kind: "codex-acp" | "generic-acp";
              label: string;
              command: string;
              args: string[];
              env: Record<string, string>;
              workingDirectory?: string;
              capabilities: string[];
            };
            isEntryMember?: boolean;
            acceptsDirectMessages?: boolean;
            watch?: {
              enabled: boolean;
              intervalMinutes: number;
            };
          }>;
        }>(request);
        const snapshot = await args.runtime.updateRoomTeam({
          roomId,
          ...body,
        }, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const projectDeleteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/u);
      if (request.method === "DELETE" && projectDeleteMatch) {
        const [, projectId] = projectDeleteMatch;
        if (!projectId) {
          sendJson(response, 400, { error: "Missing project id" });
          return;
        }
        const snapshot = await args.runtime.deleteProject(projectId, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/internal/member-message") {
        const body = await readJson<{
          roomId: string;
          memberId: string;
          content: string;
          directMemberId?: string;
          directHumanId?: string;
          directToUser?: boolean;
          targetHandle?: string;
          taskId?: string;
        }>(request);
        const target =
          body.directMemberId || body.directHumanId || body.directToUser
            ? {
                directMemberId: body.directMemberId,
                directHumanId: body.directHumanId,
                directToUser: body.directToUser,
              }
            : resolveDirectTarget(args.runtime.getSnapshot(), body.roomId, body.targetHandle);
        if (body.targetHandle && !target.directMemberId && !target.directHumanId && !target.directToUser) {
          throw new Error(`Unknown direct target "${body.targetHandle}" in room "${body.roomId}"`);
        }
        const snapshot = await args.runtime.sendMemberMessage({
          ...body,
          ...target,
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
        const snapshot = await args.runtime.updatePrompt(memberId, body.prompt, { sessionToken });
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
          isRole?: boolean;
          summary: string;
          prompt: string;
          modelProfileId?: string;
          acceptsDirectMessages: boolean;
          codexThinkingDepth?: "low" | "mid" | "high" | "extra-high";
          allowedSkillIds: string[];
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
        }, { sessionToken });
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
        const snapshot = await args.runtime.setEntryMember(memberId, { sessionToken });
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
      const body = await readJson<{ enabled: boolean; intervalMinutes: number; persistent?: boolean; prompt?: string }>(request);
        const snapshot = await args.runtime.upsertWatcher({
          memberId,
          enabled: body.enabled,
          intervalMinutes: body.intervalMinutes,
          persistent: body.persistent ?? false,
          prompt: body.prompt,
        }, { sessionToken });
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
        const snapshot = await args.runtime.toggleWatcher(watcherId, { sessionToken });
        sendJson(response, 200, { snapshot: buildTransportSnapshot(snapshot) });
        return;
      }

      const watcherPauseMatch = url.pathname.match(/^\/api\/watchers\/([^/]+)\/pause-until-activity$/u);
      if (request.method === "POST" && watcherPauseMatch) {
        const [, watcherId] = watcherPauseMatch;
        if (!watcherId) {
          sendJson(response, 400, { error: "Missing watcher id" });
          return;
        }
        const snapshot = await args.runtime.pauseWatcherUntilActivity(watcherId, { sessionToken });
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
        const result = await args.runtime.runWatcherNow(watcherId, { sessionToken });
        sendJson(response, 200, {
          snapshot: buildTransportSnapshot(result.snapshot),
          outcome: result.outcome,
        });
        return;
      }

      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      sendJson(response, getStatusCodeForError(error), {
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
  const clientSessionTokens = new WeakMap<object, string | undefined>();

  const sendClientSnapshot = async (client: { readyState: number; OPEN: number; send(payload: string): void }, sessionToken?: string): Promise<void> => {
    if (client.readyState !== client.OPEN) {
      return;
    }

    const state = await args.runtime.getClientState({ sessionToken });
    client.send(
      JSON.stringify({
        type: "snapshot",
        snapshot: buildTransportSnapshot(state.snapshot),
        auth: state.auth,
      }),
    );
  };

  const broadcastSnapshot = async (snapshot: typeof pendingSnapshot): Promise<void> => {
    const clientCount = [...socketServer.clients].filter((client) => client.readyState === client.OPEN).length;
    if (clientCount === 0) {
      return;
    }

    await Promise.all(
      [...socketServer.clients].map((client) =>
        sendClientSnapshot(client, clientSessionTokens.get(client)),
      ),
    );
    if (args.logger?.shouldLog("ws-broadcast", 2000) ?? false) {
      const transportSnapshot = buildTransportSnapshot(snapshot);
      args.logger?.info("ws-broadcast", {
        bytes: Buffer.byteLength(JSON.stringify(transportSnapshot), "utf8"),
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
      void broadcastSnapshot(pendingSnapshot);
    }, 250);
  };
  const unsubscribe = args.runtime.subscribe((snapshot) => {
    scheduleSnapshotBroadcast(snapshot);
  });

  socketServer.on("connection", (client, request) => {
    const requestUrl = new URL(request.url ?? "/ws", `http://${request.headers.host ?? "127.0.0.1"}`);
    const sessionToken = requestUrl.searchParams.get("sessionToken") ?? undefined;
    clientSessionTokens.set(client, sessionToken);
    void sendClientSnapshot(client, sessionToken);
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
