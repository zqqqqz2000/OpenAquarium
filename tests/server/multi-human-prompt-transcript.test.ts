import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage, setActiveAccount, upsertWorkspaceAccount } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { buildTaskPrompt } from "@/server/prompt-builder";
import { getRoomTranscriptFilePath, syncRoomTranscriptFiles } from "@/server/room-transcript-files";

describe("multi-human prompt and transcript", () => {
  it("shows human authors and plain human mentions across transcript and prompt", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-multi-human-"));
    const context = createRuntimeContext(9_500, "2026-03-11T13:30:00.000Z");
    const previous = createSeedWorkspace();
    let next = previous;
    const roomId = next.selection.roomId!;

    next = upsertWorkspaceAccount(
      next,
      {
        displayName: "Alice",
        handle: "alice",
        roomId,
        activate: true,
      },
      context,
    );
    next = postUserMessage(
      next,
      {
        roomId,
        content: "我是 Alice，这条消息应该显示 human 身份。",
      },
      context,
    );
    next = setActiveAccount(next, "account_default", roomId);
    next = postUserMessage(
      next,
      {
        roomId,
        content: "@alice 请确认 multi-human mention。",
      },
      context,
    );

    const room = next.rooms[roomId];
    const project = next.projects[room.projectId];
    const lead = room.memberIds.map((memberId) => next.members[memberId]).find((member) => member.handle === "lead");
    const task = Object.values(next.tasks).find((candidate) => candidate.memberId === lead?.id);

    if (!lead || !task) {
      throw new Error("Expected the lead member task");
    }

    await syncRoomTranscriptFiles({
      workspaceRoot,
      previous,
      next,
    });

    const transcript = await readFile(getRoomTranscriptFilePath(workspaceRoot, room), "utf8");
    const prompt = buildTaskPrompt({
      workspaceRoot,
      project,
      room,
      member: lead,
      task,
      snapshot: next,
    });

    expect(transcript).toContain("Alice @alice [human]");
    expect(transcript).toContain("mentions: @alice");
    expect(prompt).toContain("[Room Humans]");
    expect(prompt).toContain("- @alice: Alice");
    expect(prompt).toContain("Alice @alice [human]");
    expect(prompt).toContain("mentions: @alice");
  });
});
