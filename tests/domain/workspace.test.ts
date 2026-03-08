import { describe, expect, it } from "vitest";

import { createRuntimeContext } from "@/domain/identity";
import {
  completeMemberTask,
  createProjectWithRoom,
  createWorkspaceSnapshot,
  extractMentionMemberIds,
  postMemberDraft,
  postUserMessage,
  runWatcher,
  setEntryMember,
  updateMemberConfig,
  upsertMemberWatcher,
} from "@/domain/workspace";
import { defaultTemplates } from "@/lib/sample-data/templates";

describe("workspace domain", () => {
  it("routes the first prompt to the entry member and derives a room name", () => {
    const context = createRuntimeContext();
    const snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        firstPrompt: "实现一个可中断的 agent team",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId;
    expect(roomId).toBeDefined();
    expect(snapshot.rooms[roomId!].name).toBe("实现一个可中断的 Agent Team");

    const entryMember = Object.values(snapshot.members).find((member) => member.isEntryMember);
    expect(entryMember?.activeTaskId).toBeDefined();
    expect(snapshot.tasks[entryMember!.activeTaskId!].title).toBe("Respond to user");
    expect(
      Object.values(snapshot.members)
        .filter((member) => !member.isEntryMember)
        .every((member) => member.activeTaskId === undefined),
    ).toBe(true);
  });

  it("interrupts a running member while preserving the streaming draft message", () => {
    const context = createRuntimeContext();
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        firstPrompt: "实现一个可中断的 agent team",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId!;
    const entryMember = Object.values(snapshot.members).find((member) => member.isEntryMember)!;
    snapshot = postMemberDraft(
      snapshot,
      {
        taskId: entryMember.activeTaskId!,
        content: "我已经拆出一半状态机，准备继续写 provider。",
      },
      context,
    );

    const draftMessageId = snapshot.tasks[entryMember.activeTaskId!].draftMessageId!;
    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "@lead 先别继续写 provider，改成先做群组 UI。",
        mentionedMemberIds: [entryMember.id],
      },
      context,
    );

    expect(snapshot.messages[draftMessageId].status).toBe("interrupted");
    expect(snapshot.messages[draftMessageId].content).toContain("状态机");
    expect(snapshot.members[entryMember.id].activeTaskId).not.toBe(snapshot.tasks[entryMember.activeTaskId!]?.interruptedByMessageId);
    expect(snapshot.members[entryMember.id].status).toBe("running");
  });

  it("extracts mentions by handle from message content", () => {
    const context = createRuntimeContext();
    const snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        firstPrompt: "实现一个可中断的 agent team",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId!;
    const mentionIds = extractMentionMemberIds(snapshot, roomId, "@builder 帮我补 UI，@scribe 负责记录");
    const handles = mentionIds.map((memberId) => snapshot.members[memberId].handle).sort();

    expect(handles).toEqual(["builder", "scribe"]);
  });

  it("only sends watcher digests when new room messages exist", () => {
    const context = createRuntimeContext();
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        firstPrompt: "实现一个可中断的 agent team",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId!;
    const watcherId = snapshot.rooms[roomId].watcherIds[0];
    const firstRun = runWatcher(snapshot, watcherId, context);
    const secondRun = runWatcher(firstRun, watcherId, context);

    const digestMessages = (secondRun.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => secondRun.messages[messageId])
      .filter((message) => message.transport === "watch-digest");

    expect(digestMessages).toHaveLength(1);
    expect(digestMessages[0].content).toContain("New room activity");
    expect(secondRun.watchers[watcherId].lastConsumedMessageId).toBeDefined();
  });

  it("does not auto-route monitor-all members when a teammate sends a normal group reply", () => {
    const context = createRuntimeContext();
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        firstPrompt: "实现一个可中断的 agent team",
        templateId: "template-product-pod",
      },
      context,
    );

    const lead = Object.values(snapshot.members).find((member) => member.isEntryMember);
    const scribe = Object.values(snapshot.members).find((member) => member.handle === "scribe");
    expect(lead?.activeTaskId).toBeDefined();
    expect(scribe?.observeAllRoomMessages).toBe(true);
    expect(scribe?.activeTaskId).toBeUndefined();

    snapshot = completeMemberTask(
      snapshot,
      {
        taskId: lead!.activeTaskId!,
        finalContent: "我先整理范围，暂时不委派其他成员。",
      },
      context,
    );

    expect(Object.values(snapshot.tasks).filter((task) => task.status === "running")).toHaveLength(0);
    expect(snapshot.members[scribe!.id].activeTaskId).toBeUndefined();
  });

  it("updates member config, supports entry-member reassignment, and respects direct-message opt-out", () => {
    const context = createRuntimeContext();
    let snapshot = createProjectWithRoom(
      createWorkspaceSnapshot(defaultTemplates),
      {
        projectName: "ACP Lab",
        firstPrompt: "实现一个可中断的 agent team",
        templateId: "template-product-pod",
      },
      context,
    );

    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder")!;

    snapshot = updateMemberConfig(snapshot, {
      memberId: builder.id,
      summary: "新的 builder summary",
      prompt: "新的 builder prompt",
      acceptsDirectMessages: false,
      skills: [
        {
          id: "ship",
          name: "Ship code",
          description: "提交改动",
          command: "./bin/oa-room-send --scope group --text \"已提交\"",
        },
      ],
      provider: {
        ...builder.provider,
        command: "claude-code",
        args: ["--stdio"],
        env: { ANTHROPIC_API_KEY: "demo" },
        capabilities: ["prompt", "cancel"],
      },
    });
    snapshot = setEntryMember(snapshot, builder.id);
    snapshot = upsertMemberWatcher(
      snapshot,
      {
        memberId: builder.id,
        enabled: true,
        intervalMinutes: 7,
      },
      context,
    );
    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "这是一条 direct message",
        directMemberId: builder.id,
      },
      context,
    );

    expect(snapshot.members[builder.id].provider.command).toBe("claude-code");
    expect(snapshot.members[builder.id].skills).toHaveLength(1);
    expect(snapshot.rooms[roomId].entryMemberId).toBe(builder.id);
    expect(snapshot.members[builder.id].isEntryMember).toBe(true);
    expect(snapshot.rooms[roomId].watcherIds.some((watcherId) => snapshot.watchers[watcherId]?.memberId === builder.id)).toBe(true);
    expect(snapshot.members[builder.id].activeTaskId).toBeUndefined();
  });
});
