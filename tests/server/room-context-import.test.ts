import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { createDefaultWorkspaceSnapshot } from "@/lib/default-workspace";
import { isProviderAssociationRequiredBinding } from "@/lib/provider-association";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { importProjectFromRoomContexts } from "@/server/room-context-import";
import {
  loadProjectRoomContextSnapshots,
  syncRoomContextFiles,
} from "@/server/room-context-files";

describe("room context import", () => {
  it("rebuilds a project from persisted room context and injects provider placeholders", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-import-workspace-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-import-project-"),
    );
    const sourceSnapshot = createSeedWorkspace();
    const sourceRoom = sourceSnapshot.rooms[sourceSnapshot.selection.roomId!];
    const sourceProject = {
      ...sourceSnapshot.projects[sourceRoom.projectId],
      path: projectRoot,
    };

    sourceSnapshot.projects[sourceProject.id] = sourceProject;

    await syncRoomContextFiles({
      workspaceRoot,
      next: sourceSnapshot,
    });

    const roomContexts = await loadProjectRoomContextSnapshots(projectRoot);
    const importedSnapshot = importProjectFromRoomContexts({
      current: createDefaultWorkspaceSnapshot(),
      roomContexts,
      projectName: "Recovered Copy",
      projectPath: projectRoot,
      context: createRuntimeContext(20_000, "2026-03-20T00:00:00.000Z"),
    });

    const importedProject = importedSnapshot.projects[importedSnapshot.selection.projectId!];
    const importedRoom = importedSnapshot.rooms[importedSnapshot.selection.roomId!];
    const importedMembers = importedRoom.memberIds.map(
      (memberId) => importedSnapshot.members[memberId],
    );

    expect(importedProject.name).toBe("Recovered Copy");
    expect(importedProject.path).toBe(projectRoot);
    expect(importedRoom.name).toBe(sourceRoom.name);
    expect(importedRoom.id).toBe(sourceRoom.id);
    expect(importedRoom.memberIds).toHaveLength(sourceRoom.memberIds.length);
    expect(importedRoom.memberIds).toEqual(sourceRoom.memberIds);
    expect(importedSnapshot.messageOrderByRoom[importedRoom.id]).toHaveLength(
      sourceSnapshot.messageOrderByRoom[sourceRoom.id]?.length ?? 0,
    );
    expect(
      importedMembers.every((member) =>
        isProviderAssociationRequiredBinding(member.provider),
      ),
    ).toBe(true);
    expect(importedMembers.every((member) => member.status === "idle")).toBe(
      true,
    );
    expect(
      Object.values(importedSnapshot.tasks).every(
        (task) => task.status !== "running",
      ),
    ).toBe(true);
    expect(
      Object.values(importedSnapshot.messages).every(
        (message) => message.status !== "streaming",
      ),
    ).toBe(true);
  });
});
