import type { TeamTemplate, UpdateMemberConfigInput, WorkspaceSnapshot } from "@/domain/model";

function resolveBaseUrl(): string {
  const configured = import.meta.env.VITE_OA_SERVER_URL as string | undefined;
  return configured ?? "http://127.0.0.1:4301";
}

function resolveWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

export class WorkspaceRuntimeClient {
  readonly baseUrl = resolveBaseUrl();

  async getState(): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(await fetch(`${this.baseUrl}/api/state`));
    return payload.snapshot;
  }

  async createProject(input: { projectName: string; firstPrompt: string; templateId: string }): Promise<{
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
          acceptsDirectMessages: input.acceptsDirectMessages,
          skills: input.skills,
          provider: input.provider,
        }),
      }),
    );
    return payload.snapshot;
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
    const socket = new WebSocket(resolveWebSocketUrl(this.baseUrl));
    socket.addEventListener("open", () => onConnectionChange(true));
    socket.addEventListener("close", () => onConnectionChange(false));
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data as string) as { type: "snapshot"; snapshot: WorkspaceSnapshot };
      if (payload.type === "snapshot") {
        onSnapshot(payload.snapshot);
      }
    });

    return () => {
      socket.close();
    };
  }
}
