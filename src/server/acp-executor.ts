import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { acpTools, createACPProvider, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME } from "@mcpc-tech/acp-ai-provider";
import { streamText, tool } from "ai";
import { z } from "zod";

import type { RoomId, TeamMember } from "../domain/model";
import { CODEX_ACP_MODE_ENV_KEY, ensureCodexAcpSessionMode } from "../lib/acp";
import { isJsonObject, type JsonValue } from "../lib/json";
import type { ExecutionRequest, ExecutorCallbacks, MemberExecutor } from "./executor";
import { getErrorMessage, type RuntimeError } from "./error-utils";
import { TerminalRegistry } from "./terminal-registry";

const ACP_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const ACP_CANCEL_TIMEOUT_MS = 5 * 1000;

export interface MemberToolHost {
  sendGroupMessage(input: { roomId: RoomId; memberId: string; taskId: string; content: string }): Promise<void>;
  sendDirectMessage(input: { roomId: RoomId; memberId: string; taskId: string; targetHandle: string; content: string }): Promise<void>;
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

class IdleTimeoutController {
  private readonly timeoutPromise: Promise<never>;
  private rejectTimeout?: (error: Error) => void;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onTimeout: () => void,
    private readonly label: string,
  ) {
    this.timeoutPromise = new Promise<never>((_resolve, reject) => {
      this.rejectTimeout = reject;
    });
    this.touch();
  }

  touch(): void {
    if (this.stopped) {
      return;
    }

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      if (this.stopped) {
        return;
      }

      this.stopped = true;
      this.onTimeout();
      this.rejectTimeout?.(new TimeoutError(`${this.label} timed out after ${this.timeoutMs}ms without activity`));
    }, this.timeoutMs);
  }

  async race<T>(operation: Promise<T>): Promise<T> {
    return Promise.race([operation, this.timeoutPromise]);
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
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

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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

export class AcpMemberExecutor implements MemberExecutor {
  private readonly workspaceRoot: string;
  private readonly member: TeamMember;
  private readonly host: MemberToolHost;
  private readonly terminalRegistry = new TerminalRegistry();
  private provider: ReturnType<typeof createACPProvider>;
  private providerSessionId?: string;
  private currentTurn?: Promise<void>;
  private currentAbortController?: AbortController;

  constructor(args: { workspaceRoot: string; member: TeamMember; host: MemberToolHost }) {
    this.workspaceRoot = args.workspaceRoot;
    this.member = args.member;
    this.host = args.host;
    this.providerSessionId = args.member.providerSessionId;
    this.provider = this.createProvider();
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.cancel();

    const abortController = new AbortController();
    this.currentAbortController = abortController;

    let finalContent = "";
    const tools = this.createWorkspaceTools(request);
    const idleTimeout = new IdleTimeoutController(
      ACP_IDLE_TIMEOUT_MS,
      () => {
        abortController.abort("timed_out");
      },
      `ACP turn for @${this.member.handle}`,
    );
    const currentTurn = (async () => {
      try {
        await this.prepareProviderSession(tools);
        await this.persistSessionIdIfNeeded();
        idleTimeout.touch();
        const result = streamText({
          abortSignal: abortController.signal,
          includeRawChunks: true,
          model: this.provider.languageModel(),
          prompt: request.prompt,
          tools,
          onChunk: async ({ chunk }) => {
            idleTimeout.touch();
            switch (chunk.type) {
              case "text-delta":
                finalContent = `${finalContent}${chunk.text}`;
                await callbacks.onDraft(finalContent);
                return;
              case "tool-call":
                await callbacks.onStatus(
                  `${summarizeToolChunk(chunk.input as { toolName?: string } | object | string | number | boolean | null | undefined)} (called)`,
                );
                return;
              case "tool-result":
                await callbacks.onStatus(`${chunk.toolName} (completed)`);
                return;
              case "reasoning-delta":
                if (chunk.text.trim().length > 0) {
                  await callbacks.onStatus(`Reasoning: ${chunk.text.trim()}`);
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

        const [text, finishReason] = await idleTimeout.race(Promise.all([result.text, result.finishReason]));
        idleTimeout.stop();
        if (abortController.signal.aborted) {
          return;
        }

        await callbacks.onComplete(text.trim().length > 0 ? text : finalContent, finishReason);
      } catch (error) {
        if (abortController.signal.aborted && abortController.signal.reason === "cancelled") {
          return;
        }

        if (error instanceof TimeoutError) {
          await this.resetProvider();
        }
        await callbacks.onError(getErrorMessage(error as RuntimeError));
      } finally {
        idleTimeout.stop();
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
      await withTimeout(
        currentTurn,
        ACP_CANCEL_TIMEOUT_MS,
        () => undefined,
        `ACP cancel for @${this.member.handle}`,
      );
    } catch {
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
        description: "Send a message into the current room as this member. Prefer this tool over shelling out. Any @handle mention in the message routes work to that teammate.",
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
        description: "Read a UTF-8 text file under the workspace root.",
        inputSchema: z.object({
          filePath: z.string().min(1),
        }),
        execute: async ({ filePath }) => {
          const resolvedPath = this.resolveWorkspacePath(filePath);
          return readFile(resolvedPath, "utf8");
        },
      }),
      oa_write_file: tool({
        description: "Write a UTF-8 text file under the workspace root. Creates parent directories if needed.",
        inputSchema: z.object({
          filePath: z.string().min(1),
          content: z.string(),
        }),
        execute: async ({ filePath, content }) => {
          const resolvedPath = this.resolveWorkspacePath(filePath);
          await mkdir(path.dirname(resolvedPath), { recursive: true });
          await writeFile(resolvedPath, content, "utf8");
          return `wrote ${path.relative(this.workspaceRoot, resolvedPath)}`;
        },
      }),
      oa_run_command: tool({
        description: "Run a command inside the workspace root and capture stdout/stderr. Use args instead of shell quoting.",
        inputSchema: z.object({
          command: z.string().min(1),
          args: z.array(z.string()).default([]),
          cwd: z.string().optional(),
          outputByteLimit: z.number().int().positive().max(256_000).default(96_000),
        }),
        execute: async ({ command, args, cwd, outputByteLimit }) => {
          const resolvedCwd = cwd ? this.resolveWorkspacePath(cwd) : this.workspaceRoot;
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

  private resolveWorkspacePath(filePath: string): string {
    const resolvedPath = path.resolve(this.workspaceRoot, filePath);
    if (!isInsideRoot(this.workspaceRoot, resolvedPath)) {
      throw new Error(`Path "${filePath}" is outside the workspace root`);
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
        cwd: this.member.provider.workingDirectory ?? this.workspaceRoot,
        mcpServers: [],
      },
      persistSession: true,
    });
  }

  private async resetProvider(): Promise<void> {
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

    await ensureCodexAcpSessionMode(this.provider, {
      mode: this.member.provider.env[CODEX_ACP_MODE_ENV_KEY],
      tools,
    });
  }

  private async persistSessionIdIfNeeded(): Promise<void> {
    const sessionId = this.provider.getSessionId() ?? undefined;
    if (!sessionId || sessionId === this.providerSessionId) {
      return;
    }

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
