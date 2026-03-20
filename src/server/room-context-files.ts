import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChatMessage,
  MemberTask,
  Project,
  Room,
  TaskTraceEntry,
  TeamMember,
  WatchSubscription,
  WorkspaceSnapshot,
} from "@/domain/model";
import { resolveProjectWorkingDirectory } from "@/server/project-paths";

const ROOMS_DIRECTORY_NAME = "rooms";
const INTERACTIVE_DIRECTORY_NAME = "interactive";
const OPEN_AQUARIUM_DIRECTORY_NAME = ".openaquarium";
const ROOM_STATE_FILE_NAME = "room-state.json";
const DEFAULT_TODO_TREE_FILE_NAME = "main.aqtodo.xml";
const TODO_TREE_FILE_SUFFIX = ".aqtodo.xml";

export interface RoomTodoTreeFile {
  absolutePath: string;
  fileName: string;
  modifiedAt: string;
  content: string;
}

export interface PersistedRoomContextProject {
  id: string;
  name: string;
  path?: string;
  interactiveDirectory: string;
}

export interface PersistedRoomContextMember extends Omit<TeamMember, "provider" | "providerSessionId" | "openAICompatibleConversation"> {
  providerAssociationRequired: true;
  providerHint?: {
    kind: TeamMember["provider"]["kind"];
    label: string;
  };
}

export interface PersistedRoomContextSnapshot {
  version: 1;
  exportedAt: string;
  project: PersistedRoomContextProject;
  room: Room;
  members: PersistedRoomContextMember[];
  watchers: WatchSubscription[];
  messages: ChatMessage[];
  messageOrder: string[];
  tasks: MemberTask[];
  taskTraces: TaskTraceEntry[];
  taskTraceOrderByTask: Record<string, string[]>;
  files: {
    roomState: string;
    transcript: string;
    history: string;
    todoTrees: string[];
  };
  providerAssociation: {
    exported: false;
    note: string;
  };
}

export interface ProjectPathInspectionRoom {
  roomId: string;
  roomName: string;
  teamName: string;
  memberCount: number;
  updatedAt: string;
}

export interface ProjectPathInspectionResult {
  path: string;
  projectName: string;
  projectInteractiveDirectory: string;
  hasOpenAquariumDirectory: boolean;
  canImport: boolean;
  roomCount: number;
  rooms: ProjectPathInspectionRoom[];
}

function getProjectStorageRoot(workspaceRoot: string, project?: Pick<Project, "path">): string {
  return resolveProjectWorkingDirectory(project ?? {}, workspaceRoot);
}

function getProjectInteractiveDirectoryForRoot(projectRoot: string): string {
  return path.join(projectRoot, OPEN_AQUARIUM_DIRECTORY_NAME, INTERACTIVE_DIRECTORY_NAME);
}

function getProjectRoomsDirectoryForRoot(projectRoot: string): string {
  return path.join(getProjectInteractiveDirectoryForRoot(projectRoot), ROOMS_DIRECTORY_NAME);
}

export function getProjectInteractiveDirectoryPath(
  workspaceRoot: string,
  project?: Pick<Project, "path">,
): string {
  return getProjectInteractiveDirectoryForRoot(getProjectStorageRoot(workspaceRoot, project));
}

export function getRoomContextDirectoryPath(
  workspaceRoot: string,
  room: Pick<Room, "id" | "projectId">,
  project?: Pick<Project, "path">,
): string {
  return path.join(
    getProjectInteractiveDirectoryPath(workspaceRoot, project),
    ROOMS_DIRECTORY_NAME,
    room.projectId,
    room.id,
  );
}

export function getRoomTranscriptFilePath(
  workspaceRoot: string,
  room: Pick<Room, "id" | "projectId">,
  project?: Pick<Project, "path">,
): string {
  return path.join(getRoomContextDirectoryPath(workspaceRoot, room, project), "messages.md");
}

export function getMemberHistoryFilePath(
  workspaceRoot: string,
  room: Pick<Room, "id" | "projectId">,
  member: Pick<TeamMember, "id">,
  project?: Pick<Project, "path">,
): string {
  return path.join(getRoomContextDirectoryPath(workspaceRoot, room, project), `member-${member.id}.md`);
}

export function getRoomStateFilePath(
  workspaceRoot: string,
  room: Pick<Room, "id" | "projectId">,
  project?: Pick<Project, "path">,
): string {
  return path.join(getRoomContextDirectoryPath(workspaceRoot, room, project), ROOM_STATE_FILE_NAME);
}

export function getDefaultRoomTodoTreeFilePath(
  workspaceRoot: string,
  room: Pick<Room, "id" | "projectId">,
  project?: Pick<Project, "path">,
): string {
  return path.join(getRoomContextDirectoryPath(workspaceRoot, room, project), DEFAULT_TODO_TREE_FILE_NAME);
}

export function getProviderAssociationNotice(roomContextDirectoryPath: string): string {
  return `Provider bindings are intentionally not exported into ${roomContextDirectoryPath}. If this project is reopened elsewhere and a provider is missing, re-associate the project from the room UI.`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPersistedRoomContextSnapshot(value: unknown): value is PersistedRoomContextSnapshot {
  if (!isObjectRecord(value) || value.version !== 1) {
    return false;
  }

  const project = value.project;
  const room = value.room;

  return (
    isObjectRecord(project)
    && typeof project.id === "string"
    && typeof project.name === "string"
    && typeof project.interactiveDirectory === "string"
    && isObjectRecord(room)
    && typeof room.id === "string"
    && typeof room.projectId === "string"
    && typeof room.createdAt === "string"
    && Array.isArray(value.members)
    && Array.isArray(value.messages)
    && Array.isArray(value.messageOrder)
    && Array.isArray(value.tasks)
    && Array.isArray(value.taskTraces)
    && isObjectRecord(value.files)
    && Array.isArray(value.files.todoTrees)
  );
}

async function readPersistedRoomContextSnapshot(filePath: string): Promise<PersistedRoomContextSnapshot | undefined> {
  let rawContent: string;
  try {
    rawContent = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawContent) as unknown;
    return isPersistedRoomContextSnapshot(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildDefaultTodoTreeXml(args: {
  room: Room;
  project: Project;
  snapshot: WorkspaceSnapshot;
}): string {
  const { room, project, snapshot } = args;
  const entryMember = snapshot.members[room.entryMemberId];
  const entryHandle = entryMember?.handle ? `@${entryMember.handle}` : "";
  const roomTitle = room.name.trim() || project.name.trim() || room.id;
  const roomTopic = room.topic.trim() || "Track visible work, blockers, evidence, and completion here.";
  const ownerAttribute = entryHandle ? ` member="${escapeXml(entryHandle)}"` : "";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<aqtodo version="1" roomId="${escapeXml(room.id)}" roomName="${escapeXml(roomTitle)}">`,
    `  <node id="root" title="${escapeXml(roomTitle)}" status="in_progress"${ownerAttribute}>`,
    `    <note>${escapeXml(roomTopic)}</note>`,
    '    <node id="backlog" title="Backlog" status="todo">',
    "      <note>Put pending work here.</note>",
    "    </node>",
    `    <node id="doing" title="In Progress" status="in_progress"${ownerAttribute}>`,
    "      <note>Move active items here and attach evidence with <code> or <image>.</note>",
    "    </node>",
    '    <node id="done" title="Done" status="done">',
    "      <note>Move completed work here.</note>",
    "    </node>",
    "  </node>",
    "</aqtodo>",
    "",
  ].join("\n");
}

async function ensureDefaultTodoTreeFile(args: {
  workspaceRoot: string;
  room: Room;
  project: Project;
  snapshot: WorkspaceSnapshot;
}): Promise<void> {
  const filePath = getDefaultRoomTodoTreeFilePath(args.workspaceRoot, args.room, args.project);

  try {
    await access(filePath);
    return;
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      buildDefaultTodoTreeXml({
        room: args.room,
        project: args.project,
        snapshot: args.snapshot,
      }),
      "utf8",
    );
  }
}

function buildPersistedRoomContextSnapshot(args: {
  workspaceRoot: string;
  snapshot: WorkspaceSnapshot;
  project: Project;
  room: Room;
  todoTrees: string[];
}): PersistedRoomContextSnapshot {
  const { workspaceRoot, snapshot, project, room, todoTrees } = args;
  const roomContextDirectoryPath = getRoomContextDirectoryPath(workspaceRoot, room, project);
  const messageOrder = snapshot.messageOrderByRoom[room.id] ?? [];
  const taskEntries = Object.values(snapshot.tasks).filter((task) => task.roomId === room.id);
  const taskIds = taskEntries.map((task) => task.id);
  const taskIdSet = new Set(taskIds);
  const taskTraceOrderByTask = Object.fromEntries(
    taskIds.map((taskId) => [taskId, snapshot.taskTraceOrderByTask[taskId] ?? []]),
  );
  const taskTraceIds = taskIds.flatMap((taskId) => taskTraceOrderByTask[taskId] ?? []);

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      interactiveDirectory: getProjectInteractiveDirectoryPath(workspaceRoot, project),
    },
    room,
    members: room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .filter((member): member is TeamMember => Boolean(member))
      .map<PersistedRoomContextMember>((member) => {
        const persistedMember = { ...member } as Partial<TeamMember>;
        const provider = persistedMember.provider;

        delete persistedMember.provider;
        delete persistedMember.providerSessionId;
        delete persistedMember.openAICompatibleConversation;

        return {
          ...(persistedMember as Omit<
            TeamMember,
            "provider" | "providerSessionId" | "openAICompatibleConversation"
          >),
          providerAssociationRequired: true,
          providerHint: provider
            ? {
                kind: provider.kind,
                label: provider.label,
              }
            : undefined,
        };
      }),
    watchers: room.watcherIds
      .map((watcherId) => snapshot.watchers[watcherId])
      .filter((watcher): watcher is WatchSubscription => Boolean(watcher)),
    messages: messageOrder
      .map((messageId) => snapshot.messages[messageId])
      .filter((message): message is ChatMessage => Boolean(message)),
    messageOrder,
    tasks: taskEntries,
    taskTraces: taskTraceIds
      .map((traceId) => snapshot.taskTraces[traceId])
      .filter((trace): trace is TaskTraceEntry => Boolean(trace) && taskIdSet.has(trace.taskId)),
    taskTraceOrderByTask,
    files: {
      roomState: getRoomStateFilePath(workspaceRoot, room, project),
      transcript: getRoomTranscriptFilePath(workspaceRoot, room, project),
      history: path.join(roomContextDirectoryPath, "messages.jsonl"),
      todoTrees,
    },
    providerAssociation: {
      exported: false,
      note: getProviderAssociationNotice(roomContextDirectoryPath),
    },
  };
}

export async function syncRoomContextFiles(args: {
  workspaceRoot: string;
  next: WorkspaceSnapshot;
}): Promise<void> {
  const { workspaceRoot, next } = args;

  await Promise.all(
    Object.values(next.rooms).map(async (room) => {
      const project = next.projects[room.projectId];
      if (!project) {
        return;
      }

      await ensureDefaultTodoTreeFile({
        workspaceRoot,
        room,
        project,
        snapshot: next,
      });

      const todoTreeFiles = await listRoomTodoTreeFiles({
        workspaceRoot,
        room,
        project,
        ensureDefault: false,
      });
      const roomStatePath = getRoomStateFilePath(workspaceRoot, room, project);
      const payload = JSON.stringify(
        buildPersistedRoomContextSnapshot({
          workspaceRoot,
          snapshot: next,
          project,
          room,
          todoTrees: todoTreeFiles.map((file) => file.absolutePath),
        }),
        null,
        2,
      );

      await mkdir(path.dirname(roomStatePath), { recursive: true });
      await writeFile(roomStatePath, payload, "utf8");
    }),
  );
}

export async function listRoomTodoTreeFiles(args: {
  workspaceRoot: string;
  room: Room;
  project: Project;
  ensureDefault?: boolean;
  snapshot?: WorkspaceSnapshot;
}): Promise<RoomTodoTreeFile[]> {
  const { workspaceRoot, room, project, ensureDefault = true, snapshot } = args;

  if (ensureDefault && snapshot) {
    await ensureDefaultTodoTreeFile({
      workspaceRoot,
      room,
      project,
      snapshot,
    });
  }

  const directoryPath = getRoomContextDirectoryPath(workspaceRoot, room, project);
  await mkdir(directoryPath, { recursive: true });
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const todoTreeFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(TODO_TREE_FILE_SUFFIX))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    todoTreeFiles.map(async (fileName) => {
      const absolutePath = path.join(directoryPath, fileName);
      const [content, metadata] = await Promise.all([
        readFile(absolutePath, "utf8"),
        stat(absolutePath),
      ]);

      return {
        absolutePath,
        fileName,
        modifiedAt: metadata.mtime.toISOString(),
        content,
      } satisfies RoomTodoTreeFile;
    }),
  );
}

export async function loadProjectRoomContextSnapshots(projectRoot: string): Promise<PersistedRoomContextSnapshot[]> {
  const normalizedProjectRoot = path.normalize(projectRoot);
  const roomsDirectoryPath = getProjectRoomsDirectoryForRoot(normalizedProjectRoot);
  const projectDirectories = await readdir(roomsDirectoryPath, { withFileTypes: true }).catch(() => []);

  const roomStateFilePaths = (
    await Promise.all(
      projectDirectories
        .filter((entry) => entry.isDirectory())
        .map(async (projectDirectory) => {
          const roomDirectoryPath = path.join(roomsDirectoryPath, projectDirectory.name);
          const roomDirectories = await readdir(roomDirectoryPath, { withFileTypes: true }).catch(() => []);

          return roomDirectories
            .filter((entry) => entry.isDirectory())
            .map((roomDirectory) => path.join(roomDirectoryPath, roomDirectory.name, ROOM_STATE_FILE_NAME));
        }),
    )
  ).flat();

  const snapshots = await Promise.all(roomStateFilePaths.map((filePath) => readPersistedRoomContextSnapshot(filePath)));

  return snapshots
    .filter((snapshot): snapshot is PersistedRoomContextSnapshot => Boolean(snapshot))
    .sort((left, right) => {
      const leftUpdatedAt = left.room.updatedAt ?? left.room.createdAt;
      const rightUpdatedAt = right.room.updatedAt ?? right.room.createdAt;
      return rightUpdatedAt.localeCompare(leftUpdatedAt);
    });
}

export async function inspectProjectRoomContext(projectRoot: string): Promise<ProjectPathInspectionResult> {
  const normalizedProjectRoot = path.normalize(projectRoot);
  const openAquariumDirectoryPath = path.join(normalizedProjectRoot, OPEN_AQUARIUM_DIRECTORY_NAME);
  const hasOpenAquariumDirectory = await stat(openAquariumDirectoryPath)
    .then((metadata) => metadata.isDirectory())
    .catch(() => false);
  const snapshots = await loadProjectRoomContextSnapshots(normalizedProjectRoot);

  return {
    path: normalizedProjectRoot,
    projectName: snapshots[0]?.project.name?.trim() || path.basename(normalizedProjectRoot) || "Imported project",
    projectInteractiveDirectory: getProjectInteractiveDirectoryForRoot(normalizedProjectRoot),
    hasOpenAquariumDirectory,
    canImport: snapshots.length > 0,
    roomCount: snapshots.length,
    rooms: snapshots.map((snapshot) => ({
      roomId: snapshot.room.id,
      roomName: snapshot.room.name,
      teamName: snapshot.room.teamName?.trim() || snapshot.project.name,
      memberCount: snapshot.members.length,
      updatedAt: snapshot.room.updatedAt ?? snapshot.room.createdAt,
    })),
  };
}
