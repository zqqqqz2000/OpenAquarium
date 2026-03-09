import { createRuntimeContext } from "../../domain/identity";
import { completeMemberTask, createProjectWithRoom, createWorkspaceSnapshot, postMemberMessage, runWatcher } from "../../domain/workspace";
import type { WorkspaceSnapshot } from "../../domain/model";
import { defaultTemplates } from "./templates";

function simulateRoom(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const context = createRuntimeContext(100, "2026-03-09T08:00:00.000Z");
  const roomId = snapshot.selection.roomId;

  if (!roomId) {
    return snapshot;
  }

  let next = snapshot;
  const room = next.rooms[roomId];
  const members = room.memberIds.map((memberId) => next.members[memberId]);
  const lead = members.find((member) => member.isEntryMember);
  const builder = members.find((member) => member.handle === "builder");
  const researcher = members.find((member) => member.handle === "research");
  const scribe = members.find((member) => member.handle === "scribe");

  if (lead?.activeTaskId) {
    next = postMemberMessage(
      next,
      {
        roomId,
        memberId: lead.id,
        taskId: lead.activeTaskId,
        content: "先整理需求边界，然后 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。",
      },
      context,
    );
    next = completeMemberTask(
      next,
      {
        taskId: lead.activeTaskId,
      },
      context,
    );
  }

  if (researcher?.activeTaskId) {
    next = postMemberMessage(
      next,
      {
        roomId,
        memberId: researcher.id,
        taskId: researcher.activeTaskId,
        content: "现有 ACP 兼容层可以抽象成 provider descriptor，前端只依赖统一 schema。",
      },
      context,
    );
    next = completeMemberTask(
      next,
      {
        taskId: researcher.activeTaskId,
      },
      context,
    );
  }

  if (builder?.activeTaskId) {
    next = postMemberMessage(
      next,
      {
        roomId,
        memberId: builder.id,
        taskId: builder.activeTaskId,
        content: "ACP provider 我建议分成 `codex-acp` 和 `generic-acp` 两层，UI 只依赖统一 descriptor。",
      },
      context,
    );
    next = completeMemberTask(
      next,
      {
        taskId: builder.activeTaskId,
      },
      context,
    );
  }

  if (scribe) {
    const watcherId = room.watcherIds.find((candidate) => next.watchers[candidate]?.memberId === scribe.id);
    if (watcherId) {
      next = runWatcher(next, watcherId, context);
    }
  }

  if (scribe?.activeTaskId) {
    next = postMemberMessage(
      next,
      {
        roomId,
        memberId: scribe.id,
        taskId: scribe.activeTaskId,
        content: "已记录当前协作进展，后续 watcher 只会消费新增消息。",
      },
      context,
    );
    next = completeMemberTask(
      next,
      {
        taskId: scribe.activeTaskId,
      },
      context,
    );
  }

  return next;
}

export function createSeedWorkspace(): WorkspaceSnapshot {
  const context = createRuntimeContext(0, "2026-03-09T07:30:00.000Z");
  let snapshot = createWorkspaceSnapshot(defaultTemplates, "You");
  snapshot = createProjectWithRoom(
    snapshot,
    {
      projectName: "OpenAquarium",
      firstPrompt: "做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品",
      templateId: "template-product-pod",
    },
    context,
  );

  return simulateRoom(snapshot);
}
