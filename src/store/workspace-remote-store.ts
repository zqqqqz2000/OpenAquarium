import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  GlobalWorkspaceConfig,
  TeamTemplate,
  TemplateStudioChatMessage,
  UpdateGlobalConfigInput,
  UpdateMemberConfigInput,
  UpdateTemplateInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import { createDefaultWorkspaceSnapshot } from "@/lib/default-workspace";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";

function mergeIncomingSnapshot(current: WorkspaceSnapshot, incoming: WorkspaceSnapshot): WorkspaceSnapshot {
  const selectedMemberId = current.selection.memberId;
  const roomId = incoming.selection.roomId;
  const memberStillVisible =
    selectedMemberId && roomId ? incoming.rooms[roomId]?.memberIds.includes(selectedMemberId) : false;

  return {
    ...incoming,
    selection: {
      ...incoming.selection,
      memberId: memberStillVisible ? selectedMemberId : incoming.selection.memberId,
    },
  };
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

export interface WorkspaceRemoteStoreState {
  snapshot: WorkspaceSnapshot;
  globalConfig: GlobalWorkspaceConfig;
  loading: boolean;
  connected: boolean;
  error?: string;
  hydrate(): Promise<void>;
  createProject(input: { projectName: string; templateId: string }): Promise<{ projectId: string; roomId: string }>;
  createRoom(input: { projectId: string; templateId: string }): Promise<{ roomId: string }>;
  deleteProject(projectId: string): Promise<WorkspaceSnapshot>;
  deleteRoom(roomId: string): Promise<WorkspaceSnapshot>;
  selectRoom(projectId: string, roomId: string): void;
  selectMember(memberId?: string): void;
  sendUserMessage(content: string, directMemberId?: string): Promise<void>;
  toggleMemberMonitoring(memberId: string): Promise<void>;
  toggleWatcherSchedule(watcherId: string): Promise<void>;
  runWatcher(watcherId: string): Promise<void>;
  updatePrompt(memberId: string, prompt: string): Promise<void>;
  updateMemberConfig(input: UpdateMemberConfigInput): Promise<void>;
  updateTemplate(input: UpdateTemplateInput): Promise<void>;
  deleteTemplate(templateId: string): Promise<void>;
  updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<void>;
  sendTemplateStudioChat(input: {
    templateId: string;
    messages: TemplateStudioChatMessage[];
    modelProfileId?: string;
  }): Promise<{ assistantMessage: string; modelProfileId: string }>;
  setEntryMember(memberId: string): Promise<void>;
  upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number }): Promise<void>;
  generateTemplate(brief: string): Promise<TeamTemplate>;
  replaceSnapshot(snapshot: WorkspaceSnapshot): void;
  setConnected(connected: boolean): void;
}

export interface WorkspaceRemoteClient {
  getState(): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig }>;
  createProject(input: { projectName: string; templateId: string }): Promise<{
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
  sendUserMessage(input: { roomId: string; content: string; directMemberId?: string }): Promise<WorkspaceSnapshot>;
  updatePrompt(memberId: string, prompt: string): Promise<WorkspaceSnapshot>;
  updateMemberConfig(input: UpdateMemberConfigInput): Promise<WorkspaceSnapshot>;
  updateTemplate(input: UpdateTemplateInput): Promise<WorkspaceSnapshot>;
  deleteTemplate(templateId: string): Promise<WorkspaceSnapshot>;
  updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig }>;
  sendTemplateStudioChat(input: {
    templateId: string;
    messages: TemplateStudioChatMessage[];
    modelProfileId?: string;
  }): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; assistantMessage: string; modelProfileId: string }>;
  setEntryMember(memberId: string): Promise<WorkspaceSnapshot>;
  upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number }): Promise<WorkspaceSnapshot>;
  toggleMemberMonitoring(memberId: string): Promise<WorkspaceSnapshot>;
  toggleWatcher(watcherId: string): Promise<WorkspaceSnapshot>;
  runWatcher(watcherId: string): Promise<WorkspaceSnapshot>;
  generateTemplate(brief: string): Promise<{ template: TeamTemplate; snapshot: WorkspaceSnapshot }>;
  connect(onSnapshot: (snapshot: WorkspaceSnapshot) => void, onConnectionChange: (connected: boolean) => void): () => void;
}

export function createWorkspaceRemoteStore(client: WorkspaceRemoteClient = new WorkspaceRuntimeClient()): StoreApi<WorkspaceRemoteStoreState> {
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
    loading: true,
    connected: false,
    async hydrate() {
      try {
        const { snapshot, globalConfig } = await client.getState();
        set((state) => ({
          snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
          globalConfig: globalConfig ?? state.globalConfig,
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
    async sendUserMessage(content, directMemberId) {
      const roomId = get().snapshot.selection.roomId;
      if (!roomId || content.trim().length === 0) {
        return;
      }
      const snapshot = await runMutation(set, () =>
        client.sendUserMessage({
          roomId,
          content,
          directMemberId,
        }),
      );
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async toggleMemberMonitoring(memberId) {
      const snapshot = await runMutation(set, () => client.toggleMemberMonitoring(memberId));
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
    async runWatcher(watcherId) {
      const snapshot = await runMutation(set, () => client.runWatcher(watcherId));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
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
        globalConfig: result.globalConfig ?? state.globalConfig,
      }));
    },
    async sendTemplateStudioChat(input) {
      const result = await runMutation(set, () => client.sendTemplateStudioChat(input));
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
        globalConfig: result.globalConfig ?? state.globalConfig,
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
    setConnected(connected) {
      set((state) => ({
        connected,
        error: connected ? undefined : state.error,
      }));
    },
  }));
}
