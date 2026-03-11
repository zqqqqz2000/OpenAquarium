import { describe, expect, it, vi } from "vitest";

import type { UpdateMemberConfigInput, UpdateTemplateInput, WorkspaceSnapshot } from "@/domain/model";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { createWorkspaceRemoteStore, type WorkspaceRemoteClient } from "@/store/workspace-remote-store";

function createClient(snapshot: WorkspaceSnapshot): WorkspaceRemoteClient {
  return {
    getState: () => Promise.resolve({ snapshot, globalConfig: createDefaultGlobalWorkspaceConfig() }),
    createProject: () => Promise.reject(new Error("not implemented")),
    createRoom: () => Promise.reject(new Error("not implemented")),
    deleteProject: () => Promise.reject(new Error("not implemented")),
    deleteRoom: () => Promise.reject(new Error("not implemented")),
    sendUserMessage: () => Promise.reject(new Error("not implemented")),
    updatePrompt: () => Promise.reject(new Error("not implemented")),
    updateMemberConfig: (input: UpdateMemberConfigInput) => {
      void input;
      return Promise.reject(new Error("not implemented"));
    },
    updateTemplate: (input: UpdateTemplateInput) => {
      void input;
      return Promise.reject(new Error("not implemented"));
    },
    deleteTemplate: () => Promise.reject(new Error("not implemented")),
    updateGlobalConfig: () => Promise.reject(new Error("not implemented")),
    sendTemplateStudioChat: () => Promise.reject(new Error("not implemented")),
    setEntryMember: () => Promise.reject(new Error("not implemented")),
    upsertWatcher: () => Promise.reject(new Error("not implemented")),
    toggleMemberMonitoring: () => Promise.reject(new Error("not implemented")),
    toggleWatcher: () => Promise.reject(new Error("not implemented")),
    runWatcher: () => Promise.reject(new Error("not implemented")),
    generateTemplate: (brief: string) => {
      void brief;
      return Promise.reject(new Error("not implemented"));
    },
    connect: vi.fn(() => () => {}),
  };
}

describe("workspace remote store", () => {
  it("starts from an empty workspace shell before runtime hydration", () => {
    const store = createWorkspaceRemoteStore(createClient(createSeedWorkspace()));

    expect(store.getState().snapshot.projectOrder).toEqual([]);
    expect(store.getState().snapshot.selection.roomId).toBeUndefined();
    expect(store.getState().connected).toBe(false);
    expect(store.getState().loading).toBe(true);
  });

  it("marks the runtime as connected after a successful hydrate", async () => {
    const snapshot = createSeedWorkspace();
    const store = createWorkspaceRemoteStore(createClient(snapshot));

    await store.getState().hydrate();

    expect(store.getState().connected).toBe(true);
    expect(store.getState().error).toBeUndefined();
    expect(store.getState().loading).toBe(false);
  });

  it("clears a stale runtime error when a fresh snapshot arrives", () => {
    const snapshot = createSeedWorkspace();
    const store = createWorkspaceRemoteStore(createClient(snapshot));

    store.setState({
      ...store.getState(),
      error: "Failed to fetch",
      loading: false,
    });

    store.getState().replaceSnapshot(snapshot);

    expect(store.getState().error).toBeUndefined();
  });

  it("clears a stale runtime error when websocket connectivity recovers", () => {
    const snapshot = createSeedWorkspace();
    const store = createWorkspaceRemoteStore(createClient(snapshot));

    store.setState({
      ...store.getState(),
      error: "Failed to fetch",
      connected: false,
      loading: false,
    });

    store.getState().setConnected(true);

    expect(store.getState().connected).toBe(true);
    expect(store.getState().error).toBeUndefined();
  });
});
