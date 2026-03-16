// @vitest-environment node

import { access, rm } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage } from "@/domain/workspace";
import { getVisibleRoomMessages } from "@/lib/chat/workspace-ui-message";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { getRoomMessageHistoryFilePath, loadRoomMessageHistoryPage } from "@/server/room-message-history";
import { syncRoomTranscriptFiles } from "@/server/room-transcript-files";
import { compactWorkspaceSnapshot, DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS } from "@/server/workspace-snapshot-compact";

describe("room message history", () => {
  it("loads older messages that were compacted out of the transport snapshot", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-room-history-"));
    const context = createRuntimeContext(2_000, "2026-03-11T09:00:00.000Z");
    const initial = createSeedWorkspace();
    const roomId = initial.selection.roomId;
    if (!roomId) {
      throw new Error("Expected selected room");
    }

    const room = initial.rooms[roomId];
    let next = initial;
    next = postUserMessage(next, { roomId, content: "history message 1" }, context);
    next = postUserMessage(next, { roomId, content: "history message 2" }, context);
    next = postUserMessage(next, { roomId, content: "history message 3" }, context);

    await syncRoomTranscriptFiles({
      workspaceRoot,
      previous: initial,
      next,
    });

    const compacted = compactWorkspaceSnapshot(next, {
      ...DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS,
      maxMessagesPerRoom: 2,
    });
    const compactedRoom = compacted.rooms[roomId];
    if (!compactedRoom) {
      throw new Error("Expected compacted room");
    }

    const fullVisibleMessages = getVisibleRoomMessages(next, room);
    const compactedVisibleMessages = getVisibleRoomMessages(compacted, compactedRoom);
    const earliestCompactedMessage = compactedVisibleMessages[0];
    if (!earliestCompactedMessage) {
      throw new Error("Expected compacted visible messages");
    }

    const page = await loadRoomMessageHistoryPage({
      workspaceRoot,
      snapshot: compacted,
      room: compactedRoom,
      beforeMessageId: earliestCompactedMessage.id,
      limit: 20,
    });

    const expectedOlderMessages = fullVisibleMessages.filter((message) => message.createdAt < earliestCompactedMessage.createdAt);
    expect(page.messages.map((message) => message.id)).toEqual(expectedOlderMessages.map((message) => message.id));
    expect(page.hasMore).toBe(false);
  });

  it("rebuilds the structured history file from the transcript when needed", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-room-history-bootstrap-"));
    const context = createRuntimeContext(3_000, "2026-03-11T10:30:00.000Z");
    const initial = createSeedWorkspace();
    const roomId = initial.selection.roomId;
    if (!roomId) {
      throw new Error("Expected selected room");
    }

    const room = initial.rooms[roomId];
    const next = postUserMessage(initial, { roomId, content: "bootstrap this history file" }, context);

    await syncRoomTranscriptFiles({
      workspaceRoot,
      previous: initial,
      next,
    });

    const historyPath = getRoomMessageHistoryFilePath(workspaceRoot, room);
    await rm(historyPath, { force: true });

    const compacted = compactWorkspaceSnapshot(next, {
      ...DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS,
      maxMessagesPerRoom: 1,
    });
    const compactedRoom = compacted.rooms[roomId];
    if (!compactedRoom) {
      throw new Error("Expected compacted room");
    }

    const earliestMessageId = compacted.messageOrderByRoom[roomId]?.[0];
    const page = await loadRoomMessageHistoryPage({
      workspaceRoot,
      snapshot: compacted,
      room: compactedRoom,
      beforeMessageId: earliestMessageId,
      limit: 10,
    });

    await expect(access(historyPath)).resolves.toBeUndefined();
    expect(page.messages.some((message) => message.content.includes("bootstrap this history file"))).toBe(false);
    expect(page.messages.length).toBeGreaterThan(0);
  });
});
