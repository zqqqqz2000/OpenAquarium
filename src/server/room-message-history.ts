import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ChatAuthor, ChatMessage, MessageId, Project, Room, RoomMessageHistoryPage, WorkspaceSnapshot } from "@/domain/model";
import { isVisibleMainRoomMessage } from "@/lib/message-visibility";
import { resolveRoomVisibleMemberIdSet } from "@/lib/room-message-preferences";
import { getRoomContextDirectoryPath, getRoomTranscriptFilePath } from "@/server/room-context-files";

const HISTORY_FILE_NAME = "messages.jsonl";
const DEFAULT_HISTORY_PAGE_LIMIT = 80;
const MAX_HISTORY_PAGE_LIMIT = 200;

const chatAuthorSchema = z.object({
  kind: z.enum(["user", "member", "system"]),
  id: z.string(),
  label: z.string(),
});

const chatMessageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  author: chatAuthorSchema,
  content: z.string(),
  createdAt: z.string(),
  transport: z.enum(["group", "direct", "watch-digest", "status"]),
  status: z.enum(["sent", "streaming", "completed", "interrupted"]),
  visibility: z.enum(["public", "internal"]).optional(),
  mentionedMemberIds: z.array(z.string()),
  quotedMemberIds: z.array(z.string()).optional(),
  recipientMemberIds: z.array(z.string()),
  recipientUser: z.boolean().optional(),
  taskId: z.string().optional(),
});

function getVisibleMainRoomMessages(snapshot: WorkspaceSnapshot, roomId: string): ChatMessage[] {
  return (snapshot.messageOrderByRoom[roomId] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is ChatMessage => Boolean(message) && isVisibleMainRoomMessage(message));
}

function compareHistoryMessages(left: ChatMessage, right: ChatMessage): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function buildHistorySignature(message: ChatMessage): string {
  return [
    message.createdAt,
    message.author.kind,
    message.author.label,
    message.transport,
    message.status,
    message.content,
  ].join("\u0001");
}

function resolveMemberIdByHandleOrName(snapshot: WorkspaceSnapshot, room: Room, value: string): string | undefined {
  const normalized = value.replace(/^@>?/u, "").trim();

  return room.memberIds.find((memberId) => {
    const member = snapshot.members[memberId];
    if (!member) {
      return false;
    }

    return (
      member.handle === normalized
      || member.name === value
      || member.name === normalized
      || `@${member.handle}` === value
      || `@>${member.handle}` === value
    );
  });
}

function resolveTranscriptAuthor(snapshot: WorkspaceSnapshot, room: Room, label: string): ChatAuthor {
  if (label === snapshot.currentUserName) {
    return {
      kind: "user",
      id: "user",
      label,
    };
  }

  const memberId = resolveMemberIdByHandleOrName(snapshot, room, label);
  if (memberId) {
    return {
      kind: "member",
      id: memberId,
      label,
    };
  }

  return {
    kind: "system",
    id: `system:${label}`,
    label,
  };
}

function parseHandleTokens(raw: string): string[] {
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/^@>?/u, "").trim())
    .filter((token) => token.length > 0);
}

function parseTranscriptEntry(args: {
  lines: string[];
  entryIndex: number;
  room: Room;
  snapshot: WorkspaceSnapshot;
}): ChatMessage | undefined {
  const { lines, entryIndex, room, snapshot } = args;
  const [firstLine, ...restLines] = lines;
  if (!firstLine) {
    return undefined;
  }

  const headerMatch = /^- \[(.+?)\] (.+?) \((group|direct|watch-digest|status)\/(sent|streaming|completed|interrupted)\)$/u.exec(firstLine);
  if (!headerMatch) {
    return undefined;
  }

  const [, createdAt, authorLabel, transport, status] = headerMatch;
  if (!createdAt || !authorLabel || !transport || !status) {
    return undefined;
  }

  const contentLines: string[] = [];
  const mentionedMemberIds: string[] = [];
  const quotedMemberIds: string[] = [];

  restLines.forEach((line) => {
    if (!line.startsWith("  ")) {
      return;
    }

    const body = line.slice(2);
    if (body.startsWith("assignments: ")) {
      parseHandleTokens(body.slice("assignments: ".length)).forEach((handle) => {
        const memberId = resolveMemberIdByHandleOrName(snapshot, room, handle);
        if (memberId) {
          mentionedMemberIds.push(memberId);
        }
      });
      return;
    }

    if (body.startsWith("references: ")) {
      parseHandleTokens(body.slice("references: ".length)).forEach((handle) => {
        const memberId = resolveMemberIdByHandleOrName(snapshot, room, handle);
        if (memberId) {
          quotedMemberIds.push(memberId);
        }
      });
      return;
    }

    contentLines.push(body);
  });

  return {
    id: `history-md:${room.id}:${entryIndex}`,
    roomId: room.id,
    author: resolveTranscriptAuthor(snapshot, room, authorLabel),
    content: contentLines.join("\n"),
    createdAt,
    transport: transport as ChatMessage["transport"],
    status: status as ChatMessage["status"],
    visibility: "public",
    mentionedMemberIds,
    quotedMemberIds,
    recipientMemberIds: [],
  };
}

async function readTranscriptBootstrapMessages(args: {
  workspaceRoot: string;
  room: Room;
  project: Pick<Project, "path">;
  snapshot: WorkspaceSnapshot;
}): Promise<ChatMessage[]> {
  const transcriptPath = getRoomTranscriptFilePath(
    args.workspaceRoot,
    args.room,
    args.project,
  );

  try {
    const content = await readFile(transcriptPath, "utf8");
    const entries: string[][] = [];
    let currentEntry: string[] | undefined;

    content.split("\n").forEach((line) => {
      if (line.startsWith("- [")) {
        if (currentEntry) {
          entries.push(currentEntry);
        }
        currentEntry = [line];
        return;
      }

      if (currentEntry) {
        currentEntry.push(line);
      }
    });

    if (currentEntry) {
      entries.push(currentEntry);
    }

    return entries
      .map((lines, entryIndex) =>
        parseTranscriptEntry({
          lines,
          entryIndex,
          room: args.room,
          snapshot: args.snapshot,
        }),
      )
      .filter((message): message is ChatMessage => Boolean(message))
      .sort(compareHistoryMessages);
  } catch {
    return [];
  }
}

function mergeHistorySources(parsedTranscriptMessages: ChatMessage[], snapshotMessages: ChatMessage[]): ChatMessage[] {
  const snapshotBySignature = new Map(snapshotMessages.map((message) => [buildHistorySignature(message), message] as const));
  const consumedSignatures = new Set<string>();
  const merged: ChatMessage[] = [];

  parsedTranscriptMessages.forEach((message) => {
    const signature = buildHistorySignature(message);
    if (consumedSignatures.has(signature)) {
      return;
    }

    merged.push(snapshotBySignature.get(signature) ?? message);
    consumedSignatures.add(signature);
  });

  snapshotMessages.forEach((message) => {
    const signature = buildHistorySignature(message);
    if (consumedSignatures.has(signature)) {
      return;
    }

    merged.push(message);
    consumedSignatures.add(signature);
  });

  return merged.sort(compareHistoryMessages);
}

async function readRoomHistoryMessages(filePath: string): Promise<ChatMessage[]> {
  const raw = await readFile(filePath, "utf8");

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => chatMessageSchema.parse(JSON.parse(line)) satisfies ChatMessage)
    .sort(compareHistoryMessages);
}

async function ensureRoomMessageHistoryFile(args: {
  workspaceRoot: string;
  snapshot: WorkspaceSnapshot;
  room: Room;
  project: Pick<Project, "path">;
}): Promise<boolean> {
  const historyPath = getRoomMessageHistoryFilePath(
    args.workspaceRoot,
    args.room,
    args.project,
  );

  try {
    await access(historyPath);
    return false;
  } catch {
    await mkdir(path.dirname(historyPath), { recursive: true });

    const snapshotMessages = getVisibleMainRoomMessages(args.snapshot, args.room.id);
    const transcriptMessages = await readTranscriptBootstrapMessages(args);
    const bootstrapMessages = mergeHistorySources(transcriptMessages, snapshotMessages);
    const payload = bootstrapMessages.map((message) => `${JSON.stringify(message)}\n`).join("");

    await writeFile(historyPath, payload, "utf8");
    return true;
  }
}

function sanitizeHistoryLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) {
    return DEFAULT_HISTORY_PAGE_LIMIT;
  }

  return Math.min(MAX_HISTORY_PAGE_LIMIT, Math.max(1, Math.floor(limit)));
}

export function getRoomMessageHistoryFilePath(
  workspaceRoot: string,
  room: Room,
  project?: Pick<Project, "path">,
): string {
  return path.join(
    getRoomContextDirectoryPath(workspaceRoot, room, project),
    HISTORY_FILE_NAME,
  );
}

export async function syncRoomMessageHistoryFiles(args: {
  workspaceRoot: string;
  previous: WorkspaceSnapshot;
  next: WorkspaceSnapshot;
}): Promise<void> {
  const { workspaceRoot, previous, next } = args;

  await Promise.all(
    Object.values(next.rooms).map(async (room) => {
      const project = next.projects[room.projectId];
      if (!project) {
        return;
      }
      const historyCreated = await ensureRoomMessageHistoryFile({
        workspaceRoot,
        snapshot: next,
        room,
        project,
      });
      if (historyCreated) {
        return;
      }

      const previousMessageIds = new Set(previous.messageOrderByRoom[room.id] ?? []);
      const newEntries = getVisibleMainRoomMessages(next, room.id)
        .filter((message) => !previousMessageIds.has(message.id))
        .map((message) => `${JSON.stringify(message)}\n`)
        .join("");

      if (newEntries.length > 0) {
        await appendFile(
          getRoomMessageHistoryFilePath(workspaceRoot, room, project),
          newEntries,
          "utf8",
        );
      }
    }),
  );
}

export async function loadRoomMessageHistoryPage(args: {
  workspaceRoot: string;
  snapshot: WorkspaceSnapshot;
  room: Room;
  beforeMessageId?: MessageId;
  limit?: number;
}): Promise<RoomMessageHistoryPage> {
  const { workspaceRoot, snapshot, room, beforeMessageId } = args;
  const limit = sanitizeHistoryLimit(args.limit);
  const project = snapshot.projects[room.projectId];
  const historyPath = getRoomMessageHistoryFilePath(
    workspaceRoot,
    room,
    project,
  );

  await ensureRoomMessageHistoryFile({
    workspaceRoot,
    snapshot,
    room,
    project: project ?? {},
  });

  const allMessages = await readRoomHistoryMessages(historyPath);
  const visibleMemberIds = resolveRoomVisibleMemberIdSet(snapshot, room, snapshot.templates[room.templateId]);
  const filteredMessages = allMessages.filter((message) => isVisibleMainRoomMessage(message, visibleMemberIds));
  const beforeIndex =
    typeof beforeMessageId === "string"
      ? filteredMessages.findIndex((message) => message.id === beforeMessageId)
      : -1;
  const exclusiveEnd = beforeIndex >= 0 ? beforeIndex : filteredMessages.length;
  const startIndex = Math.max(0, exclusiveEnd - limit);
  const messages = filteredMessages.slice(startIndex, exclusiveEnd);

  return {
    roomId: room.id,
    messages,
    hasMore: startIndex > 0,
    nextCursor: startIndex > 0 ? filteredMessages[startIndex]?.id : undefined,
  };
}
