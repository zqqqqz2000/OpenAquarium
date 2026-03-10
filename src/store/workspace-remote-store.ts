import { createStore, type StoreApi } from "zustand/vanilla";

import type { TeamTemplate, UpdateMemberConfigInput, WorkspaceSnapshot } from "@/domain/model";
import { createDefaultWorkspaceSnapshot } from "@/lib/default-workspace";
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
  loading: boolean;
  connected: boolean;
  error?: string;
  hydrate(): Promise<void>;
  createProject(input: { projectName: string; templateId: string }): Promise<{ projectId: string; roomId: string }>;
  createRoom(input: { projectId: string; templateId: string }): Promise<{ roomId: string }>;
  selectRoom(projectId: string, roomId: string): void;
  selectMember(memberId?: string): void;
  sendUserMessage(content: string, directMemberId?: string): Promise<void>;
  toggleMemberMonitoring(memberId: string): Promise<void>;
  toggleWatcherSchedule(watcherId: string): Promise<void>;
  runWatcher(watcherId: string): Promise<void>;
  updatePrompt(memberId: string, prompt: string): Promise<void>;
  updateMemberConfig(input: UpdateMemberConfigInput): Promise<void>;
  setEntryMember(memberId: string): Promise<void>;
  upsertWatcher(input: { memberId: string; enabled: boolean; intervalMinutes: number }): Promise<void>;
  generateTemplate(brief: string): Promise<TeamTemplate>;
  replaceSnapshot(snapshot: WorkspaceSnapshot): void;
  setConnected(connected: boolean): void;
}

export interface WorkspaceRemoteClient {
  getState(): Promise<WorkspaceSnapshot>;
  createProject(input: { projectName: string; templateId: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    projectId: string;
    roomId: string;
  }>;
  createRoom(input: { projectId: string; templateId: string }): Promise<{
    snapshot: WorkspaceSnapshot;
    roomId: string;
  }>;
  sendUserMessage(input: { roomId: string; content: string; directMemberId?: string }): Promise<WorkspaceSnapshot>;
  updatePrompt(memberId: string, prompt: string): Promise<WorkspaceSnapshot>;
  updateMemberConfig(input: UpdateMemberConfigInput): Promise<WorkspaceSnapshot>;
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
    loading: true,
    connected: false,
    async hydrate() {
      try {
        const snapshot = await client.getState();
        set((state) => ({
          snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
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
