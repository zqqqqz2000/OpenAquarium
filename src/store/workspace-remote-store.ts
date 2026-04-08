import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  GlobalWorkspaceConfig,
  PostUserMessageInput,
  TeamTemplate,
  TemplateStudioChatMessage,
  UpdateGlobalConfigInput,
  UpdateMemberConfigInput,
  UpdateRoomSettingsInput,
  UpdateRoomTeamInput,
  UpdateTemplateInput,
  UpsertWorkspaceAccountInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import { createDefaultWorkspaceSnapshot } from "@/lib/default-workspace";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import {
  WorkspaceRuntimeClient,
  type BrowseProjectDirectoryInput,
  type InspectProjectPathInput,
  type ProjectDirectoryBrowsePayload,
  type ProjectPathInspectionPayload,
  type WorkspaceManagedUser,
  type WorkspaceManagedUserSetupResult,
  type WatcherRunResult,
  type WorkspaceAuthMembership,
  type WorkspaceAuthResponse,
  type WorkspaceAuthState,
} from "@/lib/runtime-client";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

function shareIncomingValue<T>(current: T, incoming: T): T {
  if (Object.is(current, incoming)) {
    return current;
  }

  if (Array.isArray(current) && Array.isArray(incoming)) {
    const currentArray = current as unknown[];
    const incomingArray = incoming as unknown[];
    let changed = current.length !== incoming.length;
    const next = incomingArray.map((item, index) => {
      const sharedItem = shareIncomingValue(currentArray[index], item);
      if (!Object.is(sharedItem, currentArray[index])) {
        changed = true;
      }
      return sharedItem;
    });

    return changed ? (next as unknown as T) : current;
  }

  if (isPlainObject(current) && isPlainObject(incoming)) {
    const currentKeys = Object.keys(current);
    const incomingKeys = Object.keys(incoming);
    let changed = currentKeys.length !== incomingKeys.length;
    const next: Record<string, unknown> = {};

    for (const key of incomingKeys) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        changed = true;
        next[key] = incoming[key];
        continue;
      }

      const sharedValue = shareIncomingValue(current[key], incoming[key]);
      if (!Object.is(sharedValue, current[key])) {
        changed = true;
      }
      next[key] = sharedValue;
    }

    return changed ? (next as T) : current;
  }

  return incoming;
}

function mergeIncomingSnapshot(current: WorkspaceSnapshot, incoming: WorkspaceSnapshot): WorkspaceSnapshot {
  const selectedProjectId =
    current.selection.projectId && incoming.projects[current.selection.projectId]
      ? current.selection.projectId
      : incoming.selection.projectId;
  const selectedRoomId =
    current.selection.roomId
    && incoming.rooms[current.selection.roomId]
    && (!selectedProjectId || incoming.rooms[current.selection.roomId]?.projectId === selectedProjectId)
      ? current.selection.roomId
      : incoming.selection.roomId;
  const selectedMemberId = current.selection.memberId;
  const memberStillVisible =
    selectedMemberId && selectedRoomId ? incoming.rooms[selectedRoomId]?.memberIds.includes(selectedMemberId) : false;
  const roomProjectId = selectedRoomId ? incoming.rooms[selectedRoomId]?.projectId : undefined;
  const mergedSelection = {
    ...incoming.selection,
    projectId: roomProjectId ?? selectedProjectId,
    roomId: selectedRoomId,
    memberId: memberStillVisible ? selectedMemberId : incoming.selection.memberId,
  };

  return shareIncomingValue(current, {
    ...incoming,
    selection: mergedSelection,
  });
}

type RemoteStoreError = Error | { message?: string } | string | number | boolean | null | undefined;

function getErrorMessage(error: RemoteStoreError): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && typeof error.message === "string") {
    return error.message;
  }

  if (typeof error === "number" || typeof error === "boolean") {
    return String(error);
  }

  if (error === null) {
    return "null";
  }

  if (typeof error === "undefined") {
    return "undefined";
  }

  return JSON.stringify(error);
}

type SendUserMessageTarget = Pick<PostUserMessageInput, "authorHumanId" | "directMemberId" | "directHumanId">;

function normalizeSendUserMessageTarget(target?: string | SendUserMessageTarget): SendUserMessageTarget {
  if (typeof target === "string") {
    return { directMemberId: target };
  }

  return target ?? {};
}

function normalizeAuthState(
  auth: WorkspaceAuthState | WorkspaceAuthResponse,
  args: { required: boolean; sessionToken?: string; memberships?: WorkspaceAuthMembership[] },
): WorkspaceAuthState {
  if (!auth.authenticated) {
    return {
      required: args.required,
      authenticated: false,
      canRegister: "canRegister" in auth ? auth.canRegister : undefined,
    };
  }

  return {
    ...auth,
    required: args.required,
    sessionToken: auth.sessionToken ?? args.sessionToken,
    memberships: args.memberships ?? auth.memberships,
  };
}


export interface WorkspaceRemoteStoreState {
  snapshot: WorkspaceSnapshot;
  globalConfig: GlobalWorkspaceConfig;
  auth: WorkspaceAuthState;
  loading: boolean;
  connected: boolean;
  error?: string;
  hydrate(): Promise<void>;
  login(input: { handle: string; password: string; displayName?: string }): Promise<void>;
  completeUserSetup(input: { token: string; password: string }): Promise<void>;
  logout(): Promise<void>;
  updateMe(input: { handle?: string; displayName?: string }): Promise<void>;
  listManagedUsers(): Promise<WorkspaceManagedUser[]>;
  createManagedUser(input: { handle: string; displayName: string; isAdmin?: boolean }): Promise<WorkspaceManagedUserSetupResult>;
  updateManagedUser(input: {
    userId: string;
    handle?: string;
    displayName?: string;
    isAdmin?: boolean;
  }): Promise<WorkspaceManagedUser>;
  issueManagedUserSetup(input: { userId: string }): Promise<WorkspaceManagedUserSetupResult>;
  setManagedProjectMembership(input: {
    userId: string;
    projectId: string;
    role?: "owner" | "admin" | "member";
    remove?: boolean;
  }): Promise<WorkspaceManagedUser>;
  browseProjectDirectory(input?: BrowseProjectDirectoryInput): Promise<ProjectDirectoryBrowsePayload>;
  inspectProjectPath(input: InspectProjectPathInput): Promise<ProjectPathInspectionPayload>;
  createProject(input: { projectName: string; templateId?: string; path?: string }): Promise<{ projectId: string; roomId: string }>;
  createRoom(input: { projectId: string; templateId: string }): Promise<{ roomId: string }>;
  deleteProject(projectId: string): Promise<WorkspaceSnapshot>;
  deleteRoom(roomId: string): Promise<WorkspaceSnapshot>;
  createWorkspaceAccount(input: UpsertWorkspaceAccountInput): Promise<void>;
  setActiveAccount(accountId: string, roomId?: string): Promise<void>;
  selectRoom(projectId: string, roomId: string): void;
  selectMember(memberId?: string): void;
  updateRoomSettings(input: UpdateRoomSettingsInput): Promise<void>;
  sendUserMessage(content: string, target?: string | SendUserMessageTarget): Promise<void>;
  toggleWatcherSchedule(watcherId: string): Promise<void>;
  toggleRoomWatcherSuspension(roomId: string): Promise<void>;
  runWatcher(watcherId: string): Promise<WatcherRunResult>;
  updatePrompt(memberId: string, prompt: string): Promise<void>;
  updateMemberConfig(input: UpdateMemberConfigInput): Promise<void>;
  updateRoomTeam(input: UpdateRoomTeamInput): Promise<WorkspaceSnapshot>;
  updateTemplate(input: UpdateTemplateInput): Promise<void>;
  deleteTemplate(templateId: string): Promise<void>;
  updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<void>;
  sendTemplateStudioChat(input: {
    templateId: string;
    messages: TemplateStudioChatMessage[];
    modelProfileId?: string;
  }): Promise<{ assistantMessage: string; modelProfileId: string }>;
  setEntryMember(memberId: string): Promise<void>;
  upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number; persistent?: boolean; prompt?: string }): Promise<void>;
  generateTemplate(brief: string): Promise<TeamTemplate>;
  replaceSnapshot(snapshot: WorkspaceSnapshot): void;
  replaceRemoteState(payload: { snapshot: WorkspaceSnapshot; globalConfig?: GlobalWorkspaceConfig; auth?: WorkspaceAuthState }): void;
  setConnected(connected: boolean): void;
}

export interface WorkspaceRemoteClient {
  getState(): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; auth: WorkspaceAuthState }>;
  getSessionToken(): string | undefined;
  login(input: { handle: string; password: string; displayName?: string }): Promise<WorkspaceAuthResponse>;
  completeUserSetup(input: { token: string; password: string }): Promise<WorkspaceAuthResponse>;
  logout(): Promise<{ authenticated: false }>;
  restoreSession(): Promise<WorkspaceAuthResponse>;
  getMe(): Promise<WorkspaceAuthResponse>;
  updateMe(input: { handle?: string; displayName?: string }): Promise<WorkspaceAuthResponse>;
  listMyProjectMemberships(): Promise<{ memberships: WorkspaceAuthMembership[] }>;
  listManagedUsers(): Promise<{ users: WorkspaceManagedUser[] }>;
  createManagedUser(input: { handle: string; displayName: string; isAdmin?: boolean }): Promise<WorkspaceManagedUserSetupResult>;
  updateManagedUser(input: {
    userId: string;
    handle?: string;
    displayName?: string;
    isAdmin?: boolean;
  }): Promise<{ user: WorkspaceManagedUser }>;
  issueManagedUserSetup(input: { userId: string }): Promise<WorkspaceManagedUserSetupResult>;
  setManagedProjectMembership(input: {
    userId: string;
    projectId: string;
    role?: "owner" | "admin" | "member";
    remove?: boolean;
  }): Promise<{ user: WorkspaceManagedUser }>;
  browseProjectDirectory(input?: BrowseProjectDirectoryInput): Promise<ProjectDirectoryBrowsePayload>;
  inspectProjectPath(input: InspectProjectPathInput): Promise<ProjectPathInspectionPayload>;
  createProject(input: { projectName: string; templateId?: string; path?: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    projectId: string;
    roomId: string;
  }>;
  createRoom(input: { projectId: string; templateId: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    roomId: string;
  }>;
  deleteProject(projectId: string): Promise<WorkspaceSnapshot>;
  deleteRoom(roomId: string): Promise<WorkspaceSnapshot>;
  createWorkspaceAccount(input: UpsertWorkspaceAccountInput): Promise<WorkspaceSnapshot>;
  setActiveAccount(input: { accountId: string; roomId?: string }): Promise<WorkspaceSnapshot>;
  acknowledgeRoom(roomId: string): Promise<WorkspaceSnapshot>;
  sendUserMessage(input: {
    roomId: string;
    content: string;
    authorHumanId?: string;
    directMemberId?: string;
    directHumanId?: string;
  }): Promise<WorkspaceSnapshot>;
  updatePrompt(memberId: string, prompt: string): Promise<WorkspaceSnapshot>;
  updateMemberConfig(input: UpdateMemberConfigInput): Promise<WorkspaceSnapshot>;
  updateRoomSettings(input: UpdateRoomSettingsInput): Promise<WorkspaceSnapshot>;
  updateRoomTeam(input: UpdateRoomTeamInput): Promise<WorkspaceSnapshot>;
  updateTemplate(input: UpdateTemplateInput): Promise<WorkspaceSnapshot>;
  deleteTemplate(templateId: string): Promise<WorkspaceSnapshot>;
  updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig }>;
  sendTemplateStudioChat(input: {
    templateId: string;
    messages: TemplateStudioChatMessage[];
    modelProfileId?: string;
  }): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; assistantMessage: string; modelProfileId: string }>;
  setEntryMember(memberId: string): Promise<WorkspaceSnapshot>;
  upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number; persistent?: boolean; prompt?: string }): Promise<WorkspaceSnapshot>;
  toggleWatcher(watcherId: string): Promise<WorkspaceSnapshot>;
  toggleRoomWatcherSuspension(roomId: string): Promise<WorkspaceSnapshot>;
  runWatcher(watcherId: string): Promise<WatcherRunResult>;
  generateTemplate(brief: string): Promise<{ template: TeamTemplate; snapshot: WorkspaceSnapshot }>;
  connect(onRemoteState: (payload: { snapshot: WorkspaceSnapshot; auth: WorkspaceAuthState }) => void, onConnectionChange: (connected: boolean) => void): () => void;
}

export function createWorkspaceRemoteStore(client: WorkspaceRemoteClient = new WorkspaceRuntimeClient()): StoreApi<WorkspaceRemoteStoreState> {
  const loadHydratedState = async (): Promise<{
    snapshot: WorkspaceSnapshot;
    globalConfig: GlobalWorkspaceConfig;
    auth: WorkspaceAuthState;
  }> => {
    const restored = await client.restoreSession();
    const state = await client.getState();
    if (!restored.authenticated) {
      return {
        snapshot: state.snapshot,
        globalConfig: state.globalConfig,
        auth: normalizeAuthState(state.auth, { required: state.auth.required, sessionToken: client.getSessionToken() }),
      };
    }

    const [me, memberships] = await Promise.all([
      client.getMe(),
      client.listMyProjectMemberships(),
    ]);

    return {
      snapshot: state.snapshot,
      globalConfig: state.globalConfig,
      auth: normalizeAuthState(me, {
        required: state.auth.required,
        sessionToken: client.getSessionToken(),
        memberships: memberships.memberships,
      }),
    };
  };

  const runMutation = async <T,>(
    set: (partial:
      | WorkspaceRemoteStoreState
      | Partial<WorkspaceRemoteStoreState>
      | ((state: WorkspaceRemoteStoreState) => WorkspaceRemoteStoreState | Partial<WorkspaceRemoteStoreState>),
    ) => void,
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      const result = await operation();
      set({ error: undefined });
      return result;
    } catch (error) {
      const message = getErrorMessage(error as RemoteStoreError);
      set({ error: message });
      throw error;
    }
  };

  return createStore<WorkspaceRemoteStoreState>((set, get) => ({
    snapshot: createDefaultWorkspaceSnapshot(),
    globalConfig: createDefaultGlobalWorkspaceConfig(),
    auth: { required: false, authenticated: false },
    loading: true,
    connected: false,
    async hydrate() {
      try {
        const { snapshot, globalConfig, auth } = await loadHydratedState();
        set((state) => ({
          snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
          globalConfig: globalConfig ? shareIncomingValue(state.globalConfig, globalConfig) : state.globalConfig,
          auth,
          loading: false,
          connected: true,
          error: undefined,
        }));
      } catch (error) {
        const message = getErrorMessage(error as RemoteStoreError);
        set({
          loading: false,
          error: message,
        });
      }
    },
    async login(input) {
      const result = await runMutation(set, async () => {
        await client.login(input);
        return loadHydratedState();
      });
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
        globalConfig: result.globalConfig ? shareIncomingValue(state.globalConfig, result.globalConfig) : state.globalConfig,
        auth: result.auth,
        loading: false,
      }));
    },
    async completeUserSetup(input) {
      const result = await runMutation(set, async () => {
        await client.completeUserSetup(input);
        return loadHydratedState();
      });
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
        globalConfig: result.globalConfig ? shareIncomingValue(state.globalConfig, result.globalConfig) : state.globalConfig,
        auth: result.auth,
        loading: false,
      }));
    },
    async logout() {
      await runMutation(set, () => client.logout());
      const { snapshot, globalConfig, auth } = await runMutation(set, () => client.getState());
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
        globalConfig: globalConfig ? shareIncomingValue(state.globalConfig, globalConfig) : state.globalConfig,
        auth,
        loading: false,
      }));
    },
    async updateMe(input) {
      const result = await runMutation(set, async () => {
        const auth = await client.updateMe(input);
        const state = await client.getState();
        return {
          snapshot: state.snapshot,
          globalConfig: state.globalConfig,
          auth: normalizeAuthState(auth, {
            required: state.auth.required,
            sessionToken: client.getSessionToken(),
          }),
        };
      });
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
        globalConfig: result.globalConfig ? shareIncomingValue(state.globalConfig, result.globalConfig) : state.globalConfig,
        auth: result.auth,
      }));
    },
    async listManagedUsers() {
      const result = await runMutation(set, () => client.listManagedUsers());
      return result.users;
    },
    async createManagedUser(input) {
      const result = await runMutation(set, () => client.createManagedUser(input));
      return result;
    },
    async updateManagedUser(input) {
      const result = await runMutation(set, () => client.updateManagedUser(input));
      return result.user;
    },
    async issueManagedUserSetup(input) {
      const result = await runMutation(set, () => client.issueManagedUserSetup(input));
      return result;
    },
    async setManagedProjectMembership(input) {
      const result = await runMutation(set, () => client.setManagedProjectMembership(input));
      return result.user;
    },
    async browseProjectDirectory(input = {}) {
      return runMutation(set, () => client.browseProjectDirectory(input));
    },
    async inspectProjectPath(input) {
      return runMutation(set, () => client.inspectProjectPath(input));
    },
    async createProject(input) {
      const result = await runMutation(set, () => client.createProject(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
      }));
      return {
        projectId: result.projectId,
        roomId: result.roomId,
      };
    },
    async createRoom(input) {
      const result = await runMutation(set, () => client.createRoom(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
      }));
      return {
        roomId: result.roomId,
      };
    },
    async deleteProject(projectId) {
      const snapshot = await runMutation(set, () => client.deleteProject(projectId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
      return snapshot;
    },
    async deleteRoom(roomId) {
      const snapshot = await runMutation(set, () => client.deleteRoom(roomId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
      return snapshot;
    },
    async createWorkspaceAccount(input) {
      const snapshot = await runMutation(set, () => client.createWorkspaceAccount(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async setActiveAccount(accountId, roomId) {
      const snapshot = await runMutation(set, () => client.setActiveAccount({ accountId, roomId }));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    selectRoom(projectId, roomId) {
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          selection: {
            ...state.snapshot.selection,
            projectId,
            roomId,
          },
        },
      }));
      void runMutation(set, () => client.acknowledgeRoom(roomId))
        .then((snapshot) => {
          set((state) => ({
            snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
          }));
        })
        .catch(() => undefined);
    },
    selectMember(memberId) {
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          selection: {
            ...state.snapshot.selection,
            memberId,
          },
        },
      }));
    },
    async sendUserMessage(content, target) {
      const roomId = get().snapshot.selection.roomId;
      if (!roomId || content.trim().length === 0) {
        return;
      }
      const resolvedTarget = normalizeSendUserMessageTarget(target);
      const snapshot = await runMutation(set, () =>
        client.sendUserMessage({
          roomId,
          content,
          authorHumanId: resolvedTarget.authorHumanId,
          directMemberId: resolvedTarget.directMemberId,
          directHumanId: resolvedTarget.directHumanId,
        }),
      );
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async toggleWatcherSchedule(watcherId) {
      const snapshot = await runMutation(set, () => client.toggleWatcher(watcherId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async toggleRoomWatcherSuspension(roomId) {
      const snapshot = await runMutation(set, () => client.toggleRoomWatcherSuspension(roomId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async runWatcher(watcherId) {
      const result = await runMutation(set, () => client.runWatcher(watcherId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
      }));
      return result;
    },
    async updatePrompt(memberId, prompt) {
      const snapshot = await runMutation(set, () => client.updatePrompt(memberId, prompt));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async updateMemberConfig(input) {
      const snapshot = await runMutation(set, () => client.updateMemberConfig(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async updateRoomSettings(input) {
      const snapshot = await runMutation(set, () => client.updateRoomSettings(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async updateRoomTeam(input) {
      const snapshot = await runMutation(set, () => client.updateRoomTeam(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
      return snapshot;
    },
    async updateTemplate(input) {
      const snapshot = await runMutation(set, () => client.updateTemplate(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async deleteTemplate(templateId) {
      const snapshot = await runMutation(set, () => client.deleteTemplate(templateId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async updateGlobalConfig(input) {
      const result = await runMutation(set, () => client.updateGlobalConfig(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
        globalConfig: result.globalConfig ? shareIncomingValue(state.globalConfig, result.globalConfig) : state.globalConfig,
      }));
    },
    async sendTemplateStudioChat(input) {
      const result = await runMutation(set, () => client.sendTemplateStudioChat(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
        globalConfig: result.globalConfig ? shareIncomingValue(state.globalConfig, result.globalConfig) : state.globalConfig,
      }));
      return {
        assistantMessage: result.assistantMessage,
        modelProfileId: result.modelProfileId,
      };
    },
    async setEntryMember(memberId) {
      const snapshot = await runMutation(set, () => client.setEntryMember(memberId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async upsertWatcher(input) {
      const snapshot = await runMutation(set, () => client.upsertWatcher(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async generateTemplate(brief) {
      const result = await runMutation(set, () => client.generateTemplate(brief));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
      }));
      return result.template;
    },
    replaceSnapshot(snapshot) {
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
        loading: false,
        error: undefined,
      }));
    },
    replaceRemoteState(payload) {
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, payload.snapshot),
        globalConfig: payload.globalConfig ? shareIncomingValue(state.globalConfig, payload.globalConfig) : state.globalConfig,
        auth: payload.auth ?? state.auth,
        loading: false,
        error: undefined,
      }));
    },
    setConnected(connected) {
      set((state) => ({
        connected,
        error: connected ? undefined : state.error,
      }));
    },
  }));
}
