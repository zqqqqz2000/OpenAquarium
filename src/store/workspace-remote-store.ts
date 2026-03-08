import { createStore, type StoreApi } from "zustand/vanilla";

import type { TeamTemplate, UpdateMemberConfigInput, WorkspaceSnapshot } from "@/domain/model";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
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

export interface WorkspaceRemoteStoreState {
  snapshot: WorkspaceSnapshot;
  loading: boolean;
  connected: boolean;
  error?: string;
  hydrate(): Promise<void>;
  createProject(input: { projectName: string; firstPrompt: string; templateId: string }): Promise<{ projectId: string; roomId: string }>;
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

export function createWorkspaceRemoteStore(client = new WorkspaceRuntimeClient()): StoreApi<WorkspaceRemoteStoreState> {
  return createStore<WorkspaceRemoteStoreState>((set, get) => ({
    snapshot: createSeedWorkspace(),
    loading: true,
    connected: false,
    async hydrate() {
      try {
        const snapshot = await client.getState();
        set((state) => ({
          snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
          loading: false,
          error: undefined,
        }));
      } catch (error) {
        set({
          loading: false,
          error: (error as Error).message,
        });
      }
    },
    async createProject(input) {
      const result = await client.createProject(input);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
      }));
      return {
        projectId: result.projectId,
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
      const snapshot = await client.sendUserMessage({
        roomId,
        content,
        directMemberId,
      });
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async toggleMemberMonitoring(memberId) {
      const snapshot = await client.toggleMemberMonitoring(memberId);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async toggleWatcherSchedule(watcherId) {
      const snapshot = await client.toggleWatcher(watcherId);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async runWatcher(watcherId) {
      const snapshot = await client.runWatcher(watcherId);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async updatePrompt(memberId, prompt) {
      const snapshot = await client.updatePrompt(memberId, prompt);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async updateMemberConfig(input) {
      const snapshot = await client.updateMemberConfig(input);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async setEntryMember(memberId) {
      const snapshot = await client.setEntryMember(memberId);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async upsertWatcher(input) {
      const snapshot = await client.upsertWatcher(input);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
      }));
    },
    async generateTemplate(brief) {
      const result = await client.generateTemplate(brief);
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, result.snapshot),
      }));
      return result.template;
    },
    replaceSnapshot(snapshot) {
      set((state) => ({
        snapshot: mergeIncomingSnapshot(state.snapshot, snapshot),
        loading: false,
      }));
    },
    setConnected(connected) {
      set({ connected });
    },
  }));
}
