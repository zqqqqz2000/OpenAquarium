import { createStore, type StoreApi } from "zustand/vanilla";

import { createRuntimeContext } from "@/domain/identity";
import type {
  CreateProjectInput,
  MemberId,
  RoomId,
  TaskId,
  WorkspaceSnapshot,
} from "@/domain/model";
import {
  completeMemberTask,
  createProjectWithRoom,
  extractMentionMemberIds,
  postMemberDraft,
  postUserMessage,
  runWatcher,
  toggleMemberMonitor,
  toggleWatcher,
  updateMemberPrompt,
} from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

function buildSyntheticDraft(snapshot: WorkspaceSnapshot, taskId: TaskId): string {
  const task = snapshot.tasks[taskId];
  const member = snapshot.members[task.memberId];
  const sourceMessage = snapshot.messages[task.sourceMessageId];
  const skillNames = member.skills.map((skill) => skill.name).slice(0, 2).join("、");

  if (sourceMessage.transport === "watch-digest") {
    return `收到 watcher 增量。我会根据 ${skillNames || "当前能力"} 回看这批消息，并只在发现新信息时出声。`;
  }

  if (sourceMessage.transport === "direct") {
    return `收到私信。我先按 ${skillNames || "当前能力"} 处理这个点，再决定是否回群里同步。`;
  }

  return `收到群消息。我会按 ${skillNames || "当前能力"} 先给出一版可执行方向，然后视情况 @其他成员。`;
}

function buildSyntheticFinal(snapshot: WorkspaceSnapshot, taskId: TaskId): string {
  const task = snapshot.tasks[taskId];
  const member = snapshot.members[task.memberId];
  const sourceMessage = snapshot.messages[task.sourceMessageId];

  if (sourceMessage.transport === "watch-digest") {
    return `${member.name} 已消费 watcher digest。当前只发现增量聊天，没有新增 blocker；如需继续动作，我会在下一轮轮询后补发。`;
  }

  if (sourceMessage.transport === "direct") {
    return `${member.name} 已处理这条私信。建议把结果沉淀回群组，避免上下文继续分叉。`;
  }

  return `${member.name} 给出了一版初步答复：先固定 provider 抽象、消息中断语义和 watcher cursor，再把 IM UI 接上。`;
}

function primeNewTasks(previous: WorkspaceSnapshot, next: WorkspaceSnapshot, seedContext: ReturnType<typeof createRuntimeContext>): WorkspaceSnapshot {
  let current = next;
  const newTaskIds = Object.keys(current.tasks).filter((taskId) => !previous.tasks[taskId]);

  newTaskIds.forEach((taskId) => {
    current = postMemberDraft(
      current,
      {
        taskId,
        content: buildSyntheticDraft(current, taskId),
      },
      seedContext,
    );
  });

  return current;
}

export interface WorkspaceStoreState {
  snapshot: WorkspaceSnapshot;
  createProject: (input: CreateProjectInput) => { projectId: string; roomId: string };
  selectRoom: (projectId: string, roomId: RoomId) => void;
  selectMember: (memberId?: MemberId) => void;
  sendUserMessage: (content: string, directMemberId?: MemberId) => void;
  advanceMember: (memberId: MemberId) => void;
  toggleMemberMonitoring: (memberId: MemberId) => void;
  toggleWatcherSchedule: (watcherId: string) => void;
  runWatcher: (watcherId: string) => void;
  updatePrompt: (memberId: MemberId, prompt: string) => void;
}

export function createWorkspaceStore(initialSnapshot = createSeedWorkspace()): StoreApi<WorkspaceStoreState> {
  const context = createRuntimeContext(2000, "2026-03-09T09:00:00.000Z");

  return createStore<WorkspaceStoreState>((set, get) => ({
    snapshot: initialSnapshot,
    createProject(input) {
      const previous = get().snapshot;
      let next = createProjectWithRoom(previous, input, context);
      next = primeNewTasks(previous, next, context);
      set({ snapshot: next });
      return {
        projectId: next.selection.projectId!,
        roomId: next.selection.roomId!,
      };
    },
    selectRoom(projectId, roomId) {
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          selection: {
            ...state.snapshot.selection,
            projectId,
            roomId,
          },
        },
      }));
    },
    selectMember(memberId) {
      set((state) => ({
        snapshot: {
          ...state.snapshot,
          selection: {
            ...state.snapshot.selection,
            memberId,
          },
        },
      }));
    },
    sendUserMessage(content, directMemberId) {
      const previous = get().snapshot;
      const roomId = previous.selection.roomId;

      if (!roomId || content.trim().length === 0) {
        return;
      }

      const mentionedMemberIds = extractMentionMemberIds(previous, roomId, content);
      let next = postUserMessage(
        previous,
        {
          roomId,
          content,
          mentionedMemberIds,
          directMemberId,
        },
        context,
      );
      next = primeNewTasks(previous, next, context);
      set({ snapshot: next });
    },
    advanceMember(memberId) {
      const previous = get().snapshot;
      const member = previous.members[memberId];
      const taskId = member?.activeTaskId;

      if (!taskId) {
        return;
      }

      const task = previous.tasks[taskId];
      const next = !task.draftMessageId
        ? postMemberDraft(
          previous,
          {
            taskId,
            content: buildSyntheticDraft(previous, taskId),
          },
          context,
        )
        : completeMemberTask(
          previous,
          {
            taskId,
            finalContent: buildSyntheticFinal(previous, taskId),
          },
          context,
        );

      set({ snapshot: next });
    },
    toggleMemberMonitoring(memberId) {
      set((state) => ({
        snapshot: toggleMemberMonitor(state.snapshot, memberId),
      }));
    },
    toggleWatcherSchedule(watcherId) {
      set((state) => ({
        snapshot: toggleWatcher(state.snapshot, watcherId),
      }));
    },
    runWatcher(watcherId) {
      const previous = get().snapshot;
      let next = runWatcher(previous, watcherId, context);
      next = primeNewTasks(previous, next, context);
      set({ snapshot: next });
    },
    updatePrompt(memberId, prompt) {
      set((state) => ({
        snapshot: updateMemberPrompt(state.snapshot, memberId, prompt),
      }));
    },
  }));
}
