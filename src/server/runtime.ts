import path from "node:path";

import type { TeamTemplate, WorkspaceSnapshot } from "../domain/model";
import {
  completeMemberTask,
  createRoomInProject,
  createProjectWithRoom,
  createWorkspaceSnapshot,
  extractMentionMemberIds,
  postMemberMessage,
  postMemberDraft,
  postUserMessage,
  runWatcher,
  setEntryMember,
  toggleMemberMonitor,
  toggleWatcher,
  updateMemberConfig,
  updateMemberPrompt,
  upsertMemberWatcher,
} from "../domain/workspace";
import { createRuntimeContext } from "../domain/identity";
import type { CreateProjectInput, CreateRoomInput, MemberId, PostMemberMessageInput, UpsertWatcherInput, UpdateMemberConfigInput } from "../domain/model";
import type { MemberExecutor, MemberExecutorFactory } from "./executor";
import { AcpMemberExecutor } from "./acp-executor";
import { buildTaskPrompt } from "./prompt-builder";
import { WorkspacePersistence } from "./persistence";
import { generateTemplateFromBrief } from "./template-generator";
import { defaultTemplates } from "../lib/sample-data/templates";
import { createSeedWorkspace } from "../lib/sample-data/workspace";

type SnapshotListener = (snapshot: WorkspaceSnapshot) => void;
type TemplateGenerator = (brief: string, args: { workspaceRoot: string; references: TeamTemplate[] }) => Promise<TeamTemplate>;

function cloneTemplates(snapshot: WorkspaceSnapshot): TeamTemplate[] {
  return snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
}

export class WorkspaceRuntime {
  private snapshot: WorkspaceSnapshot;
  private readonly context = createRuntimeContext(10_000, "2026-03-09T10:00:00.000Z");
  private readonly listeners = new Set<SnapshotListener>();
  private readonly executors = new Map<MemberId, MemberExecutor>();
  private readonly runningTaskIds = new Set<string>();
  private readonly watcherTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly persistence: WorkspacePersistence;
  private readonly workspaceRoot: string;
  private readonly executorFactory: MemberExecutorFactory;
  private readonly templateGenerator: TemplateGenerator;

  constructor(args: {
    initialSnapshot: WorkspaceSnapshot;
    persistence: WorkspacePersistence;
    workspaceRoot: string;
    executorFactory?: MemberExecutorFactory;
    templateGenerator?: TemplateGenerator;
  }) {
    this.snapshot = args.initialSnapshot;
    this.persistence = args.persistence;
    this.workspaceRoot = args.workspaceRoot;
    this.executorFactory =
      args.executorFactory ??
      (({ member }) =>
        new AcpMemberExecutor({
          workspaceRoot: this.workspaceRoot,
          member,
        }));
    this.templateGenerator = args.templateGenerator ?? ((brief, generatorArgs) =>
      generateTemplateFromBrief(brief, {
        workspaceRoot: generatorArgs.workspaceRoot,
        references: generatorArgs.references,
      }));
  }

  static async create(args: {
    workspaceRoot: string;
    stateFilePath?: string;
    executorFactory?: MemberExecutorFactory;
    templateGenerator?: TemplateGenerator;
  }): Promise<WorkspaceRuntime> {
    const persistence = new WorkspacePersistence(
      args.stateFilePath ?? path.join(args.workspaceRoot, ".openaquarium", "state.json"),
    );
    const loadedSnapshot = await persistence.load();
    const initialSnapshot = loadedSnapshot ?? createSeedWorkspace();
    const runtime = new WorkspaceRuntime({
      initialSnapshot,
      persistence,
      workspaceRoot: args.workspaceRoot,
      executorFactory: args.executorFactory,
      templateGenerator: args.templateGenerator,
    });
    runtime.syncWatchers();
    runtime.dispatchNewTasks(createWorkspaceSnapshot(cloneTemplates(initialSnapshot), initialSnapshot.currentUserName), initialSnapshot);
    return runtime;
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async createProject(input: CreateProjectInput): Promise<{ snapshot: WorkspaceSnapshot; projectId: string; roomId: string }> {
    const previous = this.snapshot;
    const next = createProjectWithRoom(previous, input, this.context);
    await this.applySnapshot(previous, next);
    return {
      snapshot: this.snapshot,
      projectId: this.snapshot.selection.projectId!,
      roomId: this.snapshot.selection.roomId!,
    };
  }

  async createRoom(input: CreateRoomInput): Promise<{ snapshot: WorkspaceSnapshot; roomId: string }> {
    const previous = this.snapshot;
    const next = createRoomInProject(previous, input, this.context);
    await this.applySnapshot(previous, next);
    return {
      snapshot: this.snapshot,
      roomId: this.snapshot.selection.roomId!,
    };
  }

  async sendUserMessage(args: { roomId: string; content: string; directMemberId?: string }): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = postUserMessage(
      previous,
      {
        roomId: args.roomId,
        content: args.content,
        directMemberId: args.directMemberId,
        mentionedMemberIds: extractMentionMemberIds(previous, args.roomId, args.content),
      },
      this.context,
    );
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async sendMemberMessage(input: PostMemberMessageInput): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = postMemberMessage(previous, input, this.context);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async toggleMemberMonitoring(memberId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = toggleMemberMonitor(previous, memberId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async updatePrompt(memberId: string, prompt: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = updateMemberPrompt(previous, memberId, prompt);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async updateMemberConfig(input: UpdateMemberConfigInput): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = updateMemberConfig(previous, input);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async setEntryMember(memberId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = setEntryMember(previous, memberId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async upsertWatcher(input: UpsertWatcherInput): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = upsertMemberWatcher(previous, input, this.context);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async toggleWatcher(watcherId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = toggleWatcher(previous, watcherId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async runWatcherNow(watcherId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = runWatcher(previous, watcherId, this.context);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async generateTemplate(brief: string): Promise<TeamTemplate> {
    const nextTemplate = await this.templateGenerator(brief, {
      workspaceRoot: this.workspaceRoot,
      references: cloneTemplates(this.snapshot),
    });
    const previous = this.snapshot;
    const next: WorkspaceSnapshot = {
      ...previous,
      templates: {
        ...previous.templates,
        [nextTemplate.id]: nextTemplate,
      },
      templateOrder: previous.templateOrder.includes(nextTemplate.id)
        ? previous.templateOrder
        : [...previous.templateOrder, nextTemplate.id],
    };
    await this.applySnapshot(previous, next);
    return nextTemplate;
  }

  async dispose(): Promise<void> {
    this.watcherTimers.forEach((timer) => clearInterval(timer));
    this.watcherTimers.clear();
    await Promise.all([...this.executors.values()].map((executor) => executor.dispose()));
    this.executors.clear();
  }

  private async applySnapshot(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): Promise<void> {
    this.snapshot = next;
    await this.persistence.save(this.snapshot);
    this.syncWatchers();
    this.emit();
    this.dispatchNewTasks(previous, this.snapshot);
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private dispatchNewTasks(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): void {
    const previousTaskIds = new Set(Object.keys(previous.tasks));
    Object.values(next.tasks)
      .filter((task) => task.status === "running" && !previousTaskIds.has(task.id))
      .forEach((task) => {
        void this.executeTask(task.id);
      });
  }

  private async executeTask(taskId: string): Promise<void> {
    if (this.runningTaskIds.has(taskId)) {
      return;
    }

    const task = this.snapshot.tasks[taskId];
    if (!task || task.status !== "running") {
      return;
    }

    const member = this.snapshot.members[task.memberId];
    const room = this.snapshot.rooms[task.roomId];
    const project = this.snapshot.projects[room.projectId];
    const executor = this.getExecutor(member.id, member, room, project);
    const prompt = buildTaskPrompt({
      workspaceRoot: this.workspaceRoot,
      project,
      room,
      member,
      task,
      snapshot: this.snapshot,
    });

    this.runningTaskIds.add(taskId);

    await executor.execute(
      {
        project,
        room,
        member,
        task,
        snapshot: this.snapshot,
        prompt,
      },
      {
        onDraft: async (content) => {
          const currentTask = this.snapshot.tasks[taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          this.snapshot = postMemberDraft(this.snapshot, { taskId, content }, this.context);
          await this.persistence.save(this.snapshot);
          this.emit();
        },
        onStatus: async (summary) => {
          const currentTask = this.snapshot.tasks[taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          this.snapshot = postMemberDraft(
            this.snapshot,
            {
              taskId,
              content: `${this.snapshot.messages[currentTask.draftMessageId ?? ""]?.content ?? ""}\n\n[status] ${summary}`.trim(),
            },
            this.context,
          );
          await this.persistence.save(this.snapshot);
          this.emit();
        },
        onComplete: async (finalContent, stopReason) => {
          const currentTask = this.snapshot.tasks[taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          const previous = this.snapshot;
          const next = completeMemberTask(
            previous,
            {
              taskId,
              finalContent:
                finalContent.trim().length > 0 ? finalContent : `${member.name} completed the task with stop reason: ${stopReason}`,
            },
            this.context,
          );
          await this.applySnapshot(previous, next);
        },
        onError: async (message) => {
          const currentTask = this.snapshot.tasks[taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          const previous = this.snapshot;
          const next = completeMemberTask(
            previous,
            {
              taskId,
              finalContent: `${member.name} failed to complete the task: ${message}`,
            },
            this.context,
          );
          await this.applySnapshot(previous, next);
        },
      },
    );

    this.runningTaskIds.delete(taskId);
  }

  private getExecutor(memberId: string, member: WorkspaceSnapshot["members"][string], room: WorkspaceSnapshot["rooms"][string], project: WorkspaceSnapshot["projects"][string]): MemberExecutor {
    const existing = this.executors.get(memberId);
    if (existing) {
      return existing;
    }

    const executor = this.executorFactory({
      member,
      room,
      project,
    });
    this.executors.set(memberId, executor);
    return executor;
  }

  private syncWatchers(): void {
    const activeWatcherIds = new Set(Object.keys(this.snapshot.watchers));

    this.watcherTimers.forEach((timer, watcherId) => {
      const watcher = this.snapshot.watchers[watcherId];
      if (!watcher || !watcher.enabled) {
        clearInterval(timer);
        this.watcherTimers.delete(watcherId);
      }
    });

    Object.entries(this.snapshot.watchers).forEach(([watcherId, watcher]) => {
      if (!watcher.enabled || this.watcherTimers.has(watcherId)) {
        return;
      }

      const timer = setInterval(() => {
        void this.runWatcherNow(watcherId);
      }, watcher.intervalMinutes * 60 * 1000);
      this.watcherTimers.set(watcherId, timer);
    });

    [...this.watcherTimers.keys()].forEach((watcherId) => {
      if (!activeWatcherIds.has(watcherId)) {
        const timer = this.watcherTimers.get(watcherId);
        if (timer) {
          clearInterval(timer);
        }
        this.watcherTimers.delete(watcherId);
      }
    });
  }
}

export function createDefaultInitialSnapshot(): WorkspaceSnapshot {
  return createSeedWorkspace();
}

export function createEmptyRuntimeSnapshot(): WorkspaceSnapshot {
  return createWorkspaceSnapshot(defaultTemplates);
}
