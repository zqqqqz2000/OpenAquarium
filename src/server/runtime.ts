import path from "node:path";
import { watch, type FSWatcher } from "node:fs";

import type {
  GlobalWorkspaceConfig,
  ProviderBinding,
  ProviderConnectionTestResult,
  RoomMessageHistoryPage,
  TeamMember,
  TeamTemplate,
  TemplateStudioModelCatalog,
  UpdateGlobalConfigInput,
  UpdateRoomSettingsInput,
  WorkspaceSnapshot,
} from "../domain/model";
import {
  acknowledgeWatcherDigestVisibility,
  acknowledgeRoom,
  appendTaskTrace,
  executeRoleStaffingOperation,
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
  postSystemMessage,
  postUserMessage,
  pauseWatcherUntilActivity as pauseWatcherUntilActivityInWorkspace,
  runWatcher,
  setEntryMember,
  toggleRoomWatcherSuspension as toggleRoomWatcherSuspensionInWorkspace,
  toggleWatcher,
  updateMemberConfig,
  updateRoomSettings as updateRoomSettingsInWorkspace,
  updateRoomTeam as updateRoomTeamInWorkspace,
  updateTemplate,
  updateMemberPrompt,
  upsertTaskTrace,
  upsertMemberWatcher,
  syncUnreadStateForMessage,
} from "../domain/workspace";
import type { applyRoleStaffingOperation } from "../domain/workspace";
import { createRuntimeContext, createSystemClockContext, type MutationContext } from "../domain/identity";
import type {
  CreateProjectInput,
  CreateRoomInput,
  MemberId,
  PostMemberMessageInput,
  UpdateRoomTeamInput,
  TemplateStudioChatMessage,
  UpsertWatcherInput,
  UpdateMemberConfigInput,
  UpdateTemplateInput,
} from "../domain/model";
import type { ExecutionMember, ExecutionRequest, MemberExecutor, MemberExecutorFactory } from "./executor";
import { AcpMemberExecutor } from "./acp-executor";
import { OpenAICompatibleMemberExecutor } from "./openai-compatible-executor";
import type { DiagnosticsLogger } from "./diagnostics";
import { summarizeWorkspaceSnapshot } from "./diagnostics";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { buildTaskPromptPayload } from "./prompt-builder";
import { WorkspacePersistence } from "./persistence";
import { OpenAquariumGlobalConfigManager } from "./global-config";
import { TemplateStudioChatService, type TemplateStudioChatServiceLike } from "./template-studio-chat";
import { generateTemplateFromBrief } from "./template-generator";
import { compactWorkspaceSnapshot } from "./workspace-snapshot-compact";
import { getRoomTranscriptFilePath, syncRoomTranscriptFiles } from "./room-transcript-files";
import { loadRoomMessageHistoryPage, syncRoomMessageHistoryFiles } from "./room-message-history";
import { normalizeProjectPath, resolveProjectWorkingDirectory } from "./project-paths";
import { createDefaultWorkspaceSnapshot } from "../lib/default-workspace";
import { resolveDirectTarget } from "../lib/direct-target";
import { buildProviderModelProfileFromDraft, type ModelProfileDraft } from "../lib/global-config-draft";
import { isVisibleMemberRoomMessage } from "../lib/message-visibility";
import { CODEX_ACP_THINKING_DEPTH_ENV_KEY } from "../lib/acp/providers/codex-session";
import { createDefaultGlobalWorkspaceConfig, findProviderModelProfile, resolveProviderBindingFromProfile } from "../lib/provider-model-profiles";
import { OPENAQUARIUM_PROVIDER_TEST_PROMPT } from "../lib/provider-test";
import { resolveRoomTeamSummary } from "../lib/room-team";
import { loadSkillCatalog, type SkillCatalogEntry } from "./skills";
import type { TemplateStudioUIMessage } from "../lib/template-studio-ui-message";

type SnapshotListener = (snapshot: WorkspaceSnapshot) => void;
type TemplateGenerator = (brief: string, args: { workspaceRoot: string; references: TeamTemplate[] }) => Promise<TeamTemplate>;

const STALE_RUNNING_TASK_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_TASK_EXECUTION_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_TASK_EXECUTION_MAX_RETRIES = 5;
const RUNNING_TASK_REAPER_MAX_INTERVAL_MS = 60 * 1000;

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

export interface TemplateStudioChatStreamSession {
  modelProfileId: string;
  modelId?: string;
  result: Awaited<ReturnType<TemplateStudioChatServiceLike["stream"]>>["result"];
  finalize(): Promise<{ snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; modelProfileId: string; modelId?: string }>;
  cleanup(): Promise<void>;
}

interface TaskObserverEntry {
  route: TaskStreamRoute;
  callbacks: TaskStreamCallbacks;
  resolve(): void;
}

interface WatcherTimerEntry {
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
}

export type WatcherRunOutcome = "triggered" | "busy" | "disabled" | "suspended" | "baselined" | "idle";

class TaskExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskExecutionTimeoutError";
  }
}

class TaskExecutionProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskExecutionProtocolError";
  }
}

interface TaskExecutionWatchdog {
  timeoutPromise: Promise<never>;
  touch(): void;
  dispose(): void;
}

function createTaskExecutionWatchdog(args: {
  timeoutMs: number | undefined;
  label: string;
  onTimeout(): void;
}): TaskExecutionWatchdog | undefined {
  if (!args.timeoutMs || args.timeoutMs <= 0) {
    return undefined;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let active = true;
  let rejectTimeout: ((error: Error) => void) | undefined;

  const schedule = (): void => {
    if (!active) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      if (!active) {
        return;
      }

      active = false;
      args.onTimeout();
      rejectTimeout?.(new TaskExecutionTimeoutError(`${args.label} timed out after ${args.timeoutMs}ms`));
    }, args.timeoutMs);
  };

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
    schedule();
  });

  return {
    timeoutPromise,
    touch: schedule,
    dispose: () => {
      active = false;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

function buildTaskExecutionTimeoutMessage(timeoutMs: number): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1_000));
  return `当前任务在 ${seconds} 秒内没有新的进度或完成信号，已自动结束。可能是模型服务无响应、达到使用上限，或 ACP 会话卡住。`;
}

function buildTaskExecutionRetryMessage(args: { timeoutMs: number; retryAttempt: number; maxRetries: number }): string {
  const seconds = Math.max(1, Math.round(args.timeoutMs / 1_000));
  return `当前任务在 ${seconds} 秒内没有新的进度或完成信号，已判定为卡死，正在重试（${args.retryAttempt}/${args.maxRetries}）。`;
}

function buildVisibleTaskFailureContent(member: Pick<TeamMember, "handle">, message: string): string {
  const compactMessage = message.replace(/\s+/g, " ").trim();
  const prefix = `@${member.handle} 任务执行失败`;

  return compactMessage.length > 0 ? `${prefix}：${compactMessage}` : `${prefix}。`;
}

const TOOL_STATUS_PREFIX = "__oa_tool__";

function describeTaskStatusTrace(summary: string): {
  append: boolean;
  title: string;
  content: string;
} {
  const reasoningMatch = /^Reasoning:(.*)$/su.exec(summary);
  if (reasoningMatch && reasoningMatch[1].trim().length > 0) {
    return {
      append: false,
      title: "Reasoning",
      content: reasoningMatch[1],
    };
  }

  const trimmedSummary = summary.trim();
  if (trimmedSummary.startsWith(TOOL_STATUS_PREFIX)) {
    try {
      const rawPayload = JSON.parse(trimmedSummary.slice(TOOL_STATUS_PREFIX.length)) as {
        toolCallId?: string;
        toolName?: string;
        status?: "running" | "completed";
      };
      const toolName = rawPayload.toolName?.trim() || "Tool";
      const toolCallIdSuffix = rawPayload.toolCallId?.trim() ? ` [${rawPayload.toolCallId.trim()}]` : "";

      return {
        append: true,
        title: rawPayload.status === "completed" ? `Tool completed${toolCallIdSuffix}` : `Tool call${toolCallIdSuffix}`,
        content: toolName,
      };
    } catch {
      return {
        append: false,
        title: "ACP status",
        content: trimmedSummary,
      };
    }
  }

  const toolCalledMatch = /^(.+?)\s+\(called\)$/u.exec(trimmedSummary);
  if (toolCalledMatch?.[1]) {
    return {
      append: true,
      title: "Tool call",
      content: toolCalledMatch[1],
    };
  }

  const toolCompletedMatch = /^(.+?)\s+\(completed\)$/u.exec(trimmedSummary);
  if (toolCompletedMatch?.[1]) {
    return {
      append: true,
      title: "Tool completed",
      content: toolCompletedMatch[1],
    };
  }

  return {
    append: false,
    title: "ACP status",
    content: trimmedSummary,
  };
}

function concatenateReasoningContent(previousContent: string, nextContent: string): string {
  if (previousContent.length === 0 || nextContent.length === 0) {
    return `${previousContent}${nextContent}`;
  }

  if (/\s$/u.test(previousContent) || /^\s/u.test(nextContent)) {
    return `${previousContent}${nextContent}`;
  }

  if (/^[.,;:!?)}\]]/u.test(nextContent)) {
    return `${previousContent}${nextContent}`;
  }

  if (/[\p{L}\p{N}]$/u.test(previousContent) && /^[\p{L}\p{N}]/u.test(nextContent)) {
    return `${previousContent} ${nextContent}`;
  }

  return `${previousContent}${nextContent}`;
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

function bindingSignature(binding: GlobalWorkspaceConfig["modelProfiles"][number]["binding"] | ProviderBinding): string {
  if (binding.kind === "openai-compatible") {
    return JSON.stringify({
      kind: binding.kind,
      label: binding.label,
      baseURL: binding.baseURL,
      apiKeyEnvVar: binding.apiKeyEnvVar,
      headersFormat: binding.headersFormat,
      headers: binding.headers,
      extraBodyFormat: binding.extraBodyFormat,
      extraBody: binding.extraBody,
      mcpServers: binding.mcpServers,
    });
  }

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

function getSnapshotTimeStart(snapshot: WorkspaceSnapshot): string | undefined {
  const timestamps = [
    ...Object.values(snapshot.projects).map((project) => project.createdAt),
    ...Object.values(snapshot.rooms).map((room) => room.createdAt),
    ...Object.values(snapshot.messages).map((message) => message.createdAt),
    ...Object.values(snapshot.tasks).flatMap((task) => [task.startedAt, task.updatedAt]),
    ...Object.values(snapshot.taskTraces).map((trace) => trace.createdAt),
  ]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return undefined;
  }

  return new Date(Math.max(...timestamps)).toISOString();
}

export class WorkspaceRuntime {
  private static readonly PROGRESS_PERSIST_DEBOUNCE_MS = 250;

  private snapshot: WorkspaceSnapshot;
  private readonly context: MutationContext;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly executors = new Map<MemberId, MemberExecutor>();
  private readonly runningTaskIds = new Set<string>();
  private readonly watcherTimers = new Map<string, WatcherTimerEntry>();
  private readonly pendingWatcherRuns = new Set<string>();
  private readonly suspendedWatcherRoomIds = new Set<string>();
  private readonly taskObservers = new Map<string, TaskObserverEntry>();
  private readonly persistence: WorkspacePersistence;
  private readonly workspaceRoot: string;
  private readonly globalConfigManager: OpenAquariumGlobalConfigManager;
  private readonly executorFactory: MemberExecutorFactory;
  private readonly templateStudioChatService: TemplateStudioChatServiceLike;
  private readonly templateGenerator: TemplateGenerator;
  private readonly taskExecutionInactivityTimeoutMs?: number;
  private readonly taskExecutionMaxRetries: number;
  private readonly logger?: DiagnosticsLogger;
  private globalConfig: GlobalWorkspaceConfig;
  private readonly executorKeys = new Map<MemberId, string>();
  private taskReaperClockBaseMs: number;
  private taskReaperStartedAtMs: number;
  private templateConfigWatcher?: FSWatcher;
  private runningTaskReaperTimer?: ReturnType<typeof setInterval>;
  private templateConfigReloadTimer: ReturnType<typeof setTimeout> | undefined;
  private templateConfigReloadChain: Promise<void> = Promise.resolve();
  private pendingProgressPersist = false;
  private pendingProgressPersistTimer: ReturnType<typeof setTimeout> | undefined;
  private persistenceChain: Promise<void> = Promise.resolve();
  private flushingPendingWatchers = false;
  private reconcilingTimedOutTasks = false;
  private activeRoomId?: string;

  constructor(args: {
    initialSnapshot: WorkspaceSnapshot;
    persistence: WorkspacePersistence;
    globalConfigManager?: OpenAquariumGlobalConfigManager;
    globalConfig?: GlobalWorkspaceConfig;
    templateStudioChatService?: TemplateStudioChatServiceLike;
    workspaceRoot: string;
    executorFactory?: MemberExecutorFactory;
    templateGenerator?: TemplateGenerator;
    taskExecutionInactivityTimeoutMs?: number;
    taskExecutionMaxRetries?: number;
    context?: MutationContext;
    logger?: DiagnosticsLogger;
  }) {
    this.snapshot = args.initialSnapshot;
    Object.values(args.initialSnapshot.rooms).forEach((room) => {
      if (room.watchersSuspended === true) {
        this.suspendedWatcherRoomIds.add(room.id);
      }
    });
    this.activeRoomId = args.initialSnapshot.selection.roomId;
    this.context = args.context ?? createRuntimeContext(10_000, "2026-03-09T10:00:00.000Z");
    this.persistence = args.persistence;
    this.workspaceRoot = args.workspaceRoot;
    this.globalConfigManager = args.globalConfigManager ?? new OpenAquariumGlobalConfigManager();
    this.globalConfig = args.globalConfig ?? createDefaultGlobalWorkspaceConfig(this.globalConfigManager.directory);
    this.templateStudioChatService = args.templateStudioChatService ?? new TemplateStudioChatService();
    if (args.taskExecutionInactivityTimeoutMs === 0) {
      this.taskExecutionInactivityTimeoutMs = undefined;
    } else {
      this.taskExecutionInactivityTimeoutMs =
        args.taskExecutionInactivityTimeoutMs && args.taskExecutionInactivityTimeoutMs > 0
          ? args.taskExecutionInactivityTimeoutMs
          : DEFAULT_TASK_EXECUTION_INACTIVITY_TIMEOUT_MS;
    }
    this.taskExecutionMaxRetries =
      args.taskExecutionMaxRetries !== undefined
        ? Math.max(0, Math.floor(args.taskExecutionMaxRetries))
        : DEFAULT_TASK_EXECUTION_MAX_RETRIES;
    this.logger = args.logger;
    this.taskReaperClockBaseMs = Date.parse(getSnapshotTimeStart(this.snapshot) ?? "") || Date.now();
    this.taskReaperStartedAtMs = Date.now();
    this.startRunningTaskReaper();
    this.startTemplateConfigWatcher();
    this.executorFactory =
      args.executorFactory ??
      (({ member, project }) => {
        const host = {
          sendGroupMessage: async (input: { roomId: string; memberId: string; taskId: string; content: string }) => {
            await this.sendMemberMessage({
              roomId: input.roomId,
              memberId: input.memberId,
              content: input.content,
              taskId: input.taskId,
            });
          },
          sendDirectMessage: async (input: {
            roomId: string;
            memberId: string;
            taskId: string;
            targetHandle: string;
            content: string;
          }) => {
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
          addRoleEmployee: async (input: {
            roomId: string;
            memberId: string;
            role: string;
            employeeHandle: string;
            reason?: string;
          }) => {
            return this.applyRoleStaffing({
              roomId: input.roomId,
              memberId: input.memberId,
              operation: {
                kind: "add",
                role: input.role,
                employeeHandle: input.employeeHandle,
                reason: input.reason,
              },
            });
          },
          removeRoleEmployee: async (input: {
            roomId: string;
            memberId: string;
            role: string;
            employeeHandle: string;
            reason?: string;
          }) => {
            return this.applyRoleStaffing({
              roomId: input.roomId,
              memberId: input.memberId,
              operation: {
                kind: "remove",
                role: input.role,
                employeeHandle: input.employeeHandle,
                reason: input.reason,
              },
            });
          },
          renameRoleEmployee: async (input: {
            roomId: string;
            memberId: string;
            employeeHandle: string;
            name: string;
          }) => {
            return this.applyRoleStaffing({
              roomId: input.roomId,
              memberId: input.memberId,
              operation: {
                kind: "rename",
                employeeHandle: input.employeeHandle,
                name: input.name,
              },
            });
          },
          runWatcher: async (input: { watcherId: string }) => {
            await this.runWatcherNow(input.watcherId);
          },
          inspectRoomState: (input: { roomId: string }) => Promise.resolve(this.describeRoomState(input.roomId)),
          persistMemberSession: async (input: { memberId: string; sessionId?: string }) => {
            await this.persistMemberProviderSession(input.memberId, input.sessionId);
          },
        };

        return member.provider.kind === "openai-compatible"
          ? new OpenAICompatibleMemberExecutor({
              workspaceRoot: this.workspaceRoot,
              project,
              member,
              logger: this.logger,
              host,
            })
          : new AcpMemberExecutor({
              workspaceRoot: this.workspaceRoot,
              project,
              member,
              logger: this.logger,
              host,
            });
      });
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
    taskExecutionInactivityTimeoutMs?: number;
    taskExecutionMaxRetries?: number;
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
      taskExecutionInactivityTimeoutMs: args.taskExecutionInactivityTimeoutMs,
      taskExecutionMaxRetries: args.taskExecutionMaxRetries,
      context: createSystemClockContext(getSnapshotSequenceStart(initialSnapshot), getSnapshotTimeStart(initialSnapshot)),
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
    await syncRoomMessageHistoryFiles({
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

  async getRoomMessageHistoryPage(input: {
    roomId: string;
    beforeMessageId?: string;
    limit?: number;
  }): Promise<RoomMessageHistoryPage> {
    const room = this.snapshot.rooms[input.roomId];
    if (!room) {
      throw new Error(`Unknown room "${input.roomId}"`);
    }

    return loadRoomMessageHistoryPage({
      workspaceRoot: this.workspaceRoot,
      snapshot: this.snapshot,
      room,
      beforeMessageId: input.beforeMessageId,
      limit: input.limit,
    });
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async createProject(input: CreateProjectInput): Promise<{ snapshot: WorkspaceSnapshot; projectId: string; roomId: string }> {
    const previous = this.snapshot;
    const next = createProjectWithRoom(
      previous,
      {
        ...input,
        path: normalizeProjectPath(this.workspaceRoot, input.path),
      },
      this.context,
    );
    this.activeRoomId = next.selection.roomId;
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
    this.activeRoomId = next.selection.roomId;
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
    this.activeRoomId = args.roomId;
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

  async applyRoleStaffing(input: {
    roomId: string;
    memberId: string;
    operation: Parameters<typeof applyRoleStaffingOperation>[1]["operation"];
  }): Promise<{ snapshot: WorkspaceSnapshot; ok: boolean; notices: string[] }> {
    const previous = this.snapshot;
    const member = previous.members[input.memberId];
    if (!member) {
      throw new Error(`Unknown member "${input.memberId}"`);
    }

    const { snapshot: next, result } = executeRoleStaffingOperation(
      previous,
      {
        roomId: input.roomId,
        actorLabel: member.name,
        operation: input.operation,
      },
      this.context,
    );
    await this.applySnapshot(previous, next);
    return {
      snapshot: this.snapshot,
      ok: result.ok,
      notices: result.notices,
    };
  }

  async acknowledgeRoom(roomId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    this.activeRoomId = roomId;
    const next = acknowledgeRoom(previous, roomId, this.context);
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

  async updateRoomTeam(input: UpdateRoomTeamInput): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = updateRoomTeamInWorkspace(previous, input, this.context);

    Object.keys(previous.members).forEach((memberId) => {
      const previousMember = previous.members[memberId];
      const nextMember = next.members[memberId];
      if (!previousMember || !nextMember) {
        return;
      }

      if (this.memberExecutionKey(previousMember) !== this.memberExecutionKey(nextMember)) {
        next.members[memberId] = {
          ...nextMember,
          providerSessionId: undefined,
        };
      }
    });

    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async updateRoomSettings(input: UpdateRoomSettingsInput): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = updateRoomSettingsInWorkspace(
      previous,
      input,
      this.context,
      { markAsRead: this.activeRoomId === input.roomId },
    );
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
    modelId?: string;
  }): Promise<{ assistantMessage: string; snapshot: WorkspaceSnapshot; globalConfig: GlobalWorkspaceConfig; modelProfileId: string; modelId?: string }> {
    const assistantReply = await this.templateStudioChatService.chat({
      configDirectory: this.globalConfigManager.directory,
      templateId: input.templateId,
      messages: input.messages,
      templates: cloneTemplates(this.snapshot),
      globalConfig: this.globalConfig,
      modelProfileId: input.modelProfileId,
      modelId: input.modelId,
    });
    await this.reloadGlobalTemplatesFromDisk();

    return {
      assistantMessage: assistantReply.assistantMessage,
      modelProfileId: assistantReply.modelProfileId,
      modelId: assistantReply.modelId,
      snapshot: this.snapshot,
      globalConfig: this.globalConfig,
    };
  }

  async getTemplateStudioModelCatalog(input: {
    modelProfileId?: string;
  }): Promise<TemplateStudioModelCatalog> {
    return this.templateStudioChatService.getModelCatalog({
      configDirectory: this.globalConfigManager.directory,
      globalConfig: this.globalConfig,
      modelProfileId: input.modelProfileId,
    });
  }

  async getProviderProfileModelCatalog(input: {
    draft: ModelProfileDraft;
  }): Promise<TemplateStudioModelCatalog> {
    return this.templateStudioChatService.getModelCatalogForProfile({
      configDirectory: this.globalConfigManager.directory,
      profile: buildProviderModelProfileFromDraft({
        draft: input.draft,
        existing: findProviderModelProfile(this.globalConfig.modelProfiles, input.draft.id),
      }),
    });
  }

  async testProviderProfile(input: {
    draft: ModelProfileDraft;
    modelId?: string;
  }): Promise<ProviderConnectionTestResult> {
    return this.templateStudioChatService.testProfile({
      configDirectory: this.globalConfigManager.directory,
      profile: buildProviderModelProfileFromDraft({
        draft: input.draft,
        existing: findProviderModelProfile(this.globalConfig.modelProfiles, input.draft.id),
      }),
      modelId: input.modelId,
      prompt: OPENAQUARIUM_PROVIDER_TEST_PROMPT,
    });
  }

  async streamTemplateStudioChat(input: {
    templateId: string;
    messages: TemplateStudioUIMessage[];
    modelProfileId?: string;
    modelId?: string;
    abortSignal?: AbortSignal;
  }): Promise<TemplateStudioChatStreamSession> {
    const streamRun = await this.templateStudioChatService.stream({
      configDirectory: this.globalConfigManager.directory,
      templateId: input.templateId,
      messages: input.messages,
      templates: cloneTemplates(this.snapshot),
      globalConfig: this.globalConfig,
      modelProfileId: input.modelProfileId,
      modelId: input.modelId,
      abortSignal: input.abortSignal,
    });

    return {
      modelProfileId: streamRun.modelProfileId,
      modelId: streamRun.modelId,
      result: streamRun.result,
      finalize: async () => {
        await this.reloadGlobalTemplatesFromDisk();

        return {
          snapshot: this.snapshot,
          globalConfig: this.globalConfig,
          modelProfileId: streamRun.modelProfileId,
          modelId: streamRun.modelId,
        };
      },
      cleanup: async () => {
        await streamRun.cleanup();
      },
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

  async toggleRoomWatcherSuspension(roomId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    if (!previous.rooms[roomId]) {
      throw new Error(`Unknown room "${roomId}"`);
    }
    if (this.suspendedWatcherRoomIds.has(roomId)) {
      this.suspendedWatcherRoomIds.delete(roomId);
    } else {
      this.suspendedWatcherRoomIds.add(roomId);
    }
    const next = toggleRoomWatcherSuspensionInWorkspace(previous, roomId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async pauseWatcherUntilActivity(watcherId: string): Promise<WorkspaceSnapshot> {
    const previous = this.snapshot;
    const next = pauseWatcherUntilActivityInWorkspace(previous, watcherId);
    await this.applySnapshot(previous, next);
    return this.snapshot;
  }

  async runWatcherNow(watcherId: string): Promise<{ snapshot: WorkspaceSnapshot; outcome: WatcherRunOutcome }> {
    const watcher = this.snapshot.watchers[watcherId];
    if (!watcher || !watcher.enabled) {
      this.pendingWatcherRuns.delete(watcherId);
      return { snapshot: this.snapshot, outcome: "disabled" };
    }
    if (this.snapshot.rooms[watcher.roomId]?.watchersSuspended === true) {
      return { snapshot: this.snapshot, outcome: "suspended" };
    }

    if (this.hasRunningTaskForMember(watcher.memberId)) {
      this.pendingWatcherRuns.add(watcherId);
      return { snapshot: this.snapshot, outcome: "busy" };
    }

    this.pendingWatcherRuns.delete(watcherId);

    const previous = this.snapshot;
    const previousWatcher = previous.watchers[watcherId];
    const previousMessageIds = new Set(Object.keys(previous.messages));
    const next = runWatcher(previous, watcherId, this.context);
    await this.applySnapshot(previous, next);
    const nextWatcher = this.snapshot.watchers[watcherId];
    const createdDigest = Object.entries(this.snapshot.messages).some(
      ([messageId, message]) => !previousMessageIds.has(messageId)
        && message.transport === "watch-digest"
        && nextWatcher
        && message.recipientMemberIds.includes(nextWatcher.memberId),
    );
    const establishedBaseline = previousWatcher
      && previousWatcher.lastConsumedMessageId === undefined
      && previousWatcher.lastConsumedStateAt === undefined
      && Boolean(nextWatcher?.lastConsumedMessageId || nextWatcher?.lastConsumedStateAt);

    return {
      snapshot: this.snapshot,
      outcome: createdDigest ? "triggered" : establishedBaseline ? "baselined" : "idle",
    };
  }

  async listSkillCatalog(): Promise<SkillCatalogEntry[]> {
    return loadSkillCatalog(this.workspaceRoot);
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
    const project = this.snapshot.projects[room.projectId];
    const projectWorkingDirectory = project ? resolveProjectWorkingDirectory(project, this.workspaceRoot) : this.workspaceRoot;

    const transcript = (this.snapshot.messageOrderByRoom[roomId] ?? [])
      .map((messageId) => {
        const message = this.snapshot.messages[messageId];
        if (!message || !isVisibleMemberRoomMessage(message)) {
          return undefined;
        }

        return `[${message.createdAt}] ${message.author.label}: ${message.content}`;
      })
      .filter((line): line is string => Boolean(line))
      .slice(-20)
      .join("\n");

    const roomTeam = resolveRoomTeamSummary(this.snapshot, room);
    const members = room.memberIds
      .map((memberId) => this.snapshot.members[memberId])
      .map((member) => `- ${member.name} (@${member.handle}) status=${member.status} entry=${member.isEntryMember}`)
      .join("\n");

    return [
      `project: ${project?.name ?? room.projectId}`,
      `projectPath: ${project?.path ?? "(default workspace root)"}`,
      `workingDirectory: ${projectWorkingDirectory}`,
      `openAquariumRoot: ${this.workspaceRoot}`,
      "",
      `room: ${room.name}`,
      `topic: ${room.topic}`,
      `team: ${roomTeam.name}`,
      `teamDescription: ${roomTeam.description}`,
      "",
      "[members]",
      members || "(none)",
      "",
      "[recent transcript]",
      transcript || "(none)",
    ].join("\n");
  }

  async dispose(): Promise<void> {
    if (this.runningTaskReaperTimer) {
      clearInterval(this.runningTaskReaperTimer);
      this.runningTaskReaperTimer = undefined;
    }
    if (this.templateConfigReloadTimer) {
      clearTimeout(this.templateConfigReloadTimer);
      this.templateConfigReloadTimer = undefined;
    }
    this.templateConfigWatcher?.close();
    this.templateConfigWatcher = undefined;
    this.watcherTimers.forEach((entry) => clearInterval(entry.timer));
    this.watcherTimers.clear();
    this.pendingWatcherRuns.clear();
    await this.persistImmediately(this.snapshot);
    await Promise.all([...this.executors.values()].map((executor) => executor.dispose()));
    this.executors.clear();
    this.executorKeys.clear();
    await this.templateStudioChatService.dispose();
  }

  private async applySnapshot(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): Promise<void> {
    const prepared = this.applyUnreadState(previous, next);
    if (this.activeRoomId && !prepared.rooms[this.activeRoomId]) {
      this.activeRoomId = prepared.selection.roomId && prepared.rooms[prepared.selection.roomId]
        ? prepared.selection.roomId
        : undefined;
    }

    this.cleanupRemovedRuntimeState(previous, prepared);
    await syncRoomTranscriptFiles({
      workspaceRoot: this.workspaceRoot,
      previous,
      next: prepared,
    });
    await syncRoomMessageHistoryFiles({
      workspaceRoot: this.workspaceRoot,
      previous,
      next: prepared,
    });
    this.snapshot = compactWorkspaceSnapshot(this.applyWatcherRoomSuspensions(prepared));
    await this.persistImmediately(this.snapshot);
    this.logger?.info("snapshot-applied", summarizeWorkspaceSnapshot(this.snapshot));
    this.syncWatchers();
    this.emit();
    this.dispatchNewTasks(previous, this.snapshot);
    await this.flushPendingWatchers();
  }

  private applyWatcherRoomSuspensions(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    let nextSnapshot = snapshot;
    let rooms = snapshot.rooms;

    Object.entries(snapshot.rooms).forEach(([roomId, room]) => {
      const shouldSuspend = this.suspendedWatcherRoomIds.has(roomId);
      if ((room.watchersSuspended === true) === shouldSuspend) {
        return;
      }
      if (rooms === snapshot.rooms) {
        rooms = { ...snapshot.rooms };
      }
      rooms[roomId] = {
        ...room,
        watchersSuspended: shouldSuspend,
      };
    });

    [...this.suspendedWatcherRoomIds].forEach((roomId) => {
      if (!snapshot.rooms[roomId]) {
        this.suspendedWatcherRoomIds.delete(roomId);
      }
    });

    if (rooms !== snapshot.rooms) {
      nextSnapshot = {
        ...snapshot,
        rooms,
      };
    }

    return nextSnapshot;
  }

  private applyUnreadState(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): WorkspaceSnapshot {
    const nextMessageIds = Object.keys(next.messages)
      .filter((messageId) => !previous.messages[messageId])
      .sort((left, right) => {
        const leftCreatedAt = next.messages[left]?.createdAt ?? "";
        const rightCreatedAt = next.messages[right]?.createdAt ?? "";
        return leftCreatedAt.localeCompare(rightCreatedAt) || left.localeCompare(right);
      });

    return nextMessageIds.reduce(
      (snapshot, messageId) => syncUnreadStateForMessage(snapshot, messageId, this.activeRoomId),
      next,
    );
  }

  private cleanupRemovedRuntimeState(previous: WorkspaceSnapshot, next: WorkspaceSnapshot): void {
    Object.entries(previous.members).forEach(([memberId, previousMember]) => {
      const nextMember = next.members[memberId];
      const nextRoom = nextMember ? next.rooms[nextMember.roomId] : undefined;
      const memberRemovedOrArchived = !nextMember || Boolean(nextMember.archivedAt);
      const executionChanged = nextMember ? this.memberExecutionKey(previousMember) !== this.memberExecutionKey(nextMember) : false;
      const noLongerActiveInRoom = nextMember ? !nextRoom?.memberIds.includes(memberId) : true;

      if (memberRemovedOrArchived || executionChanged || noLongerActiveInRoom) {
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

  private startTemplateConfigWatcher(): void {
    if (process.env.VITEST) {
      return;
    }

    try {
      this.templateConfigWatcher = watch(this.globalConfigManager.directory, (_eventType, filename) => {
        if (filename !== "templates.json") {
          return;
        }

        if (this.templateConfigReloadTimer) {
          clearTimeout(this.templateConfigReloadTimer);
        }

        this.templateConfigReloadTimer = setTimeout(() => {
          this.templateConfigReloadTimer = undefined;
          void this.reloadGlobalTemplatesFromDisk();
        }, 50);
      });
    } catch (error) {
      this.logger?.info("template-config-watch-unavailable", {
        directory: this.globalConfigManager.directory,
        error: getErrorMessage(error as RuntimeError),
      });
    }
  }

  private async reloadGlobalTemplatesFromDisk(): Promise<void> {
    this.templateConfigReloadChain = this.templateConfigReloadChain.then(async () => {
      const reloaded = await this.globalConfigManager.load();
      this.globalConfig = reloaded.config;
      const previous = this.snapshot;
      const next = mergeGlobalTemplatesIntoSnapshot(previous, reloaded.templates);
      await this.applySnapshot(previous, next);
    });

    await this.templateConfigReloadChain;
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

    let retryAttempt = 0;
    this.runningTaskIds.add(taskId);
    try {
      while (true) {
        const currentTask = this.snapshot.tasks[taskId];
        if (!currentTask || currentTask.status !== "running") {
          return;
        }
        const member = this.snapshot.members[currentTask.memberId];
        const room = this.snapshot.rooms[currentTask.roomId];
        const project = this.snapshot.projects[room.projectId];
        let executor: MemberExecutor | undefined;
        this.logger?.info("task-execute-start", {
          taskId,
          roomId: room.id,
          memberId: member.id,
          memberHandle: member.handle,
          retryAttempt,
          maxRetries: this.taskExecutionMaxRetries,
          runningTasks: this.runningTaskIds.size,
        });
        executor = this.getExecutor(member.id, member, room, project);
        const executionMember = this.resolveMemberForExecution(member);
        let promptVisible = false;

        try {
          const preparation = await executor.prepareExecution?.({
            project,
            room,
            member: executionMember,
            task: currentTask,
            snapshot: this.snapshot,
          });
          const promptPayload = buildTaskPromptPayload({
            workspaceRoot: this.workspaceRoot,
            project,
            room,
            member: executionMember,
            task: currentTask,
            snapshot: this.snapshot,
            transcriptFilePath: getRoomTranscriptFilePath(this.workspaceRoot, room),
            retryAttempt,
            sessionContinuation: preparation?.sessionContinuation,
          });
          const { taskSettled, promptVisible: attemptPromptVisible } = await this.executeTaskAttempt({
            taskId,
            member,
            room,
            project,
            task: currentTask,
            prompt: promptPayload.prompt,
            promptTraceContent: promptPayload.promptTraceContent,
            messageHistory: promptPayload.messageHistory,
            openAICompatibleConversation: executionMember.openAICompatibleConversation,
            executor,
            retryAttempt,
          });
          promptVisible = attemptPromptVisible;

          if (taskSettled) {
            return;
          }

          throw new TaskExecutionProtocolError("Executor returned without reporting completion or failure.");
        } catch (error) {
          const latestTask = this.snapshot.tasks[taskId];
          if (latestTask?.status !== "running") {
            return;
          }
          const latestMember = this.snapshot.members[latestTask.memberId];
          if (error instanceof TaskExecutionTimeoutError) {
            const timeoutMs = this.taskExecutionInactivityTimeoutMs;
            if (timeoutMs === undefined) {
              throw new Error("Task timeout was raised without an inactivity timeout configured.", {
                cause: error,
              });
            }

            const nextRetryAttempt = retryAttempt + 1;
            if (executor) {
              try {
                await executor.cancel();
              } catch (cancelError: unknown) {
                this.logger?.warn("task-timeout-cancel-failed", {
                  taskId,
                  roomId: latestTask.roomId,
                  memberId: latestTask.memberId,
                  message: getErrorMessage(cancelError as RuntimeError),
                });
              }

              if (promptVisible) {
                try {
                  await executor.discardSession?.();
                } catch (discardError: unknown) {
                  this.logger?.warn("task-timeout-discard-session-failed", {
                    taskId,
                    roomId: latestTask.roomId,
                    memberId: latestTask.memberId,
                    message: getErrorMessage(discardError as RuntimeError),
                  });
                }
              }
            }

            if (nextRetryAttempt <= this.taskExecutionMaxRetries) {
              this.snapshot = compactWorkspaceSnapshot(appendTaskTrace(
                this.snapshot,
                {
                  taskId,
                  roomId: latestTask.roomId,
                  memberId: latestTask.memberId,
                  kind: "status",
                  title: "Task retry scheduled",
                  content: buildTaskExecutionRetryMessage({
                    timeoutMs,
                    retryAttempt: nextRetryAttempt,
                    maxRetries: this.taskExecutionMaxRetries,
                  }),
                },
                this.context,
              ));
              this.scheduleProgressPersistence();
              this.emit();
              this.logger?.warn("task-timeout-retry", {
                taskId,
                roomId: latestTask.roomId,
                memberId: latestTask.memberId,
                retryAttempt: nextRetryAttempt,
                maxRetries: this.taskExecutionMaxRetries,
                timeoutMs,
              });
              retryAttempt = nextRetryAttempt;
              continue;
            }

            const errorMessage = buildTaskExecutionTimeoutMessage(timeoutMs);
            await this.completeFailedTask({
              task: latestTask,
              member: latestMember,
              traceTitle: "Task timed out waiting for executor progress",
              errorMessage,
            });
            this.logger?.error("task-timeout", {
              taskId,
              roomId: latestTask.roomId,
              memberId: latestTask.memberId,
              message: errorMessage,
              retryAttempt: nextRetryAttempt,
              maxRetries: this.taskExecutionMaxRetries,
              state: latestTask.status,
              runningTasks: this.runningTaskIds.size,
            });
            this.logger?.info("task-state-change", {
              taskId,
              roomId: latestTask.roomId,
              memberId: latestTask.memberId,
              from: "running",
              to: "completed",
              reason: "timeout",
            });
            const observer = this.taskObservers.get(taskId);
            if (observer) {
              await observer.callbacks.onError?.({
                ...observer.route,
                message: errorMessage,
                messageId: this.snapshot.tasks[taskId]?.draftMessageId,
              });
              observer.resolve();
            }
            return;
          }

          const errorMessage = getErrorMessage(error as RuntimeError);
          await this.completeFailedTask({
            task: latestTask,
            member: latestMember,
            traceTitle:
              error instanceof TaskExecutionProtocolError
                ? "Task ended without completion signal"
                : "Task crashed before ACP completion",
            errorMessage,
          });
          this.logger?.error("task-crash", {
            taskId,
            roomId: latestTask.roomId,
            memberId: latestTask.memberId,
            message: errorMessage,
            retryAttempt,
            maxRetries: this.taskExecutionMaxRetries,
            state: latestTask.status,
            runningTasks: this.runningTaskIds.size,
          });
          this.logger?.info("task-state-change", {
            taskId,
            roomId: latestTask.roomId,
            memberId: latestTask.memberId,
            from: "running",
            to: "completed",
            reason: error instanceof TaskExecutionProtocolError ? "protocol-error" : "crash",
          });
          const observer = this.taskObservers.get(taskId);
          if (observer) {
            await observer.callbacks.onError?.({
              ...observer.route,
              message: errorMessage,
              messageId: this.snapshot.tasks[taskId]?.draftMessageId,
            });
            observer.resolve();
          }
          return;
        }
      }
    } finally {
      const observer = this.taskObservers.get(taskId);
      if (observer && this.snapshot.tasks[taskId]?.status !== "running") {
        observer.resolve();
      }
      this.runningTaskIds.delete(taskId);
      await this.flushPendingWatchers();
    }
  }

  private async executeTaskAttempt(args: {
    taskId: string;
    member: WorkspaceSnapshot["members"][string];
    room: WorkspaceSnapshot["rooms"][string];
    project: WorkspaceSnapshot["projects"][string];
    task: WorkspaceSnapshot["tasks"][string];
    prompt: string;
    promptTraceContent: string;
    messageHistory?: ExecutionRequest["messageHistory"];
    openAICompatibleConversation?: ExecutionRequest["openAICompatibleConversation"];
    executor: MemberExecutor;
    retryAttempt: number;
  }): Promise<{ taskSettled: boolean; promptVisible: boolean }> {
    let acceptingExecutorUpdates = true;
    let taskSettled = false;
    let promptVisible = false;
    const watchdog = createTaskExecutionWatchdog({
      timeoutMs: this.taskExecutionInactivityTimeoutMs,
      label: `Task ${args.taskId} for @${args.member.handle}`,
      onTimeout: () => {
        acceptingExecutorUpdates = false;
      },
    });
    const touchWatchdog = (): void => {
      if (acceptingExecutorUpdates && watchdog) {
        watchdog.touch();
      }
    };

    try {
      const executionPromise = args.executor.execute(
        {
          project: args.project,
          room: args.room,
          member: this.resolveMemberForExecution(args.member),
          task: args.task,
          snapshot: this.snapshot,
          prompt: args.prompt,
          promptTraceContent: args.promptTraceContent,
          messageHistory: args.messageHistory,
          openAICompatibleConversation: args.openAICompatibleConversation,
        },
        {
        onPromptVisible: () => {
          if (!acceptingExecutorUpdates || promptVisible) {
            return;
          }
          touchWatchdog();
          const currentTask = this.snapshot.tasks[args.taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          this.snapshot = compactWorkspaceSnapshot(appendTaskTrace(
            acknowledgeWatcherDigestVisibility(this.snapshot, args.taskId),
            {
              taskId: args.taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              kind: "task-prompt",
              title: args.retryAttempt === 0 ? "Task prompt" : `Task prompt (retry ${args.retryAttempt}/${this.taskExecutionMaxRetries})`,
              content: args.promptTraceContent,
            },
            this.context,
          ));
          this.scheduleProgressPersistence();
          this.emit();
          promptVisible = true;
        },
        onDraft: async (content) => {
          if (!acceptingExecutorUpdates) {
            return;
          }
          touchWatchdog();
          const currentTask = this.snapshot.tasks[args.taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          this.snapshot = compactWorkspaceSnapshot(upsertTaskTrace(
            postMemberDraft(this.snapshot, { taskId: args.taskId, content }, this.context),
            {
              taskId: args.taskId,
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
          if (logger && logger.shouldLog(`task-draft:${args.taskId}`, 800)) {
            logger.info("task-draft", {
              taskId: args.taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              chars: content.length,
              content,
            });
          }
          const draftTask = this.snapshot.tasks[args.taskId];
          const observer = this.taskObservers.get(args.taskId);
          if (observer) {
            await observer.callbacks.onDraft?.({
              ...observer.route,
              content,
              messageId: draftTask?.draftMessageId,
            });
          }
        },
        onStatus: async (summary) => {
          if (!acceptingExecutorUpdates) {
            return;
          }
          touchWatchdog();
          const currentTask = this.snapshot.tasks[args.taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          const statusTrace = describeTaskStatusTrace(summary);
          const latestTraceId = (this.snapshot.taskTraceOrderByTask[args.taskId] ?? []).at(-1);
          const latestTrace = latestTraceId ? this.snapshot.taskTraces[latestTraceId] : undefined;
          const nextStatusContent =
            statusTrace.title === "Reasoning"
            && latestTrace?.kind === "status"
            && latestTrace.title === statusTrace.title
              ? concatenateReasoningContent(latestTrace.content, statusTrace.content)
              : statusTrace.content;
          this.snapshot = compactWorkspaceSnapshot(
            statusTrace.append
              ? appendTaskTrace(
                  this.snapshot,
                  {
                    taskId: args.taskId,
                    roomId: currentTask.roomId,
                    memberId: currentTask.memberId,
                    kind: "status",
                    title: statusTrace.title,
                    content: nextStatusContent,
                  },
                  this.context,
                )
              : upsertTaskTrace(
                  this.snapshot,
                  {
                    taskId: args.taskId,
                    roomId: currentTask.roomId,
                    memberId: currentTask.memberId,
                    kind: "status",
                    title: statusTrace.title,
                    content: nextStatusContent,
                  },
                  this.context,
                ),
          );
          this.scheduleProgressPersistence();
          this.emit();
          if (this.logger?.shouldLog(`task-status:${args.taskId}`, 1000)) {
            this.logger.info("task-status", {
              taskId: args.taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              summaryLength: summary.length,
              state: currentTask.status,
              runningTasks: this.runningTaskIds.size,
            });
          }
          const observer = this.taskObservers.get(args.taskId);
          if (observer) {
            await observer.callbacks.onStatus?.({
              ...observer.route,
              summary,
            });
          }
        },
        onComplete: async (finalContent, stopReason, metadata) => {
          if (!acceptingExecutorUpdates) {
            return;
          }
          acceptingExecutorUpdates = false;
          watchdog?.dispose();
          const currentTask = this.snapshot.tasks[args.taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          const previous = this.snapshot;
          const snapshotWithTrace = appendTaskTrace(
            previous,
            {
              taskId: args.taskId,
              roomId: currentTask.roomId,
              memberId: currentTask.memberId,
              kind: "completed",
              title: `Task completed (${stopReason})`,
              content: finalContent.trim().length > 0 ? finalContent : stopReason,
            },
            this.context,
          );
          const snapshotWithConversation =
            metadata?.nextOpenAICompatibleConversation
              ? {
                  ...snapshotWithTrace,
                  members: {
                    ...snapshotWithTrace.members,
                    [currentTask.memberId]: {
                      ...snapshotWithTrace.members[currentTask.memberId],
                      openAICompatibleConversation: metadata.nextOpenAICompatibleConversation,
                    },
                  },
                }
              : snapshotWithTrace;
          const next = completeMemberTask(
            snapshotWithConversation,
            {
              taskId: args.taskId,
              finalContent:
                finalContent.trim().length > 0 ? finalContent : `${args.member.name} completed the task with stop reason: ${stopReason}`,
            },
            this.context,
          );
          await this.applySnapshot(previous, next);
          this.logger?.info("task-complete", {
            taskId: args.taskId,
            roomId: currentTask.roomId,
            memberId: currentTask.memberId,
            stopReason,
            chars: finalContent.length,
            finalContent,
            runningTasks: this.runningTaskIds.size,
          });
          this.logger?.info("task-state-change", {
            taskId: args.taskId,
            roomId: currentTask.roomId,
            memberId: currentTask.memberId,
            from: "running",
            to: "completed",
            reason: `onComplete:${stopReason}`,
          });
          const observer = this.taskObservers.get(args.taskId);
          if (observer) {
            await observer.callbacks.onComplete?.({
              ...observer.route,
              content: finalContent.trim().length > 0 ? finalContent : `${args.member.name} completed the task with stop reason: ${stopReason}`,
              messageId: this.snapshot.tasks[args.taskId]?.draftMessageId,
              stopReason,
            });
            observer.resolve();
          }
          taskSettled = true;
        },
        onError: async (message) => {
          if (!acceptingExecutorUpdates) {
            return;
          }
          acceptingExecutorUpdates = false;
          watchdog?.dispose();
          const currentTask = this.snapshot.tasks[args.taskId];
          if (!currentTask || currentTask.status !== "running") {
            return;
          }
          await this.completeFailedTask({
            task: currentTask,
            member: this.snapshot.members[currentTask.memberId],
            traceTitle: "Task failed",
            errorMessage: message,
          });
          this.logger?.error("task-error", {
            taskId: args.taskId,
            roomId: currentTask.roomId,
            memberId: currentTask.memberId,
            message,
            state: currentTask.status,
            runningTasks: this.runningTaskIds.size,
          });
          this.logger?.info("task-state-change", {
            taskId: args.taskId,
            roomId: currentTask.roomId,
            memberId: currentTask.memberId,
            from: "running",
            to: "completed",
            reason: "onError",
          });
          const observer = this.taskObservers.get(args.taskId);
          if (observer) {
            await observer.callbacks.onError?.({
              ...observer.route,
              message,
              messageId: this.snapshot.tasks[args.taskId]?.draftMessageId,
            });
            observer.resolve();
          }
          taskSettled = true;
        },
        },
      );
      await (watchdog ? Promise.race([executionPromise, watchdog.timeoutPromise]) : executionPromise);
      return { taskSettled, promptVisible };
    } finally {
      watchdog?.dispose();
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

  private resolveMemberForExecution(member: TeamMember): ExecutionMember {
    const resolvedProvider = resolveProviderBindingFromProfile(
      member.provider,
      this.globalConfig.modelProfiles,
      member.modelProfileId,
    );
    const providerWithMemberDepth =
      resolvedProvider.kind === "codex-acp" && member.codexThinkingDepth
        ? {
            ...resolvedProvider,
            env: {
              ...resolvedProvider.env,
              [CODEX_ACP_THINKING_DEPTH_ENV_KEY]: member.codexThinkingDepth,
            },
          }
        : resolvedProvider;

    if (providerWithMemberDepth === member.provider) {
      return member;
    }

    return {
      ...member,
      provider: providerWithMemberDepth,
    };
  }

  private memberExecutionKey(member: TeamMember): string {
    const resolvedProvider = resolveProviderBindingFromProfile(
      member.provider,
      this.globalConfig.modelProfiles,
      member.modelProfileId,
    );
    const resolvedProfile = findProviderModelProfile(this.globalConfig.modelProfiles, member.modelProfileId);
    const providerWithMemberDepth =
      resolvedProvider.kind === "codex-acp" && member.codexThinkingDepth
        ? {
            ...resolvedProvider,
            env: {
              ...resolvedProvider.env,
              [CODEX_ACP_THINKING_DEPTH_ENV_KEY]: member.codexThinkingDepth,
            },
          }
        : resolvedProvider;

    return JSON.stringify({
      memberId: member.id,
      modelProfileId: resolvedProfile?.id ?? null,
      modelId: member.modelId ?? null,
      provider: providerWithMemberDepth,
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

  private async completeFailedTask(args: {
    task: WorkspaceSnapshot["tasks"][string];
    member: WorkspaceSnapshot["members"][string];
    traceTitle: string;
    errorMessage: string;
  }): Promise<void> {
    const previous = this.snapshot;
    const snapshotWithTrace = appendTaskTrace(
      previous,
      {
        taskId: args.task.id,
        roomId: args.task.roomId,
        memberId: args.task.memberId,
        kind: "error",
        title: args.traceTitle,
        content: args.errorMessage,
      },
      this.context,
    );
    const snapshotWithStatusMessage = postSystemMessage(
      snapshotWithTrace,
      {
        roomId: args.task.roomId,
        label: "Task status",
        transport: "status",
        content: buildVisibleTaskFailureContent(args.member, args.errorMessage),
      },
      this.context,
    );
    const next = completeMemberTask(
      snapshotWithStatusMessage,
      {
        taskId: args.task.id,
      },
      this.context,
    );
    await this.applySnapshot(previous, next);
  }

  private async notifyTaskObserverOfError(taskId: string, message: string): Promise<void> {
    const observer = this.taskObservers.get(taskId);
    if (!observer) {
      return;
    }

    await observer.callbacks.onError?.({
      ...observer.route,
      message,
      messageId: this.snapshot.tasks[taskId]?.draftMessageId,
    });
    observer.resolve();
  }

  private startRunningTaskReaper(): void {
    if (!this.taskExecutionInactivityTimeoutMs) {
      return;
    }

    const intervalMs = Math.min(this.taskExecutionInactivityTimeoutMs, RUNNING_TASK_REAPER_MAX_INTERVAL_MS);
    this.runningTaskReaperTimer = setInterval(() => {
      void this.reconcileTimedOutRunningTasks(this.getTaskReaperReferenceTimeMs());
    }, intervalMs);
  }

  private getTaskReaperReferenceTimeMs(): number {
    const latestSnapshotMs = Date.parse(getSnapshotTimeStart(this.snapshot) ?? "");

    if (Number.isFinite(latestSnapshotMs) && latestSnapshotMs !== this.taskReaperClockBaseMs) {
      this.taskReaperClockBaseMs = latestSnapshotMs;
      this.taskReaperStartedAtMs = Date.now();
    }

    const elapsedMs = Date.now() - this.taskReaperStartedAtMs;
    return this.taskReaperClockBaseMs + Math.max(0, elapsedMs);
  }

  private async reconcileTimedOutRunningTasks(referenceTimeMs = Date.now()): Promise<void> {
    if (this.reconcilingTimedOutTasks || !this.taskExecutionInactivityTimeoutMs) {
      return;
    }

    const timeoutMs = this.taskExecutionInactivityTimeoutMs;
    this.reconcilingTimedOutTasks = true;
    try {
      const timedOutTasks = Object.values(this.snapshot.tasks).filter((task) => {
        if (task.status !== "running") {
          return false;
        }

        const updatedAtMs = Date.parse(task.updatedAt);
        if (!Number.isFinite(updatedAtMs)) {
          return false;
        }

        const ageMs = referenceTimeMs - updatedAtMs;
        return ageMs > timeoutMs
          && (!this.runningTaskIds.has(task.id) || ageMs > STALE_RUNNING_TASK_MAX_AGE_MS);
      });

      for (const task of timedOutTasks) {
        const currentTask = this.snapshot.tasks[task.id];
        if (!currentTask || currentTask.status !== "running") {
          continue;
        }

        const member = this.snapshot.members[currentTask.memberId];
        const timeoutMessage = buildTaskExecutionTimeoutMessage(timeoutMs);

        try {
          await this.executors.get(currentTask.memberId)?.cancel();
        } catch (error) {
          this.logger?.warn("task-reaper-cancel-failed", {
            taskId: currentTask.id,
            roomId: currentTask.roomId,
            memberId: currentTask.memberId,
            message: getErrorMessage(error as RuntimeError),
          });
        }

        await this.completeFailedTask({
          task: currentTask,
          member,
          traceTitle: "Task timed out waiting for executor progress",
          errorMessage: timeoutMessage,
        });
        this.logger?.error("task-reaper-timeout", {
          taskId: currentTask.id,
          roomId: currentTask.roomId,
          memberId: currentTask.memberId,
          message: timeoutMessage,
        });
        this.logger?.info("task-state-change", {
          taskId: currentTask.id,
          roomId: currentTask.roomId,
          memberId: currentTask.memberId,
          from: "running",
          to: "completed",
          reason: "reaper-timeout",
        });
        await this.notifyTaskObserverOfError(currentTask.id, timeoutMessage);
      }
    } finally {
      this.reconcilingTimedOutTasks = false;
    }
  }

  private syncWatchers(): void {
    const activeWatcherIds = new Set(Object.keys(this.snapshot.watchers));

    this.watcherTimers.forEach((entry, watcherId) => {
      const watcher = this.snapshot.watchers[watcherId];
      const intervalMs = watcher ? watcher.intervalMinutes * 60 * 1000 : undefined;
      if (!watcher || !watcher.enabled || this.snapshot.rooms[watcher.roomId]?.watchersSuspended === true || intervalMs !== entry.intervalMs) {
        clearInterval(entry.timer);
        this.watcherTimers.delete(watcherId);
      }
    });

    Object.entries(this.snapshot.watchers).forEach(([watcherId, watcher]) => {
      if (!watcher.enabled || this.snapshot.rooms[watcher.roomId]?.watchersSuspended === true || this.watcherTimers.has(watcherId)) {
        return;
      }

      const intervalMs = watcher.intervalMinutes * 60 * 1000;
      const timer = setInterval(() => {
        void this.runWatcherNow(watcherId);
      }, intervalMs);
      this.watcherTimers.set(watcherId, {
        intervalMs,
        timer,
      });
    });

    [...this.watcherTimers.keys()].forEach((watcherId) => {
      if (!activeWatcherIds.has(watcherId)) {
        const entry = this.watcherTimers.get(watcherId);
        if (entry) {
          clearInterval(entry.timer);
        }
        this.watcherTimers.delete(watcherId);
      }

      if (!activeWatcherIds.has(watcherId) || !this.snapshot.watchers[watcherId]?.enabled) {
        this.pendingWatcherRuns.delete(watcherId);
      }
    });

    [...this.pendingWatcherRuns].forEach((watcherId) => {
      if (!this.snapshot.watchers[watcherId]?.enabled) {
        this.pendingWatcherRuns.delete(watcherId);
      }
    });
  }

  private hasRunningTaskForMember(memberId: string): boolean {
    return Object.values(this.snapshot.tasks).some((task) => task.memberId === memberId && task.status === "running");
  }

  private canRunWatcherNow(watcherId: string): boolean {
    const watcher = this.snapshot.watchers[watcherId];
    if (!watcher || !watcher.enabled || this.snapshot.rooms[watcher.roomId]?.watchersSuspended === true) {
      return false;
    }

    return !this.hasRunningTaskForMember(watcher.memberId);
  }

  private async flushPendingWatchers(): Promise<void> {
    if (this.flushingPendingWatchers || this.pendingWatcherRuns.size === 0) {
      return;
    }

    this.flushingPendingWatchers = true;
    try {
      for (const watcherId of [...this.pendingWatcherRuns]) {
        if (!this.canRunWatcherNow(watcherId)) {
          continue;
        }

        await this.runWatcherNow(watcherId);
      }
    } finally {
      this.flushingPendingWatchers = false;
    }
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
