import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { acpTools, createACPProvider, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME } from "@mcpc-tech/acp-ai-provider";
import { streamText, tool } from "ai";
import * as z from "zod";

import type { Project, RoomId, TeamMember } from "../domain/model";
import { CODEX_ACP_MODE_ENV_KEY, ensureCodexAcpSessionMode } from "../lib/acp";
import { isJsonObject, type JsonValue } from "../lib/json";
import type { ExecutionRequest, ExecutorCallbacks, MemberExecutor } from "./executor";
import type { DiagnosticsLogger } from "./diagnostics";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { isPathInsideRoot, resolveAcpSessionWorkingDirectory, resolveProjectWorkingDirectory } from "./project-paths";
import { TerminalRegistry } from "./terminal-registry";

const ACP_CANCEL_TIMEOUT_MS = 5 * 1000;
const TOOL_STATUS_PREFIX = "__oa_tool__";

export interface MemberToolHost {
  sendGroupMessage(input: { roomId: RoomId; memberId: string; taskId: string; content: string }): Promise<void>;
  sendDirectMessage(input: { roomId: RoomId; memberId: string; taskId: string; targetHandle: string; content: string }): Promise<void>;
  addRoleEmployee(input: { roomId: RoomId; memberId: string; role: string; employeeHandle: string; reason?: string }): Promise<{ ok: boolean; notices: string[] }>;
  removeRoleEmployee(input: { roomId: RoomId; memberId: string; role: string; employeeHandle: string; reason?: string }): Promise<{ ok: boolean; notices: string[] }>;
  renameRoleEmployee(input: { roomId: RoomId; memberId: string; employeeHandle: string; name: string }): Promise<{ ok: boolean; notices: string[] }>;
  runWatcher(input: { watcherId: string }): Promise<void>;
  inspectRoomState(input: { roomId: RoomId }): Promise<string>;
  persistMemberSession?(input: { memberId: string; sessionId?: string }): Promise<void>;
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

function resolveSpawnCommand(member: TeamMember): { command: string; args: string[] } {
  if (member.provider.command.trim().length === 0) {
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
  private readonly member: TeamMember;
  private readonly host: MemberToolHost;
  private readonly logger?: DiagnosticsLogger;
  private readonly terminalRegistry = new TerminalRegistry();
  private readonly projectRoot: string;
  private readonly projectWorkingDirectory: string;
  private readonly accessibleRoots: string[];
  private provider: ReturnType<typeof createACPProvider>;
  private providerSessionId?: string;
  private currentTurn?: Promise<void>;
  private currentAbortController?: AbortController;

  constructor(args: {
    workspaceRoot: string;
    project?: Pick<Project, "path">;
    member: TeamMember;
    host: MemberToolHost;
    logger?: DiagnosticsLogger;
  }) {
    this.workspaceRoot = args.workspaceRoot;
    this.project = args.project ?? {};
    this.member = args.member;
    this.host = args.host;
    this.logger = args.logger;
    this.providerSessionId = args.member.providerSessionId;
    this.projectRoot = resolveProjectWorkingDirectory(this.project, args.workspaceRoot);
    this.projectWorkingDirectory = resolveAcpSessionWorkingDirectory({
      workspaceRoot: args.workspaceRoot,
      project: this.project,
      providerWorkingDirectory: args.member.provider.workingDirectory,
    });
    this.accessibleRoots = [...new Set([this.projectRoot, this.workspaceRoot])];
    this.provider = this.createProvider();
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.cancel();

    const abortController = new AbortController();
    this.currentAbortController = abortController;
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
    const tools = this.createWorkspaceTools(request);
    const currentTurn = (async () => {
      try {
        this.logger?.info("acp-session-prepare-start", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          providerKind: request.member.provider.kind,
          providerSessionId: this.providerSessionId ?? null,
        });
        await this.prepareProviderSession(tools);
        this.logger?.info("acp-session-prepare-complete", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          providerSessionId: this.providerSessionId ?? null,
        });
        await this.persistSessionIdIfNeeded();
        this.logger?.info("acp-stream-open", {
          taskId: request.task.id,
          memberId: request.member.id,
          memberHandle: request.member.handle,
          providerSessionId: this.providerSessionId ?? null,
        });
        const result = streamText({
          abortSignal: abortController.signal,
          includeRawChunks: true,
          model: this.provider.languageModel(request.member.modelId),
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
    this.logger?.warn("acp-cancel-start", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      providerSessionId: this.providerSessionId ?? null,
    });
    abortController.abort("cancelled");
    try {
      await withTimeout(
        currentTurn,
        ACP_CANCEL_TIMEOUT_MS,
        () => undefined,
        `ACP cancel for @${this.member.handle}`,
      );
      this.logger?.info("acp-cancel-complete", {
        memberId: this.member.id,
        memberHandle: this.member.handle,
        providerSessionId: this.providerSessionId ?? null,
      });
    } catch {
      this.logger?.warn("acp-cancel-timeout-reset-provider", {
        memberId: this.member.id,
        memberHandle: this.member.handle,
        providerSessionId: this.providerSessionId ?? null,
      });
      await this.resetProvider();
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
    const roomStateTool = tool({
      description: "Inspect the current room transcript and active member/task state.",
      inputSchema: z.object({}),
      execute: async () => this.host.inspectRoomState({ roomId: request.room.id }),
    });

    return acpTools({
      oa_send_group_message: tool({
        description: "Send a message into the current room as this member. Prefer this tool over shelling out. Any @>handle mention actively routes work to that teammate. Plain @handle is only a passive reference; never use it to assign work because it does not notify or route them.",
        inputSchema: z.object({
          content: z.string().min(1),
        }),
        execute: async ({ content }) => {
          await this.host.sendGroupMessage({
            roomId: request.room.id,
            memberId: request.member.id,
            taskId: request.task.id,
            content,
          });
          return "group message sent";
        },
      }),
      oa_send_direct_message: tool({
        description: "Send a direct message from this member to another member handle in the same room, or to @user for a private reply to the human.",
        inputSchema: z.object({
          targetHandle: z.string().min(1).describe("Target handle, with or without leading @. Use @user to reply privately to the human."),
          content: z.string().min(1),
        }),
        execute: async ({ targetHandle, content }) => {
          await this.host.sendDirectMessage({
            roomId: request.room.id,
            memberId: request.member.id,
            taskId: request.task.id,
            targetHandle,
            content,
          });
          return `direct message sent to ${targetHandle.startsWith("@") ? targetHandle : `@${targetHandle}`}`;
        },
      }),
      oa_role_add_employee: tool({
        description: "Add a new employee under an existing room role owner. The role must be an existing role owner handle shown in the room roster, such as @builder or @checker, not a regular member like @research. This is a structured staffing tool, not a room message. Use a fresh handle without a leading @.",
        inputSchema: z.object({
          role: z.string().min(1).describe("Existing room role owner handle, with or without leading @, such as builder or checker."),
          employeeHandle: z.string().min(1).describe("New employee handle to create, without a leading @."),
          reason: z.string().min(1).optional(),
        }),
        execute: async ({ role, employeeHandle, reason }) => {
          const result = await this.host.addRoleEmployee({
            roomId: request.room.id,
            memberId: request.member.id,
            role,
            employeeHandle,
            reason,
          });
          return result;
        },
      }),
      oa_role_remove_employee: tool({
        description: "Remove an existing employee from an existing room role owner. The role must be an existing role owner handle shown in the room roster. This is a structured staffing tool, not a room message.",
        inputSchema: z.object({
          role: z.string().min(1).describe("Existing room role owner handle, with or without leading @, such as builder or checker."),
          employeeHandle: z.string().min(1).describe("Employee handle to remove, with or without leading @."),
          reason: z.string().min(1).optional(),
        }),
        execute: async ({ role, employeeHandle, reason }) => {
          const result = await this.host.removeRoleEmployee({
            roomId: request.room.id,
            memberId: request.member.id,
            role,
            employeeHandle,
            reason,
          });
          return result;
        },
      }),
      oa_role_rename_employee: tool({
        description: "Rename an existing role employee. This is a structured staffing tool, not a room message.",
        inputSchema: z.object({
          employeeHandle: z.string().min(1).describe("Employee handle to rename, with or without leading @."),
          name: z.string().min(1).describe("New display name."),
        }),
        execute: async ({ employeeHandle, name }) => {
          const result = await this.host.renameRoleEmployee({
            roomId: request.room.id,
            memberId: request.member.id,
            employeeHandle,
            name,
          });
          return result;
        },
      }),
      oa_run_room_watcher: tool({
        description: "Trigger a watcher for this room immediately.",
        inputSchema: z.object({
          watcherId: z.string().min(1),
        }),
        execute: async ({ watcherId }) => {
          await this.host.runWatcher({ watcherId });
          return `watcher ${watcherId} executed`;
        },
      }),
      oa_room_state: roomStateTool,
      oa_read_file: tool({
        description: "Read a UTF-8 text file under the project working directory. Absolute paths inside OpenAquarium are also allowed.",
        inputSchema: z.object({
          filePath: z.string().min(1),
        }),
        execute: async ({ filePath }) => {
          const resolvedPath = this.resolveAccessiblePath(filePath);
          return readFile(resolvedPath, "utf8");
        },
      }),
      oa_write_file: tool({
        description: "Write a UTF-8 text file under the project working directory. Creates parent directories if needed.",
        inputSchema: z.object({
          filePath: z.string().min(1),
          content: z.string(),
        }),
        execute: async ({ filePath, content }) => {
          const resolvedPath = this.resolveAccessiblePath(filePath);
          await mkdir(path.dirname(resolvedPath), { recursive: true });
          await writeFile(resolvedPath, content, "utf8");
          return `wrote ${path.relative(this.projectWorkingDirectory, resolvedPath)}`;
        },
      }),
      oa_run_command: tool({
        description: "Run a command inside the project working directory by default and capture stdout/stderr. Use args instead of shell quoting.",
        inputSchema: z.object({
          command: z.string().min(1),
          args: z.array(z.string()).default([]),
          cwd: z.string().optional(),
          outputByteLimit: z.number().int().positive().max(256_000).default(96_000),
        }),
        execute: async ({ command, args, cwd, outputByteLimit }) => {
          const resolvedCwd = cwd ? this.resolveAccessiblePath(cwd) : this.projectWorkingDirectory;
          const created = await this.terminalRegistry.create({
            sessionId: request.task.id,
            command,
            args,
            cwd: resolvedCwd,
            outputByteLimit,
          });
          const exitStatus = await this.terminalRegistry.wait({
            sessionId: request.task.id,
            terminalId: created.terminalId,
          });
          const output = await this.terminalRegistry.output({
            sessionId: request.task.id,
            terminalId: created.terminalId,
          });
          await this.terminalRegistry.release({
            sessionId: request.task.id,
            terminalId: created.terminalId,
          });

          return {
            exitCode: exitStatus.exitCode ?? null,
            signal: exitStatus.signal ?? null,
            truncated: output.truncated,
            output: output.output,
          };
        },
      }),
    });
  }

  private resolveAccessiblePath(filePath: string): string {
    const resolvedPath = path.normalize(
      path.isAbsolute(filePath) ? filePath : path.resolve(this.projectWorkingDirectory, filePath),
    );
    if (!this.accessibleRoots.some((rootPath) => isPathInsideRoot(rootPath, resolvedPath))) {
      throw new Error(`Path "${filePath}" is outside the project or OpenAquarium workspace roots`);
    }
    return resolvedPath;
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

  private async resetProvider(): Promise<void> {
    this.logger?.warn("acp-provider-reset", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      providerSessionId: this.providerSessionId ?? null,
    });
    this.provider.cleanup();
    await this.terminalRegistry.disposeAll();
    this.providerSessionId = undefined;
    await this.host.persistMemberSession?.({
      memberId: this.member.id,
      sessionId: undefined,
    });
    this.provider = this.createProvider();
  }

  private async prepareProviderSession(tools: ReturnType<AcpMemberExecutor["createWorkspaceTools"]>): Promise<void> {
    if (this.member.provider.kind !== "codex-acp") {
      return;
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
      await this.resetProvider();
      await ensureCodexAcpSessionMode(this.provider, {
        mode: this.member.provider.env[CODEX_ACP_MODE_ENV_KEY],
        tools,
      });
    }
  }

  private async persistSessionIdIfNeeded(): Promise<void> {
    const sessionId = this.provider.getSessionId() ?? undefined;
    if (!sessionId || sessionId === this.providerSessionId) {
      return;
    }

    this.logger?.info("acp-session-persist", {
      memberId: this.member.id,
      memberHandle: this.member.handle,
      previousSessionId: this.providerSessionId ?? null,
      nextSessionId: sessionId,
    });
    this.providerSessionId = sessionId;
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
