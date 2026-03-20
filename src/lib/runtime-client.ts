import type {
  GlobalWorkspaceConfig,
  ProviderConnectionTestResult,
  RoomMessageHistoryPage,
  TemplateStudioModelCatalog,
  UpdateRoomSettingsInput,
  UpdateRoomTeamInput,
  TeamTemplate,
  TemplateStudioChatMessage,
  UpdateGlobalConfigInput,
  UpdateMemberConfigInput,
  UpdateTemplateInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import type { ModelProfileDraft } from "@/lib/global-config-draft";

export type WatcherRunOutcome = "triggered" | "busy" | "disabled" | "suspended" | "baselined" | "idle";

export interface WatcherRunResult {
  snapshot: WorkspaceSnapshot;
  outcome: WatcherRunOutcome;
}

export interface RoomTodoTreeFilePayload {
  absolutePath: string;
  fileName: string;
  modifiedAt: string;
  content: string;
}

export interface RoomTodoTreesPayload {
  roomId: string;
  projectId: string;
  projectInteractiveDirectory: string;
  roomContextDirectory: string;
  roomInteractiveDirectory: string;
  providerAssociationNotice: string;
  files: RoomTodoTreeFilePayload[];
}

export interface ProjectPathInspectionRoomPayload {
  roomId: string;
  roomName: string;
  teamName: string;
  memberCount: number;
  updatedAt: string;
}

export interface ProjectPathInspectionPayload {
  path: string;
  projectName: string;
  projectInteractiveDirectory: string;
  hasOpenAquariumDirectory: boolean;
  canImport: boolean;
  roomCount: number;
  rooms: ProjectPathInspectionRoomPayload[];
}

export function resolveWorkspaceRuntimeBaseUrl(): string {
  const configured = import.meta.env.VITE_OA_SERVER_URL as string | undefined;
  return configured ?? "http://127.0.0.1:4301";
}

function resolveWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

function extractErrorMessage(responseText: string): string {
  try {
    const parsed = JSON.parse(responseText) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall back to raw text when the server did not return JSON.
  }

  return responseText;
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(extractErrorMessage(await response.text()));
  }

  return (await response.json()) as T;
}

export class WorkspaceRuntimeClient {
  readonly baseUrl = resolveWorkspaceRuntimeBaseUrl();

  async getState(): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig }> {
    return parseJson(await fetch(`${this.baseUrl}/api/state`));
  }

  async listSkills(): Promise<{ skills: Array<{ id: string; directoryPath: string; entryPath: string; hasEntry: boolean }> }> {
    return parseJson(await fetch(`${this.baseUrl}/api/skills`));
  }

  async pickProjectPath(): Promise<{ path?: string; inspection?: ProjectPathInspectionPayload }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/system/project-path`, {
        method: "POST",
      }),
    );
  }

  async createProject(input: { projectName: string; templateId?: string; path?: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    projectId: string;
    roomId: string;
  }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async createRoom(input: { projectId: string; templateId: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    roomId: string;
  }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/projects/${input.projectId}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId: input.templateId,
        }),
      }),
    );
  }

  async deleteProject(projectId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/projects/${projectId}`, {
        method: "DELETE",
      }),
    );
    return payload.snapshot;
  }

  async deleteRoom(roomId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/rooms/${roomId}`, {
        method: "DELETE",
      }),
    );
    return payload.snapshot;
  }

  async acknowledgeRoom(roomId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/rooms/${roomId}/read`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async sendUserMessage(input: { roomId: string; content: string; directMemberId?: string }): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/rooms/${input.roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return payload.snapshot;
  }

  async getRoomMessageHistory(input: {
    roomId: string;
    beforeMessageId?: string;
    limit?: number;
  }): Promise<RoomMessageHistoryPage> {
    const url = new URL(`${this.baseUrl}/api/rooms/${input.roomId}/history`);
    if (input.beforeMessageId) {
      url.searchParams.set("before", input.beforeMessageId);
    }
    if (typeof input.limit === "number") {
      url.searchParams.set("limit", String(input.limit));
    }

    return parseJson(await fetch(url));
  }

  async getRoomTodoTrees(roomId: string): Promise<RoomTodoTreesPayload> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/rooms/${roomId}/todo-trees`),
    );
  }

  resolveRoomAssetUrl(roomId: string, filePath: string): string {
    const url = new URL(`${this.baseUrl}/api/rooms/${roomId}/assets`);
    url.searchParams.set("path", filePath);
    return url.toString();
  }

  async updatePrompt(memberId: string, prompt: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/members/${memberId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      }),
    );
    return payload.snapshot;
  }

  async updateMemberConfig(input: UpdateMemberConfigInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/members/${input.memberId}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          isRole: input.isRole,
          summary: input.summary,
          prompt: input.prompt,
          modelProfileId: input.modelProfileId,
          acceptsDirectMessages: input.acceptsDirectMessages,
          codexThinkingDepth: input.codexThinkingDepth,
          allowedSkillIds: input.allowedSkillIds,
          provider: input.provider,
        }),
      }),
    );
    return payload.snapshot;
  }

  async updateTemplate(input: UpdateTemplateInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/templates/${input.templateId}/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          accentTone: input.accentTone,
          defaultVisibleMemberBlueprintIds: input.defaultVisibleMemberBlueprintIds,
          members: input.members,
        }),
      }),
    );
    return payload.snapshot;
  }

  async updateRoomTeam(input: UpdateRoomTeamInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/rooms/${input.roomId}/team`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          teamName: input.teamName,
          teamDescription: input.teamDescription,
          teamAccentTone: input.teamAccentTone,
          members: input.members,
        }),
      }),
    );
    return payload.snapshot;
  }

  async updateRoomSettings(input: UpdateRoomSettingsInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/rooms/${input.roomId}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          visibleMemberIds: input.visibleMemberIds,
        }),
      }),
    );
    return payload.snapshot;
  }

  async deleteTemplate(templateId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/templates/${templateId}`, {
        method: "DELETE",
      }),
    );
    return payload.snapshot;
  }

  async updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/config`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async sendTemplateStudioChat(input: {
    templateId: string;
    messages: TemplateStudioChatMessage[];
    modelProfileId?: string;
    modelId?: string;
  }): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; assistantMessage: string; modelProfileId: string; modelId?: string }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/template-studio/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async getTemplateStudioModels(input: { modelProfileId?: string } = {}): Promise<TemplateStudioModelCatalog> {
    const url = new URL(`${this.baseUrl}/api/template-studio/models`);
    if (input.modelProfileId) {
      url.searchParams.set("modelProfileId", input.modelProfileId);
    }

    return parseJson(await fetch(url));
  }

  async getProviderProfileModelCatalog(input: { draft: ModelProfileDraft }): Promise<TemplateStudioModelCatalog> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/provider-profiles/model-catalog`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async testProviderProfile(input: {
    draft: ModelProfileDraft;
    modelId?: string;
  }): Promise<ProviderConnectionTestResult> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/provider-profiles/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async setEntryMember(memberId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/members/${memberId}/entry`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number; persistent?: boolean; prompt?: string }): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/members/${input.memberId}/watcher`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: input.enabled,
          intervalMinutes: input.intervalMinutes,
          persistent: input.persistent ?? false,
          prompt: input.prompt,
        }),
      }),
    );
    return payload.snapshot;
  }

  async toggleWatcher(watcherId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/watchers/${watcherId}/toggle`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async toggleRoomWatcherSuspension(roomId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/rooms/${roomId}/watcher-suspension/toggle`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async pauseWatcherUntilActivity(watcherId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/watchers/${watcherId}/pause-until-activity`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async runWatcher(watcherId: string): Promise<WatcherRunResult> {
    const payload = await parseJson<WatcherRunResult>(
      await fetch(`${this.baseUrl}/api/watchers/${watcherId}/run`, {
        method: "POST",
      }),
    );
    return payload;
  }

  async generateTemplate(brief: string): Promise<{ template: TeamTemplate; snapshot: WorkspaceSnapshot }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/templates/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      }),
    );
  }

  connect(onSnapshot: (snapshot: WorkspaceSnapshot) => void, onConnectionChange: (connected: boolean) => void): () => void {
    let socket: WebSocket | undefined;
    let disposed = false;
    const timer = window.setTimeout(() => {
      if (disposed) {
        return;
      }

      socket = new WebSocket(resolveWebSocketUrl(this.baseUrl));
      socket.addEventListener("open", () => onConnectionChange(true));
      socket.addEventListener("close", () => {
        if (!disposed) {
          onConnectionChange(false);
        }
      });
      socket.addEventListener("error", () => {
        if (!disposed) {
          onConnectionChange(false);
        }
      });
      socket.addEventListener("message", (event) => {
        const payload = JSON.parse(event.data as string) as { type: "snapshot"; snapshot: WorkspaceSnapshot };
        if (payload.type === "snapshot") {
          onSnapshot(payload.snapshot);
        }
      });
    }, 0);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }
}
