import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { parseAqTodoXml } from "@/lib/aqtodo";
import {
  browseProjectDirectories,
  createProjectDirectory,
  getDefaultRoomTodoTreeFilePath,
  getRoomStateFilePath,
  inspectProjectRoomContext,
  loadProjectRoomContextSnapshots,
  syncRoomContextFiles,
} from "@/server/room-context-files";

describe("room context files", () => {
  it("stores reproducible room context inside the project interactive directory without provider secrets", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-workspace-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-project-"),
    );
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = {
      ...snapshot.projects[room.projectId],
      path: projectRoot,
    };

    snapshot.projects[project.id] = project;

    await syncRoomContextFiles({
      workspaceRoot,
      next: snapshot,
    });

    const roomStatePath = getRoomStateFilePath(workspaceRoot, room, project);
    const todoTreePath = getDefaultRoomTodoTreeFilePath(
      workspaceRoot,
      room,
      project,
    );
    const roomState = JSON.parse(await readFile(roomStatePath, "utf8")) as {
      files: { todoTrees: string[] };
      members: Array<Record<string, unknown>>;
      messages: Array<Record<string, unknown>>;
      project: { interactiveDirectory: string };
      providerAssociation: { exported: boolean; note: string };
      room: { id: string };
      tasks: Array<Record<string, unknown>>;
    };
    const todoTreeXml = await readFile(todoTreePath, "utf8");

    expect(roomState.project.interactiveDirectory).toBe(
      path.join(projectRoot, ".openaquarium", "interactive"),
    );
    expect(roomState.room.id).toBe(room.id);
    expect(roomState.messages.length).toBeGreaterThan(0);
    expect(roomState.tasks.length).toBeGreaterThan(0);
    expect(roomState.members[0]?.provider).toBeUndefined();
    expect(roomState.members[0]?.providerSessionId).toBeUndefined();
    expect(roomState.members[0]?.providerAssociationRequired).toBe(true);
    expect(roomState.files.todoTrees).toContain(todoTreePath);
    expect(roomState.providerAssociation.exported).toBe(false);
    expect(roomState.providerAssociation.note).toContain(
      "re-associate the project from the room UI",
    );
    expect(todoTreePath).toContain(
      path.join(".openaquarium", "interactive", "rooms", room.id, "interactive", "main.aqtree.xml"),
    );
    expect(todoTreeXml).toContain("<aqtree");
    expect(todoTreeXml).toContain('id="root"');
    expect(todoTreeXml).toContain('id="root" title="');
    expect(todoTreeXml).toContain('status="todo"');
    expect(todoTreeXml).toContain('title="In Progress"');
    expect(todoTreeXml).toContain("&lt;code&gt; or &lt;image&gt;");

    const parsedTodoTree = parseAqTodoXml(todoTreeXml);
    expect(parsedTodoTree.root.children[1]?.note).toBe(
      "Move active items here and attach evidence with <code> or <image>.",
    );
  });

  it("inspects an existing project directory and reports reusable room context", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-inspect-workspace-"),
    );
    const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-inspect-project-"),
    );
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const project = {
      ...snapshot.projects[room.projectId],
      path: projectRoot,
    };

    snapshot.projects[project.id] = project;

    await syncRoomContextFiles({
      workspaceRoot,
      next: snapshot,
    });

    const [inspection, roomContexts] = await Promise.all([
      inspectProjectRoomContext(projectRoot),
      loadProjectRoomContextSnapshots(projectRoot),
    ]);

    expect(inspection.path).toBe(projectRoot);
    expect(inspection.hasOpenAquariumDirectory).toBe(true);
    expect(inspection.canImport).toBe(true);
    expect(inspection.projectName).toBe(project.name);
    expect(inspection.roomCount).toBe(1);
    expect(inspection.rooms[0]?.roomName).toBe(room.name);
    expect(roomContexts[0]?.room.id).toBe(room.id);
  });

  it("lists subdirectories for the in-browser project folder manager", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-browse-workspace-"),
    );
    const childDirectory = path.join(workspaceRoot, "child-project");
    await mkdir(childDirectory, { recursive: true });

    const result = await browseProjectDirectories({
      directoryPath: workspaceRoot,
      workspaceRoot,
    });

    expect(result.path).toBe(workspaceRoot);
    expect(result.isWorkspaceRoot).toBe(true);
    expect(result.isWithinWorkspaceRoot).toBe(true);
    expect(result.parentPath).toBe(path.dirname(workspaceRoot));
    expect(result.entries).toContainEqual({
      name: "child-project",
      path: childDirectory,
    });
  });

  it("creates a single child directory inside the workspace root for the web folder manager", async () => {
    const workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), "oa-room-context-create-workspace-"),
    );

    const result = await createProjectDirectory({
      directoryPath: workspaceRoot,
      name: "child-project",
      workspaceRoot,
    });

    expect(result.path).toBe(path.join(workspaceRoot, "child-project"));
    expect(result.parentPath).toBe(workspaceRoot);
    expect(result.isWorkspaceRoot).toBe(false);
    expect(result.isWithinWorkspaceRoot).toBe(true);
  });
});
