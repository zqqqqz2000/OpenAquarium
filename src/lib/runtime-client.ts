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
  UpsertWorkspaceAccountInput,
  SetActiveAccountInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import type { ModelProfileDraft } from "@/lib/global-config-draft";
import type { UserChatAssetUploadResult } from "@/lib/chat/user-chat-assets";

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

export interface ProjectDirectoryBrowseEntryPayload {
  name: string;
  path: string;
}

export interface ProjectDirectoryBrowsePayload {
  path: string;
  parentPath?: string;
  isWorkspaceRoot: boolean;
  entries: ProjectDirectoryBrowseEntryPayload[];
  inspection: ProjectPathInspectionPayload;
}

export interface InspectProjectPathInput {
  path: string;
}

export interface BrowseProjectDirectoryInput {
  path?: string;
}

export interface WorkspaceAuthUser {
  id: string;
  handle: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceAuthSession {
  id: string;
  expiresAt: string;
  lastSeenAt: string;
}

export interface WorkspaceAuthMembership {
  id: string;
  projectId: string;
  projectName: string;
  projectPath?: string;
  role: "owner" | "admin" | "member";
  createdAt: string;
  updatedAt?: string;
}

export interface WorkspaceManagedUser {
  id: string;
  handle: string;
  displayName: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt?: string;
  setupPending: boolean;
  memberships: WorkspaceAuthMembership[];
}

export interface WorkspaceUserSetupLink {
  token: string;
  path: string;
}

export interface WorkspaceManagedUserSetupResult {
  user: WorkspaceManagedUser;
  setup: WorkspaceUserSetupLink;
}

export interface AuthenticatedWorkspaceAuth {
  required: boolean;
  authenticated: true;
  createdUser: boolean;
  sessionToken?: string;
  session: WorkspaceAuthSession;
  user: WorkspaceAuthUser;
  memberships: WorkspaceAuthMembership[];
}

export interface UnauthenticatedWorkspaceAuth {
  required: boolean;
  authenticated: false;
  canRegister?: boolean;
}

export type WorkspaceAuthState = AuthenticatedWorkspaceAuth | UnauthenticatedWorkspaceAuth;
export type WorkspaceAuthResponse =
  | Omit<AuthenticatedWorkspaceAuth, "required">
  | { authenticated: false; canRegister?: boolean };

export function resolveWorkspaceRuntimeBaseUrl(): string {
  const configured = import.meta.env.VITE_OA_SERVER_URL as string | undefined;
  if (configured?.trim()) {
    return configured.trim();
  }

  const location = typeof globalThis !== "undefined" && "location" in globalThis
    ? globalThis.location
    : undefined;
  if (location?.hostname) {
    const baseUrl = new URL(`${location.protocol === "https:" ? "https:" : "http:"}//127.0.0.1:4301`);
    baseUrl.hostname = location.hostname;
    return baseUrl.toString().replace(/\/$/u, "");
  }

  return "http://127.0.0.1:4301";
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

const SESSION_STORAGE_KEY = "oa.sessionToken";

function getSessionStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return undefined;
  }

  const storage = globalThis.localStorage;
  if (!storage) {
    return undefined;
  }

  return storage;
}

function readStoredSessionToken(): string | undefined {
  const storage = getSessionStorage();
  const value = storage?.getItem(SESSION_STORAGE_KEY)?.trim();
  return value || undefined;
}

function normalizeSessionToken(sessionToken?: string): string | undefined {
  const normalized = sessionToken?.trim();
  return normalized || undefined;
}

function mergeHeaders(headers?: HeadersInit, sessionToken?: string): Headers {
  const next = new Headers(headers);
  if (sessionToken?.trim()) {
    next.set("x-openaquarium-session", sessionToken.trim());
  }
  return next;
}

export function resolveWorkspaceRuntimeRequestCredentials(): RequestCredentials {
  return "include";
}

export function resolveWorkspaceRuntimeRequestHeaders(headers?: HeadersInit, sessionToken = readStoredSessionToken()): Headers {
  return mergeHeaders(headers, sessionToken);
}

export class WorkspaceRuntimeClient {
  readonly baseUrl = resolveWorkspaceRuntimeBaseUrl();
  private sessionToken = readStoredSessionToken();
  private activeConnectionId = 0;

  getSessionToken(): string | undefined {
    return this.sessionToken;
  }

  private persistSessionToken(sessionToken?: string): void {
    this.sessionToken = sessionToken?.trim() || undefined;
    const storage = getSessionStorage();
    if (!storage) {
      return;
    }

    if (this.sessionToken) {
      storage.setItem(SESSION_STORAGE_KEY, this.sessionToken);
      return;
    }

    storage.removeItem(SESSION_STORAGE_KEY);
  }

  private async request(path: string | URL, init: RequestInit = {}): Promise<Response> {
    return fetch(path, {
      credentials: resolveWorkspaceRuntimeRequestCredentials(),
      ...init,
      headers: resolveWorkspaceRuntimeRequestHeaders(init.headers, this.sessionToken),
    });
  }

  private withPersistedSessionToken<T extends WorkspaceAuthResponse | WorkspaceAuthState>(auth: T, required = false): T | WorkspaceAuthState {
    if (!auth.authenticated) {
      this.persistSessionToken(undefined);
      return {
        required,
        authenticated: false,
        canRegister: "canRegister" in auth ? auth.canRegister : undefined,
      } satisfies UnauthenticatedWorkspaceAuth;
    }

    const nextToken = auth.sessionToken ?? this.sessionToken;
    this.persistSessionToken(nextToken);
    return {
      ...auth,
      required: "required" in auth ? auth.required : required,
      sessionToken: nextToken,
    } satisfies AuthenticatedWorkspaceAuth;
  }

  async getState(): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; auth: WorkspaceAuthState }> {
    const payload = await parseJson<{
      snapshot: WorkspaceSnapshot;
      globalConfig: GlobalWorkspaceConfig;
      auth: WorkspaceAuthState;
    }>(await this.request(`${this.baseUrl}/api/state`));
    return {
      ...payload,
      auth: this.withPersistedSessionToken(payload.auth, payload.auth.required),
    };
  }

  async login(input: { handle: string; password: string; displayName?: string }): Promise<WorkspaceAuthResponse> {
    const payload = await parseJson<WorkspaceAuthResponse>(
      await this.request(`${this.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return this.withPersistedSessionToken(payload) as WorkspaceAuthResponse;
  }

  async completeUserSetup(input: { token: string; password: string }): Promise<WorkspaceAuthResponse> {
    const payload = await parseJson<WorkspaceAuthResponse>(
      await this.request(`${this.baseUrl}/api/auth/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return this.withPersistedSessionToken(payload) as WorkspaceAuthResponse;
  }

  async logout(): Promise<{ authenticated: false }> {
    const payload = await parseJson<{ authenticated: false }>(
      await this.request(`${this.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionToken: this.sessionToken }),
      }),
    );
    this.persistSessionToken(undefined);
    return payload;
  }

  async restoreSession(): Promise<WorkspaceAuthResponse> {
    const payload = await parseJson<WorkspaceAuthResponse>(
      await this.request(`${this.baseUrl}/api/auth/session`),
    );
    return this.withPersistedSessionToken(payload) as WorkspaceAuthResponse;
  }

  async getMe(): Promise<WorkspaceAuthResponse> {
    const payload = await parseJson<WorkspaceAuthResponse>(
      await this.request(`${this.baseUrl}/api/me`),
    );
    return this.withPersistedSessionToken(payload) as WorkspaceAuthResponse;
  }

  async updateMe(input: { handle?: string; displayName?: string }): Promise<WorkspaceAuthResponse> {
    const payload = await parseJson<WorkspaceAuthResponse>(
      await this.request(`${this.baseUrl}/api/me`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return this.withPersistedSessionToken(payload) as WorkspaceAuthResponse;
  }

  async listMyProjectMemberships(): Promise<{ memberships: WorkspaceAuthMembership[] }> {
    return parseJson(await this.request(`${this.baseUrl}/api/me/projects`));
  }

  async listManagedUsers(): Promise<{ users: WorkspaceManagedUser[] }> {
    return parseJson(await this.request(`${this.baseUrl}/api/admin/users`));
  }

  async createManagedUser(input: {
    handle: string;
    displayName: string;
    isAdmin?: boolean;
  }): Promise<WorkspaceManagedUserSetupResult> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async updateManagedUser(input: {
    userId: string;
    handle?: string;
    displayName?: string;
    isAdmin?: boolean;
  }): Promise<{ user: WorkspaceManagedUser }> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/admin/users/${input.userId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle: input.handle,
          displayName: input.displayName,
          isAdmin: input.isAdmin,
        }),
      }),
    );
  }

  async issueManagedUserSetup(input: { userId: string }): Promise<WorkspaceManagedUserSetupResult> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/admin/users/${input.userId}/setup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );
  }

  async setManagedProjectMembership(input: {
    userId: string;
    projectId: string;
    role?: "owner" | "admin" | "member";
    remove?: boolean;
  }): Promise<{ user: WorkspaceManagedUser }> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/admin/project-memberships`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async listSkills(): Promise<{ skills: Array<{ id: string; directoryPath: string; entryPath: string; hasEntry: boolean }> }> {
    return parseJson(await this.request(`${this.baseUrl}/api/skills`));
  }

  async browseProjectDirectory(input: BrowseProjectDirectoryInput = {}): Promise<ProjectDirectoryBrowsePayload> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/system/project-path/browse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async inspectProjectPath(input: InspectProjectPathInput): Promise<ProjectPathInspectionPayload> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/system/project-path/inspect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async createProject(input: { projectName: string; templateId?: string; path?: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    projectId: string;
    roomId: string;
  }> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/projects`, {
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
      await this.request(`${this.baseUrl}/api/projects/${input.projectId}/rooms`, {
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
      await this.request(`${this.baseUrl}/api/projects/${projectId}`, {
        method: "DELETE",
      }),
    );
    return payload.snapshot;
  }

  async deleteRoom(roomId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/rooms/${roomId}`, {
        method: "DELETE",
      }),
    );
    return payload.snapshot;
  }

  async createWorkspaceAccount(input: UpsertWorkspaceAccountInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return payload.snapshot;
  }

  async setActiveAccount(input: SetActiveAccountInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/accounts/active`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
    return payload.snapshot;
  }

  async acknowledgeRoom(roomId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/rooms/${roomId}/read`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async sendUserMessage(input: {
    roomId: string;
    content: string;
    authorHumanId?: string;
    directMemberId?: string;
    directHumanId?: string;
  }): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/rooms/${input.roomId}/messages`, {
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

    return parseJson(await this.request(url));
  }

  async getRoomTodoTrees(roomId: string): Promise<RoomTodoTreesPayload> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/rooms/${roomId}/todo-trees`),
    );
  }

  resolveRoomAssetUrl(roomId: string, filePath: string): string {
    const url = new URL(`${this.baseUrl}/api/rooms/${roomId}/assets`);
    url.searchParams.set("path", filePath);
    return url.toString();
  }

  async uploadRoomAsset(input: {
    roomId: string;
    file: Blob;
    fileName: string;
    contentType?: string;
  }): Promise<UserChatAssetUploadResult> {
    const url = new URL(`${this.baseUrl}/api/rooms/${input.roomId}/assets`);
    url.searchParams.set("fileName", input.fileName);

    return parseJson(
      await this.request(url, {
        method: "POST",
        headers: {
          "content-type": input.contentType?.trim() || "application/octet-stream",
        },
        body: input.file,
      }),
    );
  }

  async updatePrompt(memberId: string, prompt: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/members/${memberId}/prompt`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      }),
    );
    return payload.snapshot;
  }

  async updateMemberConfig(input: UpdateMemberConfigInput): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/members/${input.memberId}/config`, {
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
      await this.request(`${this.baseUrl}/api/templates/${input.templateId}/config`, {
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
      await this.request(`${this.baseUrl}/api/rooms/${input.roomId}/team`, {
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
      await this.request(`${this.baseUrl}/api/rooms/${input.roomId}/settings`, {
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
      await this.request(`${this.baseUrl}/api/templates/${templateId}`, {
        method: "DELETE",
      }),
    );
    return payload.snapshot;
  }

  async updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig }> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/config`, {
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
      await this.request(`${this.baseUrl}/api/template-studio/chat`, {
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

    return parseJson(await this.request(url));
  }

  async getProviderProfileModelCatalog(input: { draft: ModelProfileDraft }): Promise<TemplateStudioModelCatalog> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/provider-profiles/model-catalog`, {
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
      await this.request(`${this.baseUrl}/api/provider-profiles/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    );
  }

  async setEntryMember(memberId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/members/${memberId}/entry`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number; persistent?: boolean; prompt?: string }): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/members/${input.memberId}/watcher`, {
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
      await this.request(`${this.baseUrl}/api/watchers/${watcherId}/toggle`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async toggleRoomWatcherSuspension(roomId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/rooms/${roomId}/watcher-suspension/toggle`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async pauseWatcherUntilActivity(watcherId: string): Promise<WorkspaceSnapshot> {
    const payload = await parseJson<{ snapshot: WorkspaceSnapshot }>(
      await this.request(`${this.baseUrl}/api/watchers/${watcherId}/pause-until-activity`, {
        method: "POST",
      }),
    );
    return payload.snapshot;
  }

  async runWatcher(watcherId: string): Promise<WatcherRunResult> {
    const payload = await parseJson<WatcherRunResult>(
      await this.request(`${this.baseUrl}/api/watchers/${watcherId}/run`, {
        method: "POST",
      }),
    );
    return payload;
  }

  async generateTemplate(brief: string): Promise<{ template: TeamTemplate; snapshot: WorkspaceSnapshot }> {
    return parseJson(
      await this.request(`${this.baseUrl}/api/templates/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      }),
    );
  }

  connect(
    onRemoteState: (payload: { snapshot: WorkspaceSnapshot; auth: WorkspaceAuthState }) => void,
    onConnectionChange: (connected: boolean) => void,
  ): () => void {
    let socket: WebSocket | undefined;
    let disposed = false;
    const connectionId = this.activeConnectionId + 1;
    this.activeConnectionId = connectionId;
    const connectionSessionToken = normalizeSessionToken(this.sessionToken);
    const isCurrentConnection = (): boolean => this.activeConnectionId == connectionId
      && normalizeSessionToken(this.sessionToken) === connectionSessionToken;
    const timer = globalThis.setTimeout(() => {
      if (disposed || !isCurrentConnection()) {
        return;
      }

      const url = new URL(resolveWebSocketUrl(this.baseUrl));
      if (connectionSessionToken) {
        url.searchParams.set("sessionToken", connectionSessionToken);
      }
      socket = new WebSocket(url.toString());
      socket.addEventListener("open", () => {
        if (isCurrentConnection()) {
          onConnectionChange(true);
        }
      });
      socket.addEventListener("close", () => {
        if (!disposed && isCurrentConnection()) {
          onConnectionChange(false);
        }
      });
      socket.addEventListener("error", () => {
        if (!disposed && isCurrentConnection()) {
          onConnectionChange(false);
        }
      });
      socket.addEventListener("message", (event) => {
        if (!isCurrentConnection()) {
          return;
        }

        const payload = JSON.parse(event.data as string) as {
          type: "snapshot";
          snapshot: WorkspaceSnapshot;
          auth: WorkspaceAuthState;
        };
        if (payload.type === "snapshot") {
          onRemoteState({
            snapshot: payload.snapshot,
            auth: this.withPersistedSessionToken(payload.auth, payload.auth.required),
          });
        }
      });
    }, 0);

    return () => {
      disposed = true;
      globalThis.clearTimeout(timer);
      if (this.activeConnectionId === connectionId) {
        this.activeConnectionId += 1;
      }
      socket?.close();
    };
  }
}
