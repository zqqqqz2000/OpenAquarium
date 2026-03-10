import { describe, expect, it } from "vitest";

import { getMemberSessionEntries } from "@/lib/member-session-feed";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("member session feed", () => {
  it("merges member-facing messages and task traces into one chronological session", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const lead = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "lead");

    if (!lead) {
      throw new Error("Expected a lead member");
    }

    const leadTask = Object.values(snapshot.tasks).find((task) => task.memberId === lead.id);
    if (!leadTask) {
      throw new Error("Expected a lead task");
    }

    snapshot.taskTraces.trace_0200 = {
      id: "trace_0200",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "task-prompt",
      title: "Task prompt",
      content: "[Recent Room Transcript]\n[07:30] You: 原始上下文消息",
      createdAt: "2026-03-09T07:30:01.500Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0200"];

    const entries = getMemberSessionEntries(snapshot, room, lead);
    const createdAtValues = entries.map((entry) => entry.createdAt);

    expect(entries.some((entry) => entry.type === "trace" && entry.id === "trace_0200")).toBe(true);
    expect(entries.some((entry) => entry.type === "message" && entry.message.author.id === lead.id)).toBe(true);
    expect(createdAtValues).toEqual([...createdAtValues].sort((left, right) => left.localeCompare(right)));
  });
});
