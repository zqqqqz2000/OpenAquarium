import { acpTools, createACPProvider, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME } from "@mcpc-tech/acp-ai-provider";
import { streamText } from "ai";

import type { Project, ProviderBinding } from "../domain/model";
import { CODEX_ACP_MODE_ENV_KEY, ensureCodexAcpSessionMode } from "../lib/acp";
import { isJsonObject, type JsonValue } from "../lib/json";
import { isProviderAssociationRequiredBinding } from "../lib/provider-association";
import type {
  ExecutionMember,
  ExecutionPreparation,
  ExecutionPreparationRequest,
  ExecutionRequest,
  ExecutionSessionContinuation,
  ExecutorCallbacks,
  MemberExecutor,
} from "./executor";
import type { DiagnosticsLogger } from "./diagnostics";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import {
  createWorkspaceTools as createMemberWorkspaceTools,
  type MemberToolHost,
  resolveExecutorDirectories,
} from "./member-workspace-tools";
import { TerminalRegistry } from "./terminal-registry";

export type { MemberToolHost } from "./member-workspace-tools";

const ACP_CANCEL_TIMEOUT_MS = 5 * 1000;
const TOOL_STATUS_PREFIX = "__oa_tool__";
type AcpExecutionMember = ExecutionMember & {
  provider: ProviderBinding;
};
type AcpProtocolLanguageModel = {
  connection?: {
    cancel?: (params: { sessionId: string }) => Promise<void>;
  };
};

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function resolveSpawnCommand(member: AcpExecutionMember): { command: string; args: string[] } {
  if (member.provider.command.trim().length === 0) {
    if (isProviderAssociationRequiredBinding(member.provider)) {
      throw new Error(
        `Provider association required for @${member.handle}. Open the room or member config and select a provider before running tasks.`,
      );
    }

    throw new Error(`ACP provider "${member.provider.label}" for @${member.handle} is missing a command`);
  }

  return {
    command: member.provider.command,
    args: member.provider.args,
  };
}

function summarizeRawChunk(rawValue: JsonValue | object | undefined): string | undefined {
  if (typeof rawValue !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as JsonValue;
    if (!isJsonObject(parsed)) {
      return undefined;
    }

    const type = typeof parsed.type === "string" ? parsed.type : undefined;
    const entriesCount = Array.isArray(parsed.entries) ? parsed.entries.length : 0;
    const path = typeof parsed.path === "string" ? parsed.path : undefined;
    const terminalId = typeof parsed.terminalId === "string" ? parsed.terminalId : undefined;
    const toolCallId = typeof parsed.toolCallId === "string" ? parsed.toolCallId : undefined;

    switch (type) {
      case "plan":
        return `Plan updated (${entriesCount} step(s))`;
      case "diff":
        return `Diff ready for ${path ?? "pending file"}`;
      case "terminal":
        return `Terminal update ${terminalId ?? toolCallId ?? ""}`.trim();
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function summarizeToolChunk(input: { toolName?: string } | object | string | number | boolean | null | undefined): string {
  if (!input || typeof input !== "object") {
    return ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME;
  }

  const maybeToolInput = input as {
    toolName?: string;
  };

  return maybeToolInput.toolName?.trim() || ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME;
}

function encodeToolStatusSummary(input: { toolCallId?: string; toolName: string; status: "running" | "completed" }): string {
  return `${TOOL_STATUS_PREFIX}${JSON.stringify(input)}`;
}

function isMissingPersistedSessionError(error: RuntimeError, providerSessionId?: string): boolean {
  if (!providerSessionId) {
    return false;
  }

  const message = getErrorMessage(error).toLowerCase();
  return message.includes("resource not found") || message.includes("session not found");
}

export class AcpMemberExecutor implements MemberExecutor {
  private readonly workspaceRoot: string;
  private readonly project: Pick<Project, "path">;
  private readonly member: AcpExecutionMember;
  private readonly host: MemberToolHost;
  private readonly logger?: DiagnosticsLogger;
  private readonly terminalRegistry = new TerminalRegistry();
  private readonly projectWorkingDirectory: string;
  private readonly accessibleRoots: string[];
  private provider: ReturnType<typeof createACPProvider>;
  private providerSessionId?: string;
  private persistedProviderSessionId?: string;
  private pendingPersistedSessionId?: string;
  private preparedTaskId?: string;
  private preparedSessionContinuation?: ExecutionSessionContinuation;
  private currentTurn?: Promise<void>;
  private currentAbortController?: AbortController;
  private currentTurnPromptVisible = false;
  private currentLanguageModel?: AcpProtocolLanguageModel;

  constructor(args: {
    workspaceRoot: string;
    project?: Pick<Project, "path">;
    member: ExecutionMember;
    host: MemberToolHost;
    logger?: DiagnosticsLogger;
  }) {
    this.workspaceRoot = args.workspaceRoot;
    this.project = args.project ?? {};
    if (args.member.provider.kind === "openai-compatible") {
      throw new Error(`AcpMemberExecutor cannot run the openai-compatible provider for @${args.member.handle}`);
    }
    this.member = args.member as AcpExecutionMember;
    this.host = args.host;
    this.logger = args.logger;
    this.persistedProviderSessionId = args.member.providerSessionId;
    this.providerSessionId = args.member.providerSessionId;
    const directories = resolveExecutorDirectories({
      workspaceRoot: args.workspaceRoot,
      project: this.project,
      providerWorkingDirectory: args.member.provider.workingDirectory,
    });
    this.projectWorkingDirectory = directories.projectWorkingDirectory;
    this.accessibleRoots = directories.accessibleRoots;
    this.provider = this.createProvider();
  }

  async prepareExecution(request: ExecutionPreparationRequest): Promise<ExecutionPreparation> {
    if (this.preparedTaskId === request.task.id && this.preparedSessionContinuation) {
      return {
        sessionContinuation: this.preparedSessionContinuation,
        providerSessionId: this.providerSessionId,
        persistedProviderSessionId: this.persistedProviderSessionId,
      };
    }

    if (this.currentTurn && this.preparedTaskId !== request.task.id) {
      await this.cancel();
    }

    await this.resetUncommittedSessionIfNeeded();
    const tools = this.createWorkspaceTools({
      ...request,
      prompt: "",
    });
    const { sessionContinuation } = await this.ensurePreparedSession(tools, request);
    this.preparedTaskId = request.task.id;
    this.preparedSessionContinuation = sessionContinuation;

    return {
      sessionContinuation,
      providerSessionId: this.providerSessionId,
      persistedProviderSessionId: this.persistedProviderSessionId,
    };
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.cancel();

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    this.currentTurnPromptVisible = false;
    this.currentLanguageModel = undefined;
    this.logger?.info("acp-execute-start", {
      taskId: request.task.id,
      roomId: request.room.id,
      memberId: request.member.id,
      memberHandle: request.member.handle,
      providerKind: request.member.provider.kind,
      providerLabel: request.member.provider.label,
      providerSessionId: this.providerSessionId ?? null,
    });

    let finalContent = "";
    let promptOpened = false;
    const tools = this.createWorkspaceTools(request);
    const currentTurn = (async () => {
      try {
        if (this.preparedTaskId !== request.task.id) {
          await this.resetUncommittedSessionIfNeeded();
          await this.ensurePreparedSession(tools, request);
        }
        this.logger?.info("acp-stream-open", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          providerSessionId: this.providerSessionId ?? null,
        });
        const languageModel = this.provider.languageModel(request.member.modelId);
        const protocolLanguageModel = languageModel as unknown as AcpProtocolLanguageModel;
        if (this.currentAbortController === abortController) {
          this.currentLanguageModel = protocolLanguageModel;
        }
        const result = streamText({
          abortSignal: abortController.signal,
          includeRawChunks: true,
          model: languageModel,
          prompt: request.prompt,
          tools,
          onChunk: async ({ chunk }) => {
            switch (chunk.type) {
              case "text-delta":
                finalContent = `${finalContent}${chunk.text}`;
                if (this.logger?.shouldLog(`acp-stream-text-delta:${request.task.id}`, 1000)) {
                  this.logger.info("acp-stream-text-delta", {
                    taskId: request.task.id,
                    memberId: request.member.id,
                    memberHandle: request.member.handle,
                    deltaChars: chunk.text.length,
                    accumulatedChars: finalContent.length,
                  });
                }
                await callbacks.onDraft(finalContent);
                return;
              case "tool-call":
                {
                  const toolName = summarizeToolChunk(chunk.input as { toolName?: string } | object | string | number | boolean | null | undefined);
                  const toolCallId = "toolCallId" in chunk && typeof chunk.toolCallId === "string" ? chunk.toolCallId : undefined;
                this.logger?.info("acp-stream-tool-call", {
                  taskId: request.task.id,
                  memberId: request.member.id,
                  memberHandle: request.member.handle,
                  summary: toolName,
                  toolCallId: toolCallId ?? null,
                });
                await callbacks.onStatus(encodeToolStatusSummary({ toolCallId, toolName, status: "running" }));
                return;
                }
              case "tool-result":
                {
                  const toolCallId = "toolCallId" in chunk && typeof chunk.toolCallId === "string" ? chunk.toolCallId : undefined;
                this.logger?.info("acp-stream-tool-result", {
                  taskId: request.task.id,
                  memberId: request.member.id,
                  memberHandle: request.member.handle,
                  toolName: chunk.toolName,
                  toolCallId: toolCallId ?? null,
                });
                await callbacks.onStatus(encodeToolStatusSummary({ toolCallId, toolName: chunk.toolName, status: "completed" }));
                return;
                }
              case "reasoning-delta":
                if (chunk.text.trim().length > 0) {
                  if (this.logger?.shouldLog(`acp-stream-reasoning-delta:${request.task.id}`, 1000)) {
                    this.logger.info("acp-stream-reasoning-delta", {
                      taskId: request.task.id,
                      memberId: request.member.id,
                      memberHandle: request.member.handle,
                      deltaChars: chunk.text.length,
                    });
                  }
                  await callbacks.onStatus(`Reasoning: ${chunk.text}`);
                }
                return;
              case "raw": {
                const summary = summarizeRawChunk(chunk.rawValue as JsonValue | object | undefined);
                this.logger?.info("acp-stream-raw", {
                  taskId: request.task.id,
                  memberId: request.member.id,
                  memberHandle: request.member.handle,
                  summary: summary ?? null,
                });
                if (summary) {
                  await callbacks.onStatus(summary);
                }
                return;
              }
              default:
                return;
            }
          },
        });
        promptOpened = true;
        if (this.currentAbortController === abortController) {
          this.currentTurnPromptVisible = true;
        }
        await callbacks.onPromptVisible?.();

        this.logger?.info("acp-stream-await-finish", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          accumulatedText: finalContent,
        });
        const [text, finishReason] = await Promise.all([result.text, result.finishReason]);
        if (abortController.signal.aborted) {
          this.logger?.info("acp-stream-aborted", {
            taskId: request.task.id,
            memberId: request.member.id,
            memberHandle: request.member.handle,
            reason: String(abortController.signal.reason ?? "aborted"),
          });
          return;
        }

        this.logger?.info("acp-stream-finish", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          finishReason,
          finalText: text.trim().length > 0 ? text : finalContent,
        });
        await this.commitSessionIdIfNeeded();
        await callbacks.onComplete(text.trim().length > 0 ? text : finalContent, finishReason);
      } catch (error) {
        if (abortController.signal.aborted && abortController.signal.reason === "cancelled") {
          this.logger?.info("acp-stream-cancelled", {
            taskId: request.task.id,
            memberId: request.member.id,
            memberHandle: request.member.handle,
          });
          return;
        }

        this.logger?.error("acp-stream-error", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          message: getErrorMessage(error as RuntimeError),
          accumulatedText: finalContent,
        });
        if (promptOpened) {
          await this.resetProvider({ reason: "stream-error-after-prompt" });
        }
        await callbacks.onError(getErrorMessage(error as RuntimeError));
      } finally {
        this.logger?.info("acp-execute-finish", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          aborted: abortController.signal.aborted,
        });
        if (this.currentAbortController === abortController) {
          this.currentAbortController = undefined;
          this.currentTurn = undefined;
          this.currentTurnPromptVisible = false;
          this.currentLanguageModel = undefined;
        }
        if (this.preparedTaskId === request.task.id) {
          this.preparedTaskId = undefined;
          this.preparedSessionContinuation = undefined;
        }
      }
    })();

    this.currentTurn = currentTurn;
    await currentTurn;
  }

  async discardSession(): Promise<void> {
    await this.resetProvider({ reason: "discard-session" });
  }

  async cancel(): Promise<void> {
    if (!this.currentAbortController || !this.currentTurn) {
      return;
    }

    const abortController = this.currentAbortController;
    const currentTurn = this.currentTurn;
    const shouldPersistSessionOnCancel = this.currentTurnPromptVisible;
    const sessionId = this.provider.getSessionId() ?? this.providerSessionId;
    const protocolCancel = this.currentLanguageModel?.connection?.cancel;
    this.logger?.warn("acp-cancel-start", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      providerSessionId: this.providerSessionId ?? null,
      shouldPersistSessionOnCancel,
      sessionId: sessionId ?? null,
      protocolCancelAvailable: typeof protocolCancel === "function",
    });

    let sentProtocolCancel = false;
    if (shouldPersistSessionOnCancel && sessionId && typeof protocolCancel === "function") {
      try {
        await protocolCancel({ sessionId });
        sentProtocolCancel = true;
        this.logger?.info("acp-cancel-session-sent", {
          memberId: this.member.id,
          memberHandle: this.member.handle,
          sessionId,
        });
      } catch (error) {
        this.logger?.warn("acp-cancel-session-failed", {
          memberId: this.member.id,
          memberHandle: this.member.handle,
          sessionId,
          message: getErrorMessage(error as RuntimeError),
        });
      }
    }

    if (!sentProtocolCancel) {
      abortController.abort("cancelled");
    }

    try {
      await withTimeout(
        currentTurn,
        ACP_CANCEL_TIMEOUT_MS,
        () => undefined,
        `ACP cancel for @${this.member.handle}`,
      );
      if (shouldPersistSessionOnCancel) {
        try {
          await this.commitSessionIdIfNeeded();
        } catch (error) {
          this.logger?.warn("acp-cancel-session-persist-failed", {
            memberId: this.member.id,
            memberHandle: this.member.handle,
            providerSessionId: this.providerSessionId ?? null,
            pendingPersistedSessionId: this.pendingPersistedSessionId ?? null,
            message: getErrorMessage(error as RuntimeError),
          });
        }
      }
      this.logger?.info("acp-cancel-complete", {
        memberId: this.member.id,
        memberHandle: this.member.handle,
        providerSessionId: this.providerSessionId ?? null,
        persistedProviderSessionId: this.persistedProviderSessionId ?? null,
        usedProtocolCancel: sentProtocolCancel,
        fallbackAbortSignal: !sentProtocolCancel,
      });
    } catch {
      this.logger?.warn("acp-cancel-timeout-reset-provider", {
        memberId: this.member.id,
        memberHandle: this.member.handle,
        providerSessionId: this.providerSessionId ?? null,
      });
      await this.resetProvider({ reason: "cancel-timeout" });
      if (this.currentAbortController === abortController) {
        this.currentAbortController = undefined;
      }
      if (this.currentTurn === currentTurn) {
        this.currentTurn = undefined;
      }
    }
  }

  async dispose(): Promise<void> {
    await this.cancel();
    this.provider.cleanup();
    await this.terminalRegistry.disposeAll();
  }

  private createWorkspaceTools(request: ExecutionRequest) {
    return acpTools(createMemberWorkspaceTools({
      request,
      host: this.host,
      projectWorkingDirectory: this.projectWorkingDirectory,
      accessibleRoots: this.accessibleRoots,
      terminalRegistry: this.terminalRegistry,
    }));
  }

  private createProvider(): ReturnType<typeof createACPProvider> {
    const spawnCommand = resolveSpawnCommand(this.member);
    return createACPProvider({
      command: spawnCommand.command,
      args: spawnCommand.args,
      env: this.member.provider.env,
      existingSessionId: this.providerSessionId,
      session: {
        cwd: this.projectWorkingDirectory,
        mcpServers: [],
      },
      persistSession: true,
    });
  }

  private async resetProvider(options: { clearPersistedSession?: boolean; reason?: string } = {}): Promise<void> {
    this.logger?.warn("acp-provider-reset", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      providerSessionId: this.providerSessionId ?? null,
      persistedProviderSessionId: this.persistedProviderSessionId ?? null,
      clearPersistedSession: options.clearPersistedSession ?? false,
      reason: options.reason ?? null,
    });
    this.provider.cleanup();
    await this.terminalRegistry.disposeAll();
    this.pendingPersistedSessionId = undefined;
    this.preparedTaskId = undefined;
    this.preparedSessionContinuation = undefined;
    if (options.clearPersistedSession) {
      this.persistedProviderSessionId = undefined;
      this.providerSessionId = undefined;
      await this.host.persistMemberSession?.({
        memberId: this.member.id,
        sessionId: undefined,
      });
    } else {
      this.providerSessionId = this.persistedProviderSessionId;
    }
    this.provider = this.createProvider();
  }

  private async ensurePreparedSession(
    tools: ReturnType<AcpMemberExecutor["createWorkspaceTools"]>,
    request: ExecutionPreparationRequest,
  ): Promise<{ sessionContinuation: ExecutionSessionContinuation }> {
    this.logger?.info("acp-session-prepare-start", {
      taskId: request.task.id,
      memberId: request.member.id,
      memberHandle: request.member.handle,
      providerKind: request.member.provider.kind,
      providerSessionId: this.providerSessionId ?? null,
      persistedProviderSessionId: this.persistedProviderSessionId ?? null,
    });

    if (this.member.provider.kind !== "codex-acp") {
      const sessionContinuation: ExecutionSessionContinuation = this.persistedProviderSessionId ? "resumed" : "fresh";
      this.logger?.info("acp-session-prepare-complete", {
        taskId: request.task.id,
        memberId: request.member.id,
        memberHandle: request.member.handle,
        providerSessionId: this.providerSessionId ?? null,
        persistedProviderSessionId: this.persistedProviderSessionId ?? null,
        sessionContinuation,
      });
      return { sessionContinuation };
    }

    try {
      await ensureCodexAcpSessionMode(this.provider, {
        mode: this.member.provider.env[CODEX_ACP_MODE_ENV_KEY],
        tools,
      });
    } catch (error) {
      if (!isMissingPersistedSessionError(error as RuntimeError, this.providerSessionId)) {
        throw error;
      }

      this.logger?.warn("acp-session-reset-stale", {
        memberId: this.member.id,
        memberHandle: this.member.handle,
        providerSessionId: this.providerSessionId ?? null,
        message: getErrorMessage(error as RuntimeError),
      });
      await this.resetProvider({ clearPersistedSession: true, reason: "stale-session" });
      await ensureCodexAcpSessionMode(this.provider, {
        mode: this.member.provider.env[CODEX_ACP_MODE_ENV_KEY],
        tools,
      });
    }

    let sessionContinuation: ExecutionSessionContinuation = this.persistedProviderSessionId ? "resumed" : "fresh";
    this.stageSessionIdIfNeeded();
    const currentSessionId = this.provider.getSessionId() ?? this.providerSessionId;
    if (!this.persistedProviderSessionId || currentSessionId !== this.persistedProviderSessionId) {
      sessionContinuation = "fresh";
    }

    this.logger?.info("acp-session-prepare-complete", {
      taskId: request.task.id,
      memberId: request.member.id,
      memberHandle: request.member.handle,
      providerSessionId: this.providerSessionId ?? null,
      persistedProviderSessionId: this.persistedProviderSessionId ?? null,
      pendingPersistedSessionId: this.pendingPersistedSessionId ?? null,
      sessionContinuation,
    });

    return { sessionContinuation };
  }

  private async resetUncommittedSessionIfNeeded(): Promise<void> {
    if (!this.pendingPersistedSessionId && this.providerSessionId === this.persistedProviderSessionId) {
      return;
    }

    this.logger?.info("acp-session-reset-uncommitted", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      providerSessionId: this.providerSessionId ?? null,
      persistedProviderSessionId: this.persistedProviderSessionId ?? null,
      pendingPersistedSessionId: this.pendingPersistedSessionId ?? null,
    });
    await this.resetProvider({ reason: "reset-uncommitted" });
  }

  private stageSessionIdIfNeeded(): void {
    const sessionId = this.provider.getSessionId() ?? undefined;
    this.providerSessionId = sessionId;
    this.pendingPersistedSessionId =
      sessionId && sessionId !== this.persistedProviderSessionId
        ? sessionId
        : undefined;
  }

  private async commitSessionIdIfNeeded(): Promise<void> {
    const sessionId = this.pendingPersistedSessionId ?? this.provider.getSessionId() ?? undefined;
    this.providerSessionId = sessionId;
    if (!sessionId || sessionId === this.persistedProviderSessionId) {
      this.pendingPersistedSessionId = undefined;
      return;
    }

    this.logger?.info("acp-session-persist", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      previousSessionId: this.persistedProviderSessionId ?? null,
      nextSessionId: sessionId,
    });
    this.persistedProviderSessionId = sessionId;
    this.pendingPersistedSessionId = undefined;
    await this.host.persistMemberSession?.({
      memberId: this.member.id,
      sessionId,
    });
  }
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
