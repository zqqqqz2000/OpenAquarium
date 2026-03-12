import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatMessage, Room, TeamMember, WorkspaceSnapshot } from "../domain/model";
import { getMemberSessionEntries, type MemberSessionEntry } from "../lib/member-session-feed";
import { isVisibleMainRoomMessage } from "../lib/message-visibility";

function formatHandles(prefix: string, memberIds: string[], snapshot: WorkspaceSnapshot, marker = "@"): string[] {
  if (memberIds.length === 0) {
    return [];
  }

  return [`${prefix}: ${memberIds.map((memberId) => `${marker}${snapshot.members[memberId]?.handle ?? memberId}`).join(", ")}`];
}

function formatReferenceHandles(message: ChatMessage, snapshot: WorkspaceSnapshot): string[] {
  if ((message.quotedMemberIds?.length ?? 0) === 0) {
    return [];
  }

  return formatHandles("references", message.quotedMemberIds ?? [], snapshot);
}

function formatTranscriptEntry(snapshot: WorkspaceSnapshot, message: ChatMessage): string {
  const lines = [
    `- [${message.createdAt}] ${message.author.label} (${message.transport}/${message.status})`,
    `  ${message.content.replace(/\n/gu, "\n  ")}`,
    ...formatHandles("  assignments", message.mentionedMemberIds, snapshot, "@>"),
    ...formatReferenceHandles(message, snapshot).map((line) => `  ${line}`),
  ];

  return `${lines.join("\n")}\n`;
}

function getVisibleMainRoomMessages(snapshot: WorkspaceSnapshot, roomId: string): ChatMessage[] {
  return (snapshot.messageOrderByRoom[roomId] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is ChatMessage => Boolean(message) && isVisibleMainRoomMessage(message));
}

export function getRoomContextDirectoryPath(workspaceRoot: string, room: Room): string {
  return path.join(workspaceRoot, ".openaquarium", "rooms", room.projectId, room.id);
}

export function getRoomTranscriptFilePath(workspaceRoot: string, room: Room): string {
  return path.join(getRoomContextDirectoryPath(workspaceRoot, room), "messages.md");
}

export function getMemberHistoryFilePath(workspaceRoot: string, room: Room, member: TeamMember): string {
  return path.join(getRoomContextDirectoryPath(workspaceRoot, room), `member-${member.id}.md`);
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

function formatHistoryHandles(prefix: string, handles: string[], marker = "@"): string[] {
  return handles.length > 0 ? [`${prefix}: ${handles.map((handle) => `${marker}${handle}`).join(", ")}`] : [];
}

function formatHandlerSummaries(entry: Extract<MemberSessionEntry, { type: "message" }>): string[] {
  return entry.handlerSummaries.length > 0
    ? [
        `handlers: ${entry.handlerSummaries.map((handler) => `@${handler.handle} (${handler.title}, ${handler.status})`).join(", ")}`,
      ]
    : [];
}

function formatContextBadges(entry: Extract<MemberSessionEntry, { type: "message" }>): string[] {
  return entry.contextBadges.length > 0
    ? [`badges: ${entry.contextBadges.map((badge) => badge.label).join(", ")}`]
    : [];
}

function formatMemberHistoryEntry(entry: MemberSessionEntry): string {
  if (entry.type === "message") {
    const lines = [
      `- [${entry.createdAt}] message ${entry.message.author.label} (${entry.message.transport}/${entry.message.status})`,
      `  ${entry.message.content.replace(/\n/gu, "\n  ")}`,
      ...formatHistoryHandles("  assignments", entry.mentionedHandles, "@>"),
      ...formatHistoryHandles("  references", entry.quotedHandles),
      ...formatHistoryHandles("  recipients", entry.recipientHandles),
      ...formatContextBadges(entry).map((line) => `  ${line}`),
      ...formatHandlerSummaries(entry).map((line) => `  ${line}`),
    ];

    return `${lines.join("\n")}\n`;
  }

  const lines = [
    `- [${entry.createdAt}] trace ${entry.traceKind} | task: ${entry.taskTitle}`,
    `  title: ${entry.title}`,
    `  ${entry.content.replace(/\n/gu, "\n  ")}`,
  ];

  return `${lines.join("\n")}\n`;
}

async function ensureMemberHistoryFile(
  filePath: string,
  snapshot: WorkspaceSnapshot,
  room: Room,
  member: TeamMember,
): Promise<boolean> {
  try {
    await access(filePath);
    return false;
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    const entries = getMemberSessionEntries(snapshot, room, member)
      .map((entry) => formatMemberHistoryEntry(entry))
      .join("");
    const header = [
      `# ${member.name}`,
      "",
      `memberId: ${member.id}`,
      `handle: @${member.handle}`,
      `roomId: ${room.id}`,
      `projectId: ${room.projectId}`,
      "",
    ].join("\n");
    await writeFile(filePath, `${header}${entries}`, "utf8");
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
      const roomPreviouslyKnown = Boolean(previous.rooms[room.id]);
      const transcriptPath = getRoomTranscriptFilePath(workspaceRoot, room);
      const transcriptCreated = await ensureTranscriptFile(transcriptPath, next, room);

      if (!transcriptCreated && roomPreviouslyKnown) {
        const previousMessageIds = new Set(previous.messageOrderByRoom[room.id] ?? []);
        const newEntries = getVisibleMainRoomMessages(next, room.id)
          .filter((message) => !previousMessageIds.has(message.id))
          .map((message) => formatTranscriptEntry(next, message))
          .join("");

        if (newEntries.length > 0) {
          await appendFile(transcriptPath, newEntries, "utf8");
        }
      }

      await Promise.all(
        room.memberIds.map(async (memberId) => {
          const member = next.members[memberId];
          if (!member) {
            return;
          }

          const historyPath = getMemberHistoryFilePath(workspaceRoot, room, member);
          const historyCreated = await ensureMemberHistoryFile(historyPath, next, room, member);
          if (historyCreated || !roomPreviouslyKnown) {
            return;
          }

          const previousMember = previous.members[member.id];
          const previousEntries = previousMember ? getMemberSessionEntries(previous, room, previousMember) : [];
          const previousEntryIds = new Set(previousEntries.map((entry) => entry.id));
          const nextEntries = getMemberSessionEntries(next, room, member)
            .filter((entry) => !previousEntryIds.has(entry.id))
            .map((entry) => formatMemberHistoryEntry(entry))
            .join("");

          if (nextEntries.length > 0) {
            await appendFile(historyPath, nextEntries, "utf8");
          }
        }),
      );
    }),
  );
}
