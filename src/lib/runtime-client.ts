import type {
  GlobalWorkspaceConfig,
  UpdateRoomSettingsInput,
  UpdateRoomTeamInput,
  TeamTemplate,
  TemplateStudioChatMessage,
  UpdateGlobalConfigInput,
  UpdateMemberConfigInput,
  UpdateTemplateInput,
  WorkspaceSnapshot,
} from "@/domain/model";

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

  async pickProjectPath(): Promise<string | undefined> {
    const payload = await parseJson<{ path?: string }>(
      await fetch(`${this.baseUrl}/api/system/project-path`, {
        method: "POST",
      }),
    );

    return payload.path;
  }

  async createProject(input: { projectName: string; templateId: string; path?: string }): Promise<{
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
          summary: input.summary,
          prompt: input.prompt,
          modelProfileId: input.modelProfileId,
          acceptsDirectMessages: input.acceptsDirectMessages,
          skills: input.skills,
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
          defaultRoomMemberMessageFilter: input.defaultRoomMemberMessageFilter,
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
          memberMessageFilter: input.memberMessageFilter,
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
  }): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; assistantMessage: string; modelProfileId: string }> {
    return parseJson(
      await fetch(`${this.baseUrl}/api/template-studio/chat`, {
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

  async upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number }): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/members/${input.memberId}/watcher`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: input.enabled,
          intervalMinutes: input.intervalMinutes,
        }),
      }),
    );
    return payload.snapshot;
  }

  async toggleMemberMonitoring(memberId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/members/${memberId}/monitor-toggle`, {
        method: "POST",
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

  async runWatcher(watcherId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await fetch(`${this.baseUrl}/api/watchers/${watcherId}/run`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
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
