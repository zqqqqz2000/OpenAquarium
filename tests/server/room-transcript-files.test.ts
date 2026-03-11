import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage, runWatcher } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { getMemberHistoryFilePath, getRoomTranscriptFilePath, syncRoomTranscriptFiles } from "@/server/room-transcript-files";

describe("room transcript files", () => {
  it("writes and appends visible room transcript entries", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-transcript-"));
    const context = createRuntimeContext(700, "2026-03-10T12:30:00.000Z");
    const previous = createSeedWorkspace();
    const room = previous.rooms[previous.selection.roomId!];
    const next = postUserMessage(
      previous,
      {
        roomId: room.id,
        content: "补一条新的 room 消息给 transcript。",
      },
      context,
    );

    await syncRoomTranscriptFiles({
      workspaceRoot,
      previous,
      next,
    });

    const transcriptPath = getRoomTranscriptFilePath(workspaceRoot, room);
    const content = await readFile(transcriptPath, "utf8");

    expect(content).toContain(`# ${room.name}`);
    expect(content).toContain("补一条新的 room 消息给 transcript。");
    expect(content).toContain("@builder @research 先整理需求边界");
  });

  it("keeps private watcher digests out of the room transcript file", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-transcript-watcher-"));
    const context = createRuntimeContext(900, "2026-03-10T12:50:00.000Z");
    const previous = createSeedWorkspace();
    const room = previous.rooms[previous.selection.roomId!];
    const scribe = room.memberIds
      .map((memberId) => previous.members[memberId])
      .find((member) => member.handle === "scribe");

    if (!scribe) {
      throw new Error("Expected the scribe member");
    }

    const watcherId = room.watcherIds.find((candidate) => previous.watchers[candidate]?.memberId === scribe.id);
    if (!watcherId) {
      throw new Error("Expected a watcher for the scribe member");
    }

    const withNewMessage = postUserMessage(
      previous,
      {
        roomId: room.id,
        content: "这条新消息应该出现在 transcript 里。",
      },
      context,
    );
    const next = runWatcher(withNewMessage, watcherId, context);

    await syncRoomTranscriptFiles({
      workspaceRoot,
      previous,
      next,
    });

    const transcriptPath = getRoomTranscriptFilePath(workspaceRoot, room);
    const content = await readFile(transcriptPath, "utf8");

    expect(content).toContain("这条新消息应该出现在 transcript 里。");
    expect(content).not.toContain("New room activity since last poll");
  });

  it("writes per-member session history files into the room context directory", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-member-history-"));
    const previous = createSeedWorkspace();
    const room = previous.rooms[previous.selection.roomId!];
    const lead = room.memberIds
      .map((memberId) => previous.members[memberId])
      .find((member) => member.handle === "lead");

    if (!lead) {
      throw new Error("Expected the lead member");
    }

    await syncRoomTranscriptFiles({
      workspaceRoot,
      previous: createSeedWorkspace(),
      next: previous,
    });

    const historyPath = getMemberHistoryFilePath(workspaceRoot, room, lead);
    const content = await readFile(historyPath, "utf8");

    expect(content).toContain(`# ${lead.name}`);
    expect(content).toContain(`handle: @${lead.handle}`);
    expect(content).toContain("trace task-started");
    expect(content).toContain("message You (group/sent)");
  });
});
