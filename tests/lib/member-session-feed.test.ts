import { describe, expect, it } from "vitest";

import {
  getMemberSessionEntries,
  getMemberSessionTimelineEntries,
  type MemberSessionActivityEvent,
} from "@/lib/member-session-feed";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

function describeActivityEvent(entry: MemberSessionActivityEvent): string {
  if (entry.type === "room-message") {
    return `room:${entry.message.id}`;
  }

  if (entry.type === "tool") {
    return `tool:${entry.toolName}:${entry.status}`;
  }

  return entry.content;
}

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

  it("groups task room replies inside the task activity timeline and merges tool status updates", () => {
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

    const leadReply = Object.values(snapshot.messages).find(
      (message) =>
        message.author.kind === "member"
        && message.author.id === lead.id
        && message.transport === "group"
        && message.taskId === leadTask.id,
    );
    if (!leadReply) {
      throw new Error("Expected a lead room reply");
    }

    snapshot.taskTraces.trace_0201 = {
      id: "trace_0201",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "task-prompt",
      title: "Task prompt",
      content: "[Recent Room Transcript]\n[07:30] You: 原始上下文消息",
      createdAt: "2026-03-09T07:30:01.000Z",
    };
    snapshot.taskTraces.trace_0202 = {
      id: "trace_0202",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool call [call_1]",
      content: "Read message-feed.ts",
      createdAt: "2026-03-09T07:30:01.200Z",
    };
    snapshot.taskTraces.trace_0203 = {
      id: "trace_0203",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: "我先查代码和文档里这些开关对应的字段与行为。",
      createdAt: "2026-03-09T07:30:01.400Z",
    };
    snapshot.taskTraces.trace_0204 = {
      id: "trace_0204",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool completed [call_1]",
      content: "Read message-feed.ts",
      createdAt: "2026-03-09T08:00:00.100Z",
    };
    snapshot.taskTraces.trace_0205 = {
      id: "trace_0205",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "completed",
      title: "Task completed (stop)",
      content: leadReply.content,
      createdAt: "2026-03-09T08:00:00.200Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0201", "trace_0202", "trace_0203", "trace_0204", "trace_0205"];

    const entries = getMemberSessionTimelineEntries(snapshot, room, lead);
    const activityEntry = entries.find((entry) => entry.type === "activity" && entry.taskId === leadTask.id);

    if (!activityEntry || activityEntry.type !== "activity") {
      throw new Error("Expected a task activity entry");
    }

    expect(entries.some((entry) => entry.type === "message" && entry.id === leadReply.id)).toBe(false);
    expect(activityEntry.roomReplyCount).toBe(1);
    expect(activityEntry.latestInternalEvent?.content).toBe("我先查代码和文档里这些开关对应的字段与行为。");
    expect(activityEntry.events.map(describeActivityEvent)).toEqual([
      "tool:Read message-feed.ts:completed",
      "我先查代码和文档里这些开关对应的字段与行为。",
      `room:${leadReply.id}`,
    ]);
    expect(activityEntry.prompt).toContain("原始上下文消息");
  });

  it("falls back to the latest pending tool call when ACP reports a generic dynamic tool completion", () => {
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

    snapshot.taskTraces.trace_0210 = {
      id: "trace_0210",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool call",
      content: "Read member-session-feed.ts",
      createdAt: "2026-03-09T07:30:01.200Z",
    };
    snapshot.taskTraces.trace_0211 = {
      id: "trace_0211",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool completed",
      content: "acp.acp_provider_agent_dynamic_tool",
      createdAt: "2026-03-09T07:30:01.300Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0210", "trace_0211"];

    const entries = getMemberSessionTimelineEntries(snapshot, room, lead);
    const activityEntry = entries.find((entry) => entry.type === "activity" && entry.taskId === leadTask.id);

    if (!activityEntry || activityEntry.type !== "activity") {
      throw new Error("Expected a task activity entry");
    }

    const toolEvents = activityEntry.events.filter((event) => event.type === "tool");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({
      toolName: "Read member-session-feed.ts",
      status: "completed",
    });
  });

  it("treats legacy tool running titles as the same tool record when completion arrives", () => {
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

    snapshot.taskTraces.trace_0212 = {
      id: "trace_0212",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool running",
      content: "oa_send_group_message",
      createdAt: "2026-03-09T07:30:01.200Z",
    };
    snapshot.taskTraces.trace_0213 = {
      id: "trace_0213",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool completed",
      content: "acp.acp_provider_agent_dynamic_tool",
      createdAt: "2026-03-09T07:30:01.300Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0212", "trace_0213"];

    const entries = getMemberSessionTimelineEntries(snapshot, room, lead);
    const activityEntry = entries.find((entry) => entry.type === "activity" && entry.taskId === leadTask.id);

    if (!activityEntry || activityEntry.type !== "activity") {
      throw new Error("Expected a task activity entry");
    }

    const toolEvents = activityEntry.events.filter((event) => event.type === "tool");
    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({
      toolName: "oa_send_group_message",
      status: "completed",
    });
  });

  it("merges consecutive internal replies and restarts the stream after a tool boundary", () => {
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

    const leadReply = Object.values(snapshot.messages).find(
      (message) =>
        message.author.kind === "member"
        && message.author.id === lead.id
        && message.transport === "group"
        && message.taskId === leadTask.id,
    );
    if (!leadReply) {
      throw new Error("Expected a lead room reply");
    }

    const firstReplyPart = "我先查代码和文档里这些开关对应的字段与行为，确认它们在当前实现里的真实作用。";
    const secondReplyPart = "我已经定位到用户问的是成员配置/房间行为相关的开关。";
    const thirdReplyPart = "接下来直接查这些字段在代码里的定义和触发逻辑。";
    const fourthReplyPart = "我已经找到这些开关对应的底层字段。";

    snapshot.taskTraces.trace_0301 = {
      id: "trace_0301",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: firstReplyPart,
      createdAt: "2026-03-09T07:30:01.000Z",
    };
    snapshot.taskTraces.trace_0302 = {
      id: "trace_0302",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: `${firstReplyPart}${secondReplyPart}`,
      createdAt: "2026-03-09T07:30:01.050Z",
    };
    snapshot.taskTraces.trace_0303 = {
      id: "trace_0303",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool call",
      content: "Read message-feed.ts (called)",
      createdAt: "2026-03-09T07:30:01.100Z",
    };
    snapshot.taskTraces.trace_0304 = {
      id: "trace_0304",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: `${firstReplyPart}${secondReplyPart}${thirdReplyPart}`,
      createdAt: "2026-03-09T07:30:01.200Z",
    };
    snapshot.taskTraces.trace_0305 = {
      id: "trace_0305",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: `${firstReplyPart}${secondReplyPart}${thirdReplyPart}${fourthReplyPart}`,
      createdAt: "2026-03-09T07:30:01.250Z",
    };
    snapshot.taskTraces.trace_0306 = {
      id: "trace_0306",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "completed",
      title: "Task completed (stop)",
      content: leadReply.content,
      createdAt: "2026-03-09T08:00:00.200Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = [
      "trace_0301",
      "trace_0302",
      "trace_0303",
      "trace_0304",
      "trace_0305",
      "trace_0306",
    ];

    const entries = getMemberSessionTimelineEntries(snapshot, room, lead);
    const activityEntry = entries.find((entry) => entry.type === "activity" && entry.taskId === leadTask.id);

    if (!activityEntry || activityEntry.type !== "activity") {
      throw new Error("Expected a task activity entry");
    }

    expect(activityEntry.events.map(describeActivityEvent)).toEqual([
      `${firstReplyPart}${secondReplyPart}`,
      "tool:Read message-feed.ts:running",
      `${thirdReplyPart}${fourthReplyPart}`,
      `room:${leadReply.id}`,
    ]);
  });

  it("merges consecutive reasoning updates while keeping tool events separate", () => {
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

    snapshot.taskTraces.trace_0401 = {
      id: "trace_0401",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "ACP status",
      content: "Reasoning: approach ",
      createdAt: "2026-03-09T07:30:01.000Z",
    };
    snapshot.taskTraces.trace_0402 = {
      id: "trace_0402",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "ACP status",
      content: "Reasoning: plan",
      createdAt: "2026-03-09T07:30:01.050Z",
    };
    snapshot.taskTraces.trace_0403 = {
      id: "trace_0403",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool call",
      content: "Read member-session-feed.ts (called)",
      createdAt: "2026-03-09T07:30:01.100Z",
    };
    snapshot.taskTraces.trace_0404 = {
      id: "trace_0404",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "ACP status",
      content: "Reasoning: next step",
      createdAt: "2026-03-09T07:30:01.150Z",
    };
    snapshot.taskTraces.trace_0405 = {
      id: "trace_0405",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "ACP status",
      content: "Reasoning:.",
      createdAt: "2026-03-09T07:30:01.200Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = [
      "trace_0401",
      "trace_0402",
      "trace_0403",
      "trace_0404",
      "trace_0405",
    ];

    const entries = getMemberSessionTimelineEntries(snapshot, room, lead);
    const activityEntry = entries.find((entry) => entry.type === "activity" && entry.taskId === leadTask.id);

    if (!activityEntry || activityEntry.type !== "activity") {
      throw new Error("Expected a task activity entry");
    }

    expect(activityEntry.events.map(describeActivityEvent)).toEqual([
      "approach plan",
      "tool:Read member-session-feed.ts:running",
      "next step.",
      "room:message_0101",
    ]);
  });
});
