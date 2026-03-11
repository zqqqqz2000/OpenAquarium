import path from "node:path";

import type { GlobalWorkspaceConfig, ProviderBinding, TeamMember, TeamTemplate, UpdateGlobalConfigInput, WorkspaceSnapshot } from "../domain/model";
import {
  appendTaskTrace,
  completeMemberTask,
  createRoomInProject,
  createProjectWithRoom,
  createWorkspaceSnapshot,
  deleteProject as deleteProjectFromWorkspace,
  deleteRoom as deleteRoomFromWorkspace,
  deleteTemplate as deleteTemplateFromWorkspace,
  extractMentionMemberIds,
  postMemberMessage,
  postMemberDraft,
  postUserMessage,
  runWatcher,
  setEntryMember,
  toggleMemberMonitor,
  toggleWatcher,
  updateMemberConfig,
  updateTemplate,
  updateMemberPrompt,
  upsertTaskTrace,
  upsertMemberWatcher,
} from "../domain/workspace";
import { createRuntimeContext, type MutationContext } from "../domain/identity";
import type {
  CreateProjectInput,
  CreateRoomInput,
  MemberId,
  PostMemberMessageInput,
  TemplateStudioChatMessage,
  UpsertWatcherInput,
  UpdateMemberConfigInput,
  UpdateTemplateInput,
} from "../domain/model";
import type { MemberExecutor, MemberExecutorFactory } from "./executor";
import { AcpMemberExecutor } from "./acp-executor";
import type { DiagnosticsLogger } from "./diagnostics";
import { summarizeWorkspaceSnapshot } from "./diagnostics";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { buildTaskPrompt } from "./prompt-builder";
import { WorkspacePersistence } from "./persistence";
import { OpenAquariumGlobalConfigManager } from "./global-config";
import { TemplateStudioChatService, type TemplateStudioChatServiceLike } from "./template-studio-chat";
import { generateTemplateFromBrief } from "./template-generator";
import { compactWorkspaceSnapshot } from "./workspace-snapshot-compact";
import { getRoomTranscriptFilePath, syncRoomTranscriptFiles } from "./room-transcript-files";
import { createDefaultWorkspaceSnapshot } from "../lib/default-workspace";
import { resolveDirectTarget } from "../lib/direct-target";
import { createDefaultGlobalWorkspaceConfig, findProviderModelProfile, resolveProviderBindingFromProfile } from "../lib/provider-model-profiles";

type SnapshotListener = (snapshot: WorkspaceSnapshot) => void;
type TemplateGenerator = (brief: string, args: { workspaceRoot: string; references: TeamTemplate[] }) => Promise<TeamTemplate>;

const STALE_RUNNING_TASK_MAX_AGE_MS = 5 * 60 * 1000;

export interface TaskStreamRoute {
  taskId: string;
  memberId: string;
  memberName: string;
  memberHandle: string;
}

export interface TaskStreamCallbacks {
  onTaskAccepted?(route: TaskStreamRoute): Promise<void> | void;
  onDraft?(event: TaskStreamRoute & { content: string; messageId?: string }): Promise<void> | void;
  onStatus?(event: TaskStreamRoute & { summary: string }): Promise<void> | void;
  onComplete?(event: TaskStreamRoute & { content: string; messageId?: string; stopReason: string }): Promise<void> | void;
  onError?(event: TaskStreamRoute & { message: string; messageId?: string }): Promise<void> | void;
}

interface TaskObserverEntry {
  route: TaskStreamRoute;
  callbacks: TaskStreamCallbacks;
  resolve(): void;
}

function cloneTemplates(snapshot: WorkspaceSnapshot): TeamTemplate[] {
  return snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
}

function mergeGlobalTemplatesIntoSnapshot(snapshot: WorkspaceSnapshot, globalTemplates: TeamTemplate[]): WorkspaceSnapshot {
  const globalTemplatesById = Object.fromEntries(globalTemplates.map((template) => [template.id, template]));
  const referencedSnapshotTemplateIds = Array.from(
    new Set(
      Object.values(snapshot.rooms)
        .map((room) => room.templateId)
        .filter((templateId) => templateId in snapshot.templates && !(templateId in globalTemplatesById)),
    ),
  );
  const mergedTemplateOrder = [
    ...globalTemplates.map((template) => template.id),
    ...referencedSnapshotTemplateIds,
  ];

  return {
    ...snapshot,
    templates: {
      ...Object.fromEntries(referencedSnapshotTemplateIds.map((templateId) => [templateId, snapshot.templates[templateId]])),
      ...globalTemplatesById,
    },
    templateOrder: mergedTemplateOrder,
  };
}

function bindingSignature(binding: ProviderBinding): string {
  return JSON.stringify({
    kind: binding.kind,
    label: binding.label,
    command: binding.command,
    args: binding.args,
    env: binding.env,
    workingDirectory: binding.workingDirectory,
    capabilities: binding.capabilities,
  });
}

function findChangedModelProfileIds(previous: GlobalWorkspaceConfig, next: GlobalWorkspaceConfig): Set<string> {
  const previousBindings = new Map(previous.modelProfiles.map((profile) => [profile.id, bindingSignature(profile.binding)]));
  const nextBindings = new Map(next.modelProfiles.map((profile) => [profile.id, bindingSignature(profile.binding)]));
  const ids = new Set<string>([...previousBindings.keys(), ...nextBindings.keys()]);
  const changed = new Set<string>();

  ids.forEach((profileId) => {
    if (previousBindings.get(profileId) !== nextBindings.get(profileId)) {
      changed.add(profileId);
    }
  });

  return changed;
}

function getIdSuffixValue(id: string): number | undefined {
  const match = id.match(/_(\d+)$/u);
  if (!match) {
    return undefined;
  }

  return Number.parseInt(match[1], 10);
}

function getSnapshotSequenceStart(snapshot: WorkspaceSnapshot): number {
  const ids = [
    ...Object.keys(snapshot.projects),
    ...Object.keys(snapshot.rooms),
    ...Object.keys(snapshot.templates),
    ...Object.keys(snapshot.members),
    ...Object.keys(snapshot.messages),
    ...Object.keys(snapshot.tasks),
    ...Object.keys(snapshot.taskTraces),
    ...Object.keys(snapshot.watchers),
  ];

  return ids.reduce((max, id) => {
    const suffix = getIdSuffixValue(id);
    return suffix !== undefined && suffix > max ? suffix : max;
  }, 10_000);
}

function getSnapshotTimeStart(snapshot: WorkspaceSnapshot): string {
  const timestamps = [
    ...Object.values(snapshot.projects).map((project) => project.createdAt),
    ...Object.values(snapshot.rooms).map((room) => room.createdAt),
    ...Object.values(snapshot.messages).map((message) => message.createdAt),
    ...Object.values(snapshot.tasks).flatMap((task) => [task.startedAt, task.updatedAt]),
    ...Object.values(snapshot.taskTraces).map((trace) => trace.createdAt),
  ]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  const latest = timestamps.length > 0 ? Math.max(...timestamps) : Date.now();
  return new Date(latest + 1_000).toISOString();
}

export class WorkspaceRuntime {
  private static readonly PROGRESS_PERSIST_DEBOUNCE_MS = 250;

  private snapshot: WorkspaceSnapshot;
  private readonly context: MutationContext;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly executors = new Map<MemberId, MemberExecutor>();
  private readonly runningTaskIds = new Set<string>();
  private readonly watcherTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly taskObservers = new Map<string, TaskObserverEntry>();
  private readonly persistence: WorkspacePersistence;
  private readonly workspaceRoot: string;
  private readonly globalConfigManager: OpenAquariumGlobalConfigManager;
  private readonly executorFactory: MemberExecutorFactory;
  private readonly templateStudioChatService: TemplateStudioChatServiceLike;
  private readonly templateGenerator: TemplateGenerator;
  private readonly logger?: DiagnosticsLogger;
  private globalConfig: GlobalWorkspaceConfig;
  private readonly executorKeys = new Map<MemberId, string>();
  private pendingProgressPersist = false;
  private pendingProgressPersistTimer: ReturnType<typeof setTimeout> | undefined;
  private persistenceChain: Promise<void> = Promise.resolve();

  constructor(args: {
    initialSnapshot: WorkspaceSnapshot;
    persistence: WorkspacePersistence;
    globalConfigManager?: OpenAquariumGlobalConfigManager;
    globalConfig?: GlobalWorkspaceConfig;
    templateStudioChatService?: TemplateStudioChatServiceLike;
    workspaceRoot: string;
    executorFactory?: MemberExecutorFactory;
    templateGenerator?: TemplateGenerator;
    context?: MutationContext;
    logger?: DiagnosticsLogger;
  }) {
    this.snapshot = args.initialSnapshot;
    this.context = args.context ?? createRuntimeContext(10_000, "2026-03-09T10:00:00.000Z");
    this.persistence = args.persistence;
    this.workspaceRoot = args.workspaceRoot;
    this.globalConfigManager = args.globalConfigManager ?? new OpenAquariumGlobalConfigManager();
    this.globalConfig = args.globalConfig ?? createDefaultGlobalWorkspaceConfig(this.globalConfigManager.directory);
    this.templateStudioChatService = args.templateStudioChatService ?? new TemplateStudioChatService();
    this.logger = args.logger;
    this.executorFactory =
      args.executorFactory ??
      (({ member }) =>
        new AcpMemberExecutor({
          workspaceRoot: this.workspaceRoot,
          member,
          host: {
            sendGroupMessage: async (input) => {
              await this.sendMemberMessage({
                roomId: input.roomId,
                memberId: input.memberId,
                content: input.content,
                taskId: input.taskId,
              });
            },
            sendDirectMessage: async (input) => {
              const target = resolveDirectTarget(this.snapshot, input.roomId, input.targetHandle);
              if (!target.directMemberId && !target.directToUser) {
                throw new Error(`Unknown direct target "${input.targetHandle}" in room "${input.roomId}"`);
              }

              await this.sendMemberMessage({
                roomId: input.roomId,
                memberId: input.memberId,
                content: input.content,
                ...target,
                taskId: input.taskId,
              });
            },
            runWatcher: async (input) => {
              await this.runWatcherNow(input.watcherId);
            },
            inspectRoomState: (input) => Promise.resolve(this.describeRoomState(input.roomId)),
            persistMemberSession: async (input) => {
              await this.persistMemberProviderSession(input.memberId, input.sessionId);
            },
          },
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
    configDirPath?: string;
    templateStudioChatService?: TemplateStudioChatServiceLike;
    executorFactory?: MemberExecutorFactory;
    templateGenerator?: TemplateGenerator;
    logger?: DiagnosticsLogger;
  }): Promise<WorkspaceRuntime> {
    const globalConfigManager = new OpenAquariumGlobalConfigManager(args.configDirPath);
    const loadedGlobalConfig = await globalConfigManager.load();
    const persistence = new WorkspacePersistence(
      args.stateFilePath ?? path.join(args.workspaceRoot, ".openaquarium", "state.json"),
      args.logger,
    );
    const loadedSnapshot = await persistence.load();
    const initialSnapshot = loadedSnapshot
      ? mergeGlobalTemplatesIntoSnapshot(loadedSnapshot, loadedGlobalConfig.templates)
      : createDefaultWorkspaceSnapshot("You", loadedGlobalConfig.templates);
    const runtime = new WorkspaceRuntime({
      initialSnapshot,
      persistence,
      globalConfigManager,
      globalConfig: loadedGlobalConfig.config,
      templateStudioChatService: args.templateStudioChatService,
      workspaceRoot: args.workspaceRoot,
      executorFactory: args.executorFactory,
      templateGenerator: args.templateGenerator,
      context: createRuntimeContext(getSnapshotSequenceStart(initialSnapshot), getSnapshotTimeStart(initialSnapshot)),
      logger: args.logger,
    });
    runtime.logger?.info("runtime-created", summarizeWorkspaceSnapshot(initialSnapshot));
    await runtime.expireStaleRunningTasks();
    const bootSnapshot = runtime.getSnapshot();
    await syncRoomTranscriptFiles({
      workspaceRoot: args.workspaceRoot,
      previous: createWorkspaceSnapshot(cloneTemplates(bootSnapshot), bootSnapshot.currentUserName),
      next: bootSnapshot,
    });
    runtime.syncWatchers();
    runtime.dispatchNewTasks(
      createWorkspaceSnapshot(cloneTemplates(bootSnapshot), bootSnapshot.currentUserName),
      bootSnapshot,
    );
    return runtime;
  }

  getSnapshot(): WorkspaceSnapshot {
    return this.snapshot;
  }

  getGlobalConfig(): GlobalWorkspaceConfig {
    return this.globalConfig;
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

  async deleteProject(projectId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = deleteProjectFromWorkspace(previous, projectId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async deleteRoom(roomId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = deleteRoomFromWorkspace(previous, roomId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
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

  async streamUserMessage(
    args: { roomId: string; content: string; directMemberId?: string },
    callbacks: TaskStreamCallbacks,
  ): Promise<void> {
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
    const nextTaskIds = Object.keys(next.tasks).filter((taskId) => !previous.tasks[taskId] && next.tasks[taskId]?.status === "running");

    if (nextTaskIds.length === 0) {
      await this.applySnapshot(previous, next);
      return;
    }

    const routes = nextTaskIds
      .map((taskId) => {
        const task = next.tasks[taskId];
        const member = task ? next.members[task.memberId] : undefined;
        if (!task || !member) {
          return undefined;
        }

        return {
          taskId: task.id,
          memberId: member.id,
          memberName: member.name,
          memberHandle: member.handle,
        } satisfies TaskStreamRoute;
      })
      .filter((route): route is TaskStreamRoute => route !== undefined);

    if (routes.length === 0) {
      await this.applySnapshot(previous, next);
      return;
    }

    for (const route of routes) {
      await callbacks.onTaskAccepted?.(route);
    }

    const completion = Promise.all(
      routes.map(
        (route) =>
          new Promise<void>((resolve) => {
            this.taskObservers.set(route.taskId, {
              route,
              callbacks,
              resolve,
            });
          }),
      ),
    );

    await this.applySnapshot(previous, next);
    await completion.finally(() => {
      routes.forEach((route) => {
        this.taskObservers.delete(route.taskId);
      });
    });
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
    const previousMember = previous.members[input.memberId];
    const nextMember = next.members[input.memberId];
    if (previousMember && nextMember && this.memberExecutionKey(previousMember) !== this.memberExecutionKey(nextMember)) {
      next.members[input.memberId] = {
        ...nextMember,
        providerSessionId: undefined,
      };
      this.disposeExecutor(input.memberId);
    }
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async updateTemplate(input: UpdateTemplateInput): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = updateTemplate(previous, input);
    await this.globalConfigManager.saveTemplates(
      next.templateOrder.map((templateId) => next.templates[templateId]),
    );
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async deleteTemplate(templateId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = deleteTemplateFromWorkspace(previous, templateId);
    await this.globalConfigManager.saveTemplates(
      next.templateOrder.map((candidateTemplateId) => next.templates[candidateTemplateId]),
    );
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async updateGlobalConfig(input: UpdateGlobalConfigInput): Promise<GlobalWorkspaceConfig> {
    const nextConfig = await this.globalConfigManager.saveConfig(input);
    const changedProfileIds = findChangedModelProfileIds(this.globalConfig, nextConfig);
    this.globalConfig = nextConfig;

    if (changedProfileIds.size > 0) {
      const previous = this.snapshot;
      let next = previous;
      let changedMembers = false;

      Object.values(previous.members).forEach((member) => {
        if (!member.modelProfileId || !changedProfileIds.has(member.modelProfileId)) {
          return;
        }

        this.disposeExecutor(member.id);
        if (!member.providerSessionId) {
          return;
        }

        changedMembers = true;
        next = {
          ...next,
          members: {
            ...next.members,
            [member.id]: {
              ...next.members[member.id],
              providerSessionId: undefined,
            },
          },
        };
      });

      if (changedMembers) {
        await this.applySnapshot(previous, next);
      }
    }

    return this.globalConfig;
  }

  async chatTemplateStudio(input: {
    templateId: string;
    messages: TemplateStudioChatMessage[];
    modelProfileId?: string;
  }): Promise<{ assistantMessage: string; snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; modelProfileId: string }> {
    const assistantReply = await this.templateStudioChatService.chat({
      configDirectory: this.globalConfigManager.directory,
      templateId: input.templateId,
      messages: input.messages,
      templates: cloneTemplates(this.snapshot),
      globalConfig: this.globalConfig,
      modelProfileId: input.modelProfileId,
    });

    const reloaded = await this.globalConfigManager.load();
    this.globalConfig = reloaded.config;
    const previous = this.snapshot;
    const next = mergeGlobalTemplatesIntoSnapshot(previous, reloaded.templates);
    await this.applySnapshot(previous, next);

    return {
      assistantMessage: assistantReply.assistantMessage,
      modelProfileId: assistantReply.modelProfileId,
      snapshot: this.snapshot,
      globalConfig: this.globalConfig,
    };
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
    if (!this.canRunWatcherNow(watcherId)) {
      return this.snapshot;
    }

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
    await this.globalConfigManager.saveTemplates(
      next.templateOrder.map((templateId) => next.templates[templateId]),
    );
    await this.applySnapshot(previous, next);
    return nextTemplate;
  }

  private describeRoomState(roomId: string): string {
    const room = this.snapshot.rooms[roomId];
    if (!room) {
      throw new Error(`Unknown room "${roomId}"`);
    }

    const transcript = (this.snapshot.messageOrderByRoom[roomId] ?? [])
      .slice(-20)
      .map((messageId) => {
        const message = this.snapshot.messages[messageId];
        return message ? `[${message.createdAt}] ${message.author.label}: ${message.content}` : undefined;
      })
      .filter((line): line is string => Boolean(line))
      .join("\n");

    const members = room.memberIds
      .map((memberId) => this.snapshot.members[memberId])
      .map((member) => `- ${member.name} (@${member.handle}) status=${member.status} entry=${member.isEntryMember}`)
      .join("\n");

    return [
      `room: ${room.name}`,
      `topic: ${room.topic}`,
      "",
      "[members]",
      members || "(none)",
      "",
      "[recent transcript]",
      transcript || "(none)",
    ].join("\n");
  }

  async dispose(): Promise<void> {
    this.watcherTimers.forEach((timer) => clearInterval(timer));
    this.watcherTimers.clear();
    await this.persistImmediately(this.snapshot);
    await Promise.all([...this.executors.values()].map((executor) => executor.dispose()));
    this.executors.clear();
    this.executorKeys.clear();
    await this.templateStudioChatService.dispose();
  }

  private async applySnapshot(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): Promise<void> {
    this.cleanupRemovedRuntimeState(previous, next);
    await syncRoomTranscriptFiles({
      workspaceRoot: this.workspaceRoot,
      previous,
      next,
    });
    this.snapshot = compactWorkspaceSnapshot(next);
    await this.persistImmediately(this.snapshot);
    this.logger?.info("snapshot-applied", summarizeWorkspaceSnapshot(this.snapshot));
    this.syncWatchers();
    this.emit();
    this.dispatchNewTasks(previous, this.snapshot);
  }

  private cleanupRemovedRuntimeState(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): void {
    const nextMemberIds = new Set(Object.keys(next.members));
    Object.keys(previous.members).forEach((memberId) => {
      if (!nextMemberIds.has(memberId)) {
        this.disposeExecutor(memberId);
      }
    });

    const nextTaskIds = new Set(Object.keys(next.tasks));
    [...this.runningTaskIds].forEach((taskId) => {
      if (!nextTaskIds.has(taskId)) {
        this.runningTaskIds.delete(taskId);
      }
    });

    [...this.taskObservers.entries()].forEach(([taskId, observer]) => {
      if (!nextTaskIds.has(taskId)) {
        observer.resolve();
        this.taskObservers.delete(taskId);
      }
    });
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private scheduleProgressPersistence(): void {
    this.pendingProgressPersist = true;

    if (this.pendingProgressPersistTimer) {
      return;
    }

    this.pendingProgressPersistTimer = setTimeout(() => {
      this.pendingProgressPersistTimer = undefined;
      void this.flushProgressPersistence();
    }, WorkspaceRuntime.PROGRESS_PERSIST_DEBOUNCE_MS);
  }

  private async flushProgressPersistence(): Promise<void> {
    if (!this.pendingProgressPersist) {
      return;
    }

    this.pendingProgressPersist = false;
    await this.enqueuePersistence(this.snapshot);
  }

  private async persistImmediately(snapshot: WorkspaceSnapshot): Promise<void> {
    if (this.pendingProgressPersistTimer) {
      clearTimeout(this.pendingProgressPersistTimer);
      this.pendingProgressPersistTimer = undefined;
    }
    this.pendingProgressPersist = false;
    await this.enqueuePersistence(snapshot);
  }

  private async enqueuePersistence(snapshot: WorkspaceSnapshot): Promise<void> {
    this.persistenceChain = this.persistenceChain.then(() => this.persistence.save(snapshot));
    await this.persistenceChain;
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
    this.runningTaskIds.add(taskId);
    try {
      this.logger?.info("task-execute-start", {
        taskId,
        roomId: room.id,
        memberId: member.id,
        memberHandle: member.handle,
        runningTasks: this.runningTaskIds.size,
      });
      const executor = this.getExecutor(member.id, member, room, project);
      const prompt = buildTaskPrompt({
        workspaceRoot: this.workspaceRoot,
        project,
        room,
        member: this.resolveMemberForExecution(member),
        task,
        snapshot: this.snapshot,
        transcriptFilePath: getRoomTranscriptFilePath(this.workspaceRoot, room),
      });
      this.snapshot = compactWorkspaceSnapshot(appendTaskTrace(
        this.snapshot,
        {
          taskId: task.id,
          roomId: room.id,
          memberId: member.id,
          kind: "task-prompt",
          title: "Task prompt",
          content: prompt,
        },
        this.context,
      ));
      this.scheduleProgressPersistence();
      this.emit();

      await executor.execute(
        {
          project,
          room,
          member: this.resolveMemberForExecution(member),
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
            this.snapshot = compactWorkspaceSnapshot(upsertTaskTrace(
              postMemberDraft(this.snapshot, { taskId, content }, this.context),
              {
                taskId,
                roomId: currentTask.roomId,
                memberId: currentTask.memberId,
                kind: "draft",
                title: "Internal draft",
                content,
              },
              this.context,
            ));
            this.scheduleProgressPersistence();
            this.emit();
            const logger = this.logger;
            if (logger && logger.shouldLog(`task-draft:${taskId}`, 800)) {
              logger.info("task-draft", {
                taskId,
                roomId: currentTask.roomId,
                memberId: currentTask.memberId,
                chars: content.length,
              });
            }
            const draftTask = this.snapshot.tasks[taskId];
            const observer = this.taskObservers.get(taskId);
            if (observer) {
              await observer.callbacks.onDraft?.({
                ...observer.route,
                content,
                messageId: draftTask?.draftMessageId,
              });
            }
          },
          onStatus: async (summary) => {
            const currentTask = this.snapshot.tasks[taskId];
            if (!currentTask || currentTask.status !== "running") {
              return;
            }
            this.snapshot = compactWorkspaceSnapshot(upsertTaskTrace(
              this.snapshot,
              {
                taskId,
                roomId: currentTask.roomId,
                memberId: currentTask.memberId,
                kind: "status",
                title: "ACP status",
                content: summary,
              },
              this.context,
            ));
            this.scheduleProgressPersistence();
            this.emit();
            this.logger?.info("task-status", {
              taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              summary,
              runningTasks: this.runningTaskIds.size,
            });
            const observer = this.taskObservers.get(taskId);
            if (observer) {
              await observer.callbacks.onStatus?.({
                ...observer.route,
                summary,
              });
            }
          },
          onComplete: async (finalContent, stopReason) => {
            const currentTask = this.snapshot.tasks[taskId];
            if (!currentTask || currentTask.status !== "running") {
              return;
            }
            const previous = this.snapshot;
            const snapshotWithTrace = appendTaskTrace(
              previous,
              {
                taskId,
                roomId: currentTask.roomId,
                memberId: currentTask.memberId,
                kind: "completed",
                title: `Task completed (${stopReason})`,
                content: finalContent.trim().length > 0 ? finalContent : stopReason,
              },
              this.context,
            );
            const next = completeMemberTask(
              snapshotWithTrace,
              {
                taskId,
                finalContent:
                  finalContent.trim().length > 0 ? finalContent : `${member.name} completed the task with stop reason: ${stopReason}`,
              },
              this.context,
            );
            await this.applySnapshot(previous, next);
            this.logger?.info("task-complete", {
              taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              stopReason,
              chars: finalContent.length,
              runningTasks: this.runningTaskIds.size,
            });
            const observer = this.taskObservers.get(taskId);
            if (observer) {
              await observer.callbacks.onComplete?.({
                ...observer.route,
                content: finalContent.trim().length > 0 ? finalContent : `${member.name} completed the task with stop reason: ${stopReason}`,
                messageId: this.snapshot.tasks[taskId]?.draftMessageId,
                stopReason,
              });
              observer.resolve();
            }
          },
          onError: async (message) => {
            const currentTask = this.snapshot.tasks[taskId];
            if (!currentTask || currentTask.status !== "running") {
              return;
            }
            const previous = this.snapshot;
            const snapshotWithTrace = appendTaskTrace(
              previous,
              {
                taskId,
                roomId: currentTask.roomId,
                memberId: currentTask.memberId,
                kind: "error",
                title: "Task failed",
                content: message,
              },
              this.context,
            );
            const next = completeMemberTask(
              snapshotWithTrace,
              {
                taskId,
                finalContent: `${member.name} failed to complete the task: ${message}`,
              },
              this.context,
            );
            await this.applySnapshot(previous, next);
            this.logger?.error("task-error", {
              taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              message,
              runningTasks: this.runningTaskIds.size,
            });
            const observer = this.taskObservers.get(taskId);
            if (observer) {
              await observer.callbacks.onError?.({
                ...observer.route,
                message,
                messageId: this.snapshot.tasks[taskId]?.draftMessageId,
              });
              observer.resolve();
            }
          },
        },
      );
    } catch (error) {
      const currentTask = this.snapshot.tasks[taskId];
      if (currentTask?.status === "running") {
        const currentMember = this.snapshot.members[currentTask.memberId];
        const previous = this.snapshot;
        const runtimeError = error as RuntimeError;
        const snapshotWithTrace = appendTaskTrace(
          previous,
          {
            taskId,
            roomId: currentTask.roomId,
            memberId: currentTask.memberId,
            kind: "error",
            title: "Task crashed before ACP completion",
            content: getErrorMessage(runtimeError),
          },
          this.context,
        );
        const next = completeMemberTask(
          snapshotWithTrace,
          {
            taskId,
            finalContent: `${currentMember.name} failed before returning a result: ${getErrorMessage(runtimeError)}`,
          },
          this.context,
        );
        await this.applySnapshot(previous, next);
        this.logger?.error("task-crash", {
          taskId,
          roomId: currentTask.roomId,
          memberId: currentTask.memberId,
          message: getErrorMessage(runtimeError),
          runningTasks: this.runningTaskIds.size,
        });
        const observer = this.taskObservers.get(taskId);
        if (observer) {
          await observer.callbacks.onError?.({
            ...observer.route,
            message: getErrorMessage(runtimeError),
            messageId: this.snapshot.tasks[taskId]?.draftMessageId,
          });
          observer.resolve();
        }
      }
    } finally {
      const observer = this.taskObservers.get(taskId);
      if (observer && this.snapshot.tasks[taskId]?.status !== "running") {
        observer.resolve();
      }
      this.runningTaskIds.delete(taskId);
    }
  }

  private getExecutor(memberId: string, member: WorkspaceSnapshot["members"][string], room: WorkspaceSnapshot["rooms"][string], project: WorkspaceSnapshot["projects"][string]): MemberExecutor {
    const executionKey = this.memberExecutionKey(member);
    const existing = this.executors.get(memberId);
    if (existing && this.executorKeys.get(memberId) === executionKey) {
      return existing;
    }

    if (existing) {
      void existing.dispose();
      this.executors.delete(memberId);
      this.executorKeys.delete(memberId);
    }

    const executor = this.executorFactory({
      member: this.resolveMemberForExecution(member),
      room,
      project,
    });
    this.executors.set(memberId, executor);
    this.executorKeys.set(memberId, executionKey);
    return executor;
  }

  private resolveMemberForExecution(member: TeamMember): TeamMember {
    const resolvedProvider = resolveProviderBindingFromProfile(
      member.provider,
      this.globalConfig.modelProfiles,
      member.modelProfileId,
    );

    if (resolvedProvider === member.provider) {
      return member;
    }

    return {
      ...member,
      provider: resolvedProvider,
    };
  }

  private memberExecutionKey(member: TeamMember): string {
    const resolvedProvider = resolveProviderBindingFromProfile(
      member.provider,
      this.globalConfig.modelProfiles,
      member.modelProfileId,
    );
    const resolvedProfile = findProviderModelProfile(this.globalConfig.modelProfiles, member.modelProfileId);

    return JSON.stringify({
      memberId: member.id,
      modelProfileId: resolvedProfile?.id ?? null,
      provider: resolvedProvider,
      providerSessionId: member.providerSessionId ?? null,
    });
  }

  private disposeExecutor(memberId: string): void {
    const executor = this.executors.get(memberId);
    if (!executor) {
      return;
    }

    void executor.dispose();
    this.executors.delete(memberId);
    this.executorKeys.delete(memberId);
  }

  private async persistMemberProviderSession(memberId: string, sessionId?: string): Promise<void> {
    const currentMember = this.snapshot.members[memberId];
    if (!currentMember || currentMember.providerSessionId === sessionId) {
      return;
    }

    this.snapshot = {
      ...this.snapshot,
      members: {
        ...this.snapshot.members,
        [memberId]: {
          ...currentMember,
          providerSessionId: sessionId,
        },
      },
    };
    await this.persistImmediately(this.snapshot);
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

  private hasRunningTaskInRoom(roomId: string): boolean {
    return Object.values(this.snapshot.tasks).some((task) => task.roomId === roomId && task.status === "running");
  }

  private canRunWatcherNow(watcherId: string): boolean {
    const watcher = this.snapshot.watchers[watcherId];
    if (!watcher || !watcher.enabled) {
      return false;
    }

    return !this.hasRunningTaskInRoom(watcher.roomId);
  }

  private async expireStaleRunningTasks(referenceTimeMs = Date.now()): Promise<void> {
    let nextSnapshot = this.snapshot;
    let didExpireTask = false;

    Object.values(this.snapshot.tasks)
      .filter((task) => task.status === "running")
      .forEach((task) => {
        const updatedAtMs = Date.parse(task.updatedAt);
        if (!Number.isFinite(updatedAtMs) || referenceTimeMs - updatedAtMs <= STALE_RUNNING_TASK_MAX_AGE_MS) {
          return;
        }

        const member = nextSnapshot.members[task.memberId];
        didExpireTask = true;
        const snapshotWithTrace = appendTaskTrace(
          nextSnapshot,
          {
            taskId: task.id,
            roomId: task.roomId,
            memberId: task.memberId,
            kind: "error",
            title: "Task expired after runtime restart",
            content: `Task exceeded ${Math.floor(STALE_RUNNING_TASK_MAX_AGE_MS / 60_000)} minutes without completing before the runtime restarted.`,
          },
          this.context,
        );
        nextSnapshot = completeMemberTask(
          snapshotWithTrace,
          {
            taskId: task.id,
            finalContent: `${member.name} did not finish before the runtime restarted, so the stale task was closed automatically.`,
          },
          this.context,
        );
      });

    if (!didExpireTask) {
      return;
    }

    this.snapshot = compactWorkspaceSnapshot(nextSnapshot);
    await this.persistImmediately(this.snapshot);
  }
}

export function createDefaultInitialSnapshot(): WorkspaceSnapshot {
  return createDefaultWorkspaceSnapshot();
}

export function createEmptyRuntimeSnapshot(): WorkspaceSnapshot {
  return createDefaultWorkspaceSnapshot();
}
