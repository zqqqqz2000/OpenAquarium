import type { AssistantModelMessage, ToolModelMessage } from "@ai-sdk/provider-utils";
import { streamText } from "ai";

import type { JsonValue } from "../lib/json";
import { isJsonObject } from "../lib/json";
import type { OpenAICompatibleProviderBinding, Project } from "../domain/model";
import type {
  ExecutionMember,
  ExecutionRequest,
  ExecutorCallbacks,
  MemberExecutor,
} from "./executor";
import type { DiagnosticsLogger } from "./diagnostics";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { createWorkspaceTools, type MemberToolHost, resolveExecutorDirectories } from "./member-workspace-tools";
import { appendConversationTurn, buildPersistedUserTurnMessage } from "./openai-compatible-conversation";
import {
  isContextWindowErrorMessage,
  prepareOpenAICompatibleConversation,
} from "./openai-compatible-compaction";
import { createConfiguredMcpTools } from "./openai-compatible-mcp";
import { createOpenAICompatibleProvider } from "./openai-compatible-provider";
import { TerminalRegistry } from "./terminal-registry";

const TOOL_STATUS_PREFIX = "__oa_tool__";

type OpenAICompatibleExecutionMember = ExecutionMember & {
  provider: OpenAICompatibleProviderBinding;
};

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
    return "tool";
  }

  const maybeToolInput = input as {
    toolName?: string;
  };

  return maybeToolInput.toolName?.trim() || "tool";
}

function encodeToolStatusSummary(input: { toolCallId?: string; toolName: string; status: "running" | "completed" }): string {
  return `${TOOL_STATUS_PREFIX}${JSON.stringify(input)}`;
}

export class OpenAICompatibleMemberExecutor implements MemberExecutor {
  private readonly member: OpenAICompatibleExecutionMember;
  private readonly host: MemberToolHost;
  private readonly logger?: DiagnosticsLogger;
  private readonly terminalRegistry = new TerminalRegistry();
  private readonly projectWorkingDirectory: string;
  private readonly accessibleRoots: string[];
  private readonly provider: ReturnType<typeof createOpenAICompatibleProvider>;
  private currentTurn?: Promise<void>;
  private currentAbortController?: AbortController;

  constructor(args: {
    workspaceRoot: string;
    project?: Pick<Project, "path">;
    member: ExecutionMember;
    host: MemberToolHost;
    logger?: DiagnosticsLogger;
  }) {
    if (args.member.provider.kind !== "openai-compatible") {
      throw new Error(`OpenAICompatibleMemberExecutor requires an openai-compatible provider for @${args.member.handle}`);
    }
    const member = args.member as OpenAICompatibleExecutionMember;
    this.member = member;
    this.host = args.host;
    this.logger = args.logger;
    const directories = resolveExecutorDirectories({
      workspaceRoot: args.workspaceRoot,
      project: args.project,
    });
    this.projectWorkingDirectory = directories.projectWorkingDirectory;
    this.accessibleRoots = directories.accessibleRoots;
    this.provider = createOpenAICompatibleProvider(member.provider);
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.cancel();

    const modelId = request.member.modelId?.trim();
    if (!modelId) {
      throw new Error(`OpenAI-compatible provider "${request.member.provider.label}" for @${request.member.handle} requires a model id`);
    }

    const abortController = new AbortController();
    this.currentAbortController = abortController;
    let finalContent = "";

    const workspaceTools = createWorkspaceTools({
      request,
      host: this.host,
      projectWorkingDirectory: this.projectWorkingDirectory,
      accessibleRoots: this.accessibleRoots,
      terminalRegistry: this.terminalRegistry,
    });

    const currentTurn = (async () => {
      let mcpTools:
        | Awaited<ReturnType<typeof createConfiguredMcpTools>>
        | undefined;
      let promptVisible = false;
      try {
        mcpTools = await createConfiguredMcpTools({
          binding: this.member.provider,
          defaultWorkingDirectory: this.projectWorkingDirectory,
        });
        const availableTools = {
          ...workspaceTools,
          ...(mcpTools?.tools ?? {}),
        };
        const currentConversation = request.openAICompatibleConversation ?? {
          messages: request.messageHistory ?? [],
        };
        const currentUserMessage = buildPersistedUserTurnMessage(request.prompt);

        const executePreparedTurn = async (forceCompaction = false) => {
          finalContent = "";
          const preparedConversation = await prepareOpenAICompatibleConversation({
            workspaceRoot: this.projectWorkingDirectory,
            memberId: request.member.id,
            binding: this.member.provider,
            provider: this.provider,
            modelId,
            conversation: currentConversation,
            currentUserMessage,
            abortSignal: abortController.signal,
            callbacks,
            forceCompaction,
          });
          const result = streamText({
            abortSignal: abortController.signal,
            includeRawChunks: true,
            model: this.provider.languageModel(modelId),
            messages: preparedConversation.modelMessages,
            tools: availableTools,
            onChunk: async ({ chunk }) => {
              switch (chunk.type) {
                case "text-delta":
                  finalContent = `${finalContent}${chunk.text}`;
                  await callbacks.onDraft(finalContent);
                  return;
                case "tool-call": {
                  const toolName = summarizeToolChunk(chunk.input as { toolName?: string } | object | string | number | boolean | null | undefined);
                  const toolCallId = "toolCallId" in chunk && typeof chunk.toolCallId === "string" ? chunk.toolCallId : undefined;
                  await callbacks.onStatus(encodeToolStatusSummary({ toolCallId, toolName, status: "running" }));
                  return;
                }
                case "tool-result": {
                  const toolCallId = "toolCallId" in chunk && typeof chunk.toolCallId === "string" ? chunk.toolCallId : undefined;
                  await callbacks.onStatus(encodeToolStatusSummary({ toolCallId, toolName: chunk.toolName, status: "completed" }));
                  return;
                }
                case "reasoning-delta":
                  if (chunk.text.trim().length > 0) {
                    await callbacks.onStatus(`Reasoning: ${chunk.text}`);
                  }
                  return;
                case "raw": {
                  const summary = summarizeRawChunk(chunk.rawValue as JsonValue | object | undefined);
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

          if (!promptVisible) {
            promptVisible = true;
            await callbacks.onPromptVisible?.();
          }

          const [text, finishReason, response] = await Promise.all([
            result.text,
            result.finishReason,
            result.response,
          ]);

          return {
            text,
            finishReason,
            response,
            conversation: preparedConversation.conversation,
            compacted: preparedConversation.compacted,
          };
        };

        let completion;
        try {
          completion = await executePreparedTurn();
        } catch (error) {
          if (
            !abortController.signal.aborted
            && isContextWindowErrorMessage(getErrorMessage(error as RuntimeError))
          ) {
            completion = await executePreparedTurn(true);
          } else {
            throw error;
          }
        }

        if (abortController.signal.aborted) {
          return;
        }

        await callbacks.onComplete(
          completion.text.trim().length > 0 ? completion.text : finalContent,
          completion.finishReason,
          {
            nextOpenAICompatibleConversation: appendConversationTurn({
              conversation: completion.conversation,
              userMessage: currentUserMessage,
              responseMessages: completion.response.messages as Array<AssistantModelMessage | ToolModelMessage>,
            }),
          },
        );
      } catch (error) {
        if (abortController.signal.aborted && abortController.signal.reason === "cancelled") {
          return;
        }

        this.logger?.error("openai-compatible-stream-error", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          message: getErrorMessage(error as RuntimeError),
          accumulatedText: finalContent,
        });
        await callbacks.onError(getErrorMessage(error as RuntimeError));
      } finally {
        await mcpTools?.close();
        if (this.currentAbortController === abortController) {
          this.currentAbortController = undefined;
          this.currentTurn = undefined;
        }
      }
    })();

    this.currentTurn = currentTurn;
    await currentTurn;
  }

  async cancel(): Promise<void> {
    if (!this.currentAbortController || !this.currentTurn) {
      return;
    }

    const abortController = this.currentAbortController;
    const currentTurn = this.currentTurn;
    abortController.abort("cancelled");
    try {
      await currentTurn;
    } finally {
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
    await this.terminalRegistry.disposeAll();
  }
}
