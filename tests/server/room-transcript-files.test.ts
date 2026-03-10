import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { getRoomTranscriptFilePath, syncRoomTranscriptFiles } from "@/server/room-transcript-files";

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
});
