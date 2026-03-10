import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatMessage, Room, WorkspaceSnapshot } from "../domain/model";
import { isVisibleMainRoomMessage } from "../lib/message-visibility";

function formatHandles(prefix: string, memberIds: string[], snapshot: WorkspaceSnapshot): string[] {
  if (memberIds.length === 0) {
    return [];
  }

  return [`${prefix}: ${memberIds.map((memberId) => `@${snapshot.members[memberId]?.handle ?? memberId}`).join(", ")}`];
}

function formatQuotedHandles(message: ChatMessage, snapshot: WorkspaceSnapshot): string[] {
  if ((message.quotedMemberIds?.length ?? 0) === 0) {
    return [];
  }

  return [`quotes: ${message.quotedMemberIds?.map((memberId) => `"${snapshot.members[memberId]?.handle ?? memberId}`).join(", ")}`];
}

function formatTranscriptEntry(snapshot: WorkspaceSnapshot, message: ChatMessage): string {
  const lines = [
    `- [${message.createdAt}] ${message.author.label} (${message.transport}/${message.status})`,
    `  ${message.content.replace(/\n/gu, "\n  ")}`,
    ...formatHandles("  mentions", message.mentionedMemberIds, snapshot),
    ...formatQuotedHandles(message, snapshot).map((line) => `  ${line}`),
  ];

  return `${lines.join("\n")}\n`;
}

function getVisibleMainRoomMessages(snapshot: WorkspaceSnapshot, roomId: string): ChatMessage[] {
  return (snapshot.messageOrderByRoom[roomId] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is ChatMessage => Boolean(message) && isVisibleMainRoomMessage(message));
}

export function getRoomTranscriptFilePath(workspaceRoot: string, room: Room): string {
  return path.join(workspaceRoot, ".openaquarium", "transcripts", room.projectId, `${room.id}.md`);
}

async function ensureTranscriptFile(filePath: string, snapshot: WorkspaceSnapshot, room: Room): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    const messages = getVisibleMainRoomMessages(snapshot, room.id)
      .map((message) => formatTranscriptEntry(snapshot, message))
      .join("");
    const header = [
      `# ${room.name}`,
      "",
      `roomId: ${room.id}`,
      `projectId: ${room.projectId}`,
      `topic: ${room.topic || "(none)"}`,
      "",
    ].join("\n");
    await writeFile(filePath, `${header}${messages}`, "utf8");
    return true;
  }
}

export async function syncRoomTranscriptFiles(args: {
  workspaceRoot: string;
  previous: WorkspaceSnapshot;
  next: WorkspaceSnapshot;
}): Promise<void> {
  const { workspaceRoot, previous, next } = args;

  await Promise.all(
    Object.values(next.rooms).map(async (room) => {
      const filePath = getRoomTranscriptFilePath(workspaceRoot, room);
      const created = await ensureTranscriptFile(filePath, next, room);
      if (created) {
        return;
      }

      const previousMessageIds = new Set(previous.messageOrderByRoom[room.id] ?? []);
      const newEntries = getVisibleMainRoomMessages(next, room.id)
        .filter((message) => !previousMessageIds.has(message.id))
        .map((message) => formatTranscriptEntry(next, message))
        .join("");

      if (newEntries.length > 0) {
        await appendFile(filePath, newEntries, "utf8");
      }
    }),
  );
}
