#!/usr/bin/env bun
import process from "node:process";

const serverUrl = process.env.OA_SERVER_URL ?? "http://127.0.0.1:4301";

function readFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function sendMemberMessage(): Promise<void> {
  const roomId = readFlag("--room");
  const memberId = readFlag("--member");
  const scope = readFlag("--scope") ?? "group";
  const target = readFlag("--target");
  const text = readFlag("--text");

  if (!roomId || !memberId || !text) {
    throw new Error("room-send requires --room, --member and --text");
  }

  const response = await fetch(`${serverUrl}/api/internal/member-message`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      roomId,
      memberId,
      content: text,
      targetHandle: scope === "direct" ? target : undefined,
    }),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function runWatcherCommand(): Promise<void> {
  const watcherId = readFlag("--watcher");
  if (!watcherId) {
    throw new Error("room-watch requires --watcher");
  }

  const response = await fetch(`${serverUrl}/api/watchers/${watcherId}/run`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

async function printRoomState(): Promise<void> {
  const roomId = readFlag("--room");
  const response = await fetch(`${serverUrl}/api/state`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const payload = (await response.json()) as { snapshot: { messageOrderByRoom: Record<string, string[]>; messages: Record<string, { content: string }> } };
  const messageIds = roomId ? payload.snapshot.messageOrderByRoom[roomId] ?? [] : [];
  const lines = messageIds.map((messageId) => payload.snapshot.messages[messageId]?.content ?? "");
  console.log(lines.join("\n---\n"));
}

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case "room-send":
      await sendMemberMessage();
      return;
    case "room-watch":
      await runWatcherCommand();
      return;
    case "room-state":
      await printRoomState();
      return;
    default:
      throw new Error(`Unknown command "${command ?? "(missing)"}"`);
  }
}

void main();
