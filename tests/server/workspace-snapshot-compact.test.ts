import { describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "@/domain/model";
import {
  DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS,
  compactWorkspaceSnapshot,
} from "@/server/workspace-snapshot-compact";

function buildSnapshot(): WorkspaceSnapshot {
  const roomId = "room_a";
  const memberId = "member_a";
  const messages: WorkspaceSnapshot["messages"] = {};
  const messageOrder: string[] = [];

  for (let index = 1; index <= 300; index += 1) {
    const messageId = `message_${index}`;
    messages[messageId] = {
      id: messageId,
      roomId,
      author: { kind: "user", id: "user", label: "You" },
      content: index === 300 ? "x".repeat(21_000) : `message ${index}`,
      createdAt: `2026-03-10T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      transport: "group",
      status: "sent",
      mentionedMemberIds: [],
      recipientMemberIds: [],
    };
    messageOrder.push(messageId);
  }

  const tasks: WorkspaceSnapshot["tasks"] = {};
  const taskTraces: WorkspaceSnapshot["taskTraces"] = {};
  const taskTraceOrderByTask: WorkspaceSnapshot["taskTraceOrderByTask"] = {};

  for (let index = 1; index <= 170; index += 1) {
    const taskId = `task_completed_${index}`;
    tasks[taskId] = {
      id: taskId,
      roomId,
      memberId,
      sourceMessageId: `message_${index}`,
      title: "Completed task",
      status: "completed",
      startedAt: `2026-03-10T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      updatedAt: `2026-03-10T10:10:${String(index % 60).padStart(2, "0")}.000Z`,
      draftMessageId: `message_${Math.min(index + 1, 300)}`,
    };
    taskTraceOrderByTask[taskId] = [];

    for (let traceIndex = 1; traceIndex <= 30; traceIndex += 1) {
      const traceId = `${taskId}_trace_${traceIndex}`;
      taskTraces[traceId] = {
        id: traceId,
        taskId,
        roomId,
        memberId,
        kind: "status",
        title: "Trace",
        content: `trace ${traceIndex}`,
        createdAt: `2026-03-10T10:20:${String(traceIndex % 60).padStart(2, "0")}.000Z`,
      };
      taskTraceOrderByTask[taskId].push(traceId);
    }
  }

  tasks.task_running = {
    id: "task_running",
    roomId,
    memberId,
    sourceMessageId: "message_1",
    title: "Running task",
    status: "running",
    startedAt: "2026-03-10T10:59:00.000Z",
    updatedAt: "2026-03-10T10:59:10.000Z",
    draftMessageId: "message_2",
  };
  taskTraceOrderByTask.task_running = ["trace_running"];
  taskTraces.trace_running = {
    id: "trace_running",
    taskId: "task_running",
    roomId,
    memberId,
    kind: "task-started",
    title: "Running",
    content: "still running",
    createdAt: "2026-03-10T10:59:00.000Z",
  };

  for (let traceIndex = 1; traceIndex <= 70; traceIndex += 1) {
    const traceId = `task_running_status_${traceIndex}`;
    taskTraces[traceId] = {
      id: traceId,
      taskId: "task_running",
      roomId,
      memberId,
      kind: "status",
      title: "Status",
      content:
        traceIndex === 70 ? "y".repeat(25_000) : `running status ${traceIndex}`,
      createdAt: `2026-03-10T10:59:${String(traceIndex % 60).padStart(2, "0")}.000Z`,
    };
    taskTraceOrderByTask.task_running.push(traceId);
  }

  return {
    projects: {
      project_a: {
        id: "project_a",
        name: "Project A",
        createdAt: "2026-03-10T10:00:00.000Z",
      },
    },
    projectOrder: ["project_a"],
    rooms: {
      [roomId]: {
        id: roomId,
        projectId: "project_a",
        name: "Room A",
        topic: "topic",
        templateId: "template_a",
        memberIds: [memberId],
        watcherIds: ["watcher_a"],
        entryMemberId: memberId,
        createdAt: "2026-03-10T10:00:00.000Z",
      },
    },
    roomOrderByProject: {
      project_a: [roomId],
    },
    templates: {
      template_a: {
        id: "template_a",
        name: "Template A",
        description: "desc",
        accentTone: "paper",
        members: [],
      },
    },
    templateOrder: ["template_a"],
    members: {
      [memberId]: {
        id: memberId,
        roomId,
        blueprintId: "blueprint_a",
        roleId: "blueprint_a",
        roleName: "member-a",
        name: "Member A",
        handle: "member-a",
        summary: "summary",
        prompt: "prompt",
        accentTone: "paper",
        skills: [],
        provider: {
          kind: "codex-acp",
          label: "Codex ACP",
          command: "npx",
          args: ["@zed-industries/codex-acp@^0.7.0"],
          env: {},
          capabilities: ["prompt"],
        },
        acceptsDirectMessages: true,
        isEntryMember: true,
        status: "running",
        activeTaskId: "task_running",
      },
    },
    messages,
    messageOrderByRoom: {
      [roomId]: messageOrder,
    },
    tasks,
    taskTraces,
    taskTraceOrderByTask,
    watchers: {
      watcher_a: {
        id: "watcher_a",
        roomId,
        memberId,
        enabled: true,
        intervalMinutes: 10,
        lastConsumedMessageId: "message_1",
      },
    },
    selection: {
      projectId: "project_a",
      roomId,
      memberId,
    },
    currentUserName: "You",
  };
}

describe("compactWorkspaceSnapshot", () => {
  it("keeps recent transcript, active tasks, and trims completed history", () => {
    const compacted = compactWorkspaceSnapshot(buildSnapshot());

    expect(compacted.messageOrderByRoom.room_a).toHaveLength(
      DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS.maxMessagesPerRoom,
    );
    expect(compacted.messageOrderByRoom.room_a[0]).toBe("message_61");
    expect(compacted.tasks.task_running).toBeDefined();
    expect(compacted.messages.message_1).toBeDefined();
    expect(compacted.messages.message_2).toBeDefined();

    const completedTaskIds = Object.keys(compacted.tasks).filter((taskId) =>
      taskId.startsWith("task_completed_"),
    );
    expect(completedTaskIds.length).toBeGreaterThanOrEqual(
      DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS.maxCompletedTasksPerRoom,
    );
    expect(completedTaskIds.length).toBeLessThan(170);
    expect(completedTaskIds).not.toContain("task_completed_1");
    expect(completedTaskIds).not.toContain("task_completed_2");
    expect(compacted.taskTraceOrderByTask.task_completed_170).toHaveLength(
      DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS.maxCompletedTaskTraces,
    );
    expect(compacted.taskTraceOrderByTask.task_running).toHaveLength(
      1 +
        DEFAULT_WORKSPACE_SNAPSHOT_COMPACTION_LIMITS.maxRunningTaskStatusTraces,
    );
    expect(compacted.messages.message_300?.content).toContain("[truncated ");
    const runningStatusTraceId =
      compacted.taskTraceOrderByTask.task_running.at(-1);
    expect(runningStatusTraceId).toBeDefined();
    expect(compacted.taskTraces[runningStatusTraceId!]?.content).toContain(
      "[truncated ",
    );
    expect(compacted.watchers.watcher_a.lastConsumedMessageId).toBe(
      compacted.messageOrderByRoom.room_a[
        compacted.messageOrderByRoom.room_a.length - 1
      ],
    );
  });
});
