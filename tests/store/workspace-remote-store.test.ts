import { describe, expect, it, vi } from "vitest";

import type { UpdateMemberConfigInput, UpdateTemplateInput, WorkspaceSnapshot } from "@/domain/model";
import { createDefaultWorkspaceSnapshot } from "@/lib/default-workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { createWorkspaceRemoteStore, type WorkspaceRemoteClient } from "@/store/workspace-remote-store";

function createClient(snapshot: WorkspaceSnapshot): WorkspaceRemoteClient {
  return {
    getState: () => Promise.resolve({ snapshot, globalConfig: createDefaultGlobalWorkspaceConfig() }),
    pickProjectPath: () => Promise.reject(new Error("not implemented")),
    inspectProjectPath: () => Promise.reject(new Error("not implemented")),
    createProject: () => Promise.reject(new Error("not implemented")),
    createRoom: () => Promise.reject(new Error("not implemented")),
    deleteProject: () => Promise.reject(new Error("not implemented")),
    deleteRoom: () => Promise.reject(new Error("not implemented")),
    acknowledgeRoom: () => Promise.reject(new Error("not implemented")),
    sendUserMessage: () => Promise.reject(new Error("not implemented")),
    updatePrompt: () => Promise.reject(new Error("not implemented")),
    updateMemberConfig: (input: UpdateMemberConfigInput) => {
      void input;
      return Promise.reject(new Error("not implemented"));
    },
    updateRoomTeam: () => Promise.reject(new Error("not implemented")),
    updateRoomSettings: () => Promise.reject(new Error("not implemented")),
    updateTemplate: (input: UpdateTemplateInput) => {
      void input;
      return Promise.reject(new Error("not implemented"));
    },
    deleteTemplate: () => Promise.reject(new Error("not implemented")),
    updateGlobalConfig: () => Promise.reject(new Error("not implemented")),
    sendTemplateStudioChat: () => Promise.reject(new Error("not implemented")),
    setEntryMember: () => Promise.reject(new Error("not implemented")),
    upsertWatcher: () => Promise.reject(new Error("not implemented")),
    toggleWatcher: () => Promise.reject(new Error("not implemented")),
    toggleRoomWatcherSuspension: () => Promise.reject(new Error("not implemented")),
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

  it("can replace snapshot and global config together from a streamed sync payload", () => {
    const snapshot = createSeedWorkspace();
    const store = createWorkspaceRemoteStore(createClient(createDefaultWorkspaceSnapshot()));
    const nextConfig = createDefaultGlobalWorkspaceConfig("/tmp/stream-sync");

    store.getState().replaceRemoteState({
      snapshot,
      globalConfig: nextConfig,
    });

    expect(store.getState().snapshot.projectOrder).toEqual(snapshot.projectOrder);
    expect(store.getState().globalConfig.directory).toBe("/tmp/stream-sync");
    expect(store.getState().error).toBeUndefined();
  });

  it("reuses the current snapshot tree when an incoming snapshot is value-identical", () => {
    const initialSnapshot = createSeedWorkspace();
    const store = createWorkspaceRemoteStore(createClient(createDefaultWorkspaceSnapshot()));

    store.getState().replaceSnapshot(initialSnapshot);
    const previousSnapshot = store.getState().snapshot;

    store.getState().replaceSnapshot(structuredClone(initialSnapshot));

    expect(store.getState().snapshot).toBe(previousSnapshot);
  });

  it("keeps untouched branches stable when a streamed snapshot changes one member", () => {
    const initialSnapshot = createSeedWorkspace();
    const store = createWorkspaceRemoteStore(createClient(createDefaultWorkspaceSnapshot()));

    store.getState().replaceSnapshot(initialSnapshot);
    const previousSnapshot = store.getState().snapshot;
    const targetRoomId = previousSnapshot.selection.roomId!;
    const targetMemberId = previousSnapshot.rooms[targetRoomId]!.memberIds[0]!;
    const nextSnapshot = structuredClone(initialSnapshot);
    nextSnapshot.members[targetMemberId] = {
      ...nextSnapshot.members[targetMemberId],
      status: nextSnapshot.members[targetMemberId]?.status === "running" ? "idle" : "running",
    };

    store.getState().replaceSnapshot(nextSnapshot);

    expect(store.getState().snapshot).not.toBe(previousSnapshot);
    expect(store.getState().snapshot.rooms[targetRoomId]).toBe(previousSnapshot.rooms[targetRoomId]);
    expect(store.getState().snapshot.members[targetMemberId]).not.toBe(previousSnapshot.members[targetMemberId]);
  });

  it("delegates manual project path inspection to the runtime client", async () => {
    const snapshot = createSeedWorkspace();
    const client = createClient(snapshot);
    client.inspectProjectPath = vi.fn(async ({ path }) => ({
      path,
      projectName: "Manual Project",
      projectInteractiveDirectory: `${path}/.openaquarium/interactive`,
      hasOpenAquariumDirectory: false,
      canImport: false,
      roomCount: 0,
      rooms: [],
    }));
    const store = createWorkspaceRemoteStore(client);

    await expect(store.getState().inspectProjectPath({ path: "/tmp/manual-project" })).resolves.toMatchObject({
      path: "/tmp/manual-project",
      projectName: "Manual Project",
    });
    expect(client.inspectProjectPath).toHaveBeenCalledWith({ path: "/tmp/manual-project" });
  });

  it("forwards authorHumanId and directHumanId through the sendUserMessage facade", async () => {
    const snapshot = createSeedWorkspace();
    const client = createClient(snapshot);
    client.sendUserMessage = vi.fn(async () => snapshot);
    const store = createWorkspaceRemoteStore(client);

    store.setState({
      ...store.getState(),
      snapshot,
    });

    await store.getState().sendUserMessage("只发给 Bob", {
      authorHumanId: "human_alice",
      directHumanId: "human_bob",
    });

    expect(client.sendUserMessage).toHaveBeenCalledWith({
      roomId: snapshot.selection.roomId,
      content: "只发给 Bob",
      authorHumanId: "human_alice",
      directHumanId: "human_bob",
      directMemberId: undefined,
    });
  });
});
