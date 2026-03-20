import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isProviderAssociationRequiredBinding } from "@/lib/provider-association";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import type { ExecutorCallbacks, ExecutionRequest, MemberExecutor } from "@/server/executor";
import { WorkspacePersistence } from "@/server/persistence";
import {
  getDefaultRoomTodoTreeFilePath,
  getRoomStateFilePath,
  syncRoomContextFiles,
} from "@/server/room-context-files";
import { getRoomTranscriptFilePath } from "@/server/room-transcript-files";
import { WorkspaceRuntime, createEmptyRuntimeSnapshot } from "@/server/runtime";

class EchoExecutor implements MemberExecutor {
  async execute(
    request: ExecutionRequest,
    callbacks: ExecutorCallbacks,
  ): Promise<void> {
    await callbacks.onComplete(`${request.member.handle} done`, "end_turn");
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

describe("runtime room context integration", () => {
  const runtimes: WorkspaceRuntime[] = [];

  afterEach(async () => {
    await Promise.all(runtimes.map((runtime) => runtime.dispose()));
    runtimes.length = 0;
  });

  it("writes transcript, room state, and default todo trees under the configured project path", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-room-context-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-project-root-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Project Context",
      templateId: "template-product-pod",
      path: projectRoot,
    });
    const snapshot = runtime.getSnapshot();
    const room = snapshot.rooms[created.roomId];
    const project = snapshot.projects[created.projectId];
    const transcriptPath = getRoomTranscriptFilePath(workspaceRoot, room, project);
    const roomStatePath = getRoomStateFilePath(workspaceRoot, room, project);
    const todoTreePath = getDefaultRoomTodoTreeFilePath(
      workspaceRoot,
      room,
      project,
    );
    const [transcript, roomState, todoTreeXml] = await Promise.all([
      readFile(transcriptPath, "utf8"),
      readFile(roomStatePath, "utf8"),
      readFile(todoTreePath, "utf8"),
    ]);
    const roomStatePayload = JSON.parse(roomState) as {
      files: { todoTrees: string[] };
      members: Array<Record<string, unknown>>;
      providerAssociation: { note: string };
      room: { id: string };
    };

    expect(transcriptPath).toContain(
      path.join(projectRoot, ".openaquarium", "interactive"),
    );
    expect(transcript).toContain(`# ${room.name}`);
    expect(roomStatePayload.room.id).toBe(room.id);
    expect(roomStatePayload.files.todoTrees).toContain(todoTreePath);
    expect(roomStatePayload.members[0]?.provider).toBeUndefined();
    expect(roomStatePayload.providerAssociation.note).toContain(
      "re-associate the project from the room UI",
    );
    expect(todoTreeXml).toContain("<aqtodo");
  });

  it("imports an existing project path without requiring a team template", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-import-workspace-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-import-project-root-"),
    );
    const seedSnapshot = createSeedWorkspace();
    const seedRoom = seedSnapshot.rooms[seedSnapshot.selection.roomId!];
    const seedProject = {
      ...seedSnapshot.projects[seedRoom.projectId],
      path: projectRoot,
    };

    seedSnapshot.projects[seedProject.id] = seedProject;

    await syncRoomContextFiles({
      workspaceRoot,
      next: seedSnapshot,
    });

    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const created = await runtime.createProject({
      projectName: "Imported Project",
      path: projectRoot,
    });
    const snapshot = runtime.getSnapshot();
    const room = snapshot.rooms[created.roomId];
    const project = snapshot.projects[created.projectId];
    const importedMembers = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

    expect(project.name).toBe("Imported Project");
    expect(project.path).toBe(projectRoot);
    expect(room.name).toBe(seedRoom.name);
    expect(room.memberIds).toHaveLength(seedRoom.memberIds.length);
    expect(snapshot.messageOrderByRoom[room.id]).toHaveLength(
      seedSnapshot.messageOrderByRoom[seedRoom.id]?.length ?? 0,
    );
    expect(
      importedMembers.every((member) =>
        isProviderAssociationRequiredBinding(member.provider),
      ),
    ).toBe(true);
    expect(
      Object.values(snapshot.tasks).every((task) => task.status !== "running"),
    ).toBe(true);
  });

  it("reuses an already-open project when the same project path is selected again", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-reuse-workspace-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-runtime-reuse-project-root-"),
    );
    const runtime = new WorkspaceRuntime({
      initialSnapshot: createEmptyRuntimeSnapshot(),
      persistence: new WorkspacePersistence(
        path.join(workspaceRoot, ".openaquarium", "state.json"),
      ),
      workspaceRoot,
      executorFactory: () => new EchoExecutor(),
    });
    runtimes.push(runtime);

    const first = await runtime.createProject({
      projectName: "First Open",
      templateId: "template-product-pod",
      path: projectRoot,
    });
    const second = await runtime.createProject({
      projectName: "Second Open",
      path: projectRoot,
    });
    const snapshot = runtime.getSnapshot();

    expect(snapshot.projectOrder).toHaveLength(1);
    expect(second.projectId).toBe(first.projectId);
    expect(second.roomId).toBe(first.roomId);
  });
});
