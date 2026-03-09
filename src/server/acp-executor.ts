import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { acpTools, createACPProvider, ACP_PROVIDER_AGENT_DYNAMIC_TOOL_NAME } from "@mcpc-tech/acp-ai-provider";
import { streamText, tool } from "ai";
import { z } from "zod";

import type { RoomId, TeamMember } from "../domain/model";
import type { ExecutionRequest, ExecutorCallbacks, MemberExecutor } from "./executor";
import { getErrorMessage } from "./error-utils";
import { TerminalRegistry } from "./terminal-registry";

export interface MemberToolHost {
  sendGroupMessage(input: { roomId: RoomId; memberId: string; content: string }): Promise<void>;
  sendDirectMessage(input: { roomId: RoomId; memberId: string; targetHandle: string; content: string }): Promise<void>;
  runWatcher(input: { watcherId: string }): Promise<void>;
  inspectRoomState(input: { roomId: RoomId }): Promise<string>;
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

function summarizeRawChunk(rawValue: unknown): string | undefined {
  if (typeof rawValue !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(rawValue) as { type?: string; entries?: unknown[]; path?: string; terminalId?: string; toolCallId?: string };

    switch (parsed.type) {
      case "plan":
        return `Plan updated (${parsed.entries?.length ?? 0} step(s))`;
      case "diff":
        return `Diff ready for ${parsed.path ?? "unknown file"}`;
      case "terminal":
        return `Terminal update ${parsed.terminalId ?? parsed.toolCallId ?? ""}`.trim();
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function summarizeToolChunk(input: unknown): string {
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
  private readonly provider;
  private currentTurn?: Promise<void>;
  private currentAbortController?: AbortController;

  constructor(args: { workspaceRoot: string; member: TeamMember; host: MemberToolHost }) {
    this.workspaceRoot = args.workspaceRoot;
    this.member = args.member;
    this.host = args.host;
    const spawnCommand = resolveSpawnCommand(this.member);
    this.provider = createACPProvider({
      command: spawnCommand.command,
      args: spawnCommand.args,
      env: this.member.provider.env,
      session: {
        cwd: this.member.provider.workingDirectory ?? this.workspaceRoot,
        mcpServers: [],
      },
      persistSession: true,
    });
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.cancel();
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    let finalContent = "";
    const tools = this.createWorkspaceTools(request);
    const currentTurn = (async () => {
      try {
        const result = streamText({
          abortSignal: abortController.signal,
          includeRawChunks: true,
          model: this.provider.languageModel(),
          prompt: request.prompt,
          tools,
          onChunk: async ({ chunk }) => {
            switch (chunk.type) {
              case "text-delta":
                finalContent = `${finalContent}${chunk.text}`;
                await callbacks.onDraft(finalContent);
                return;
              case "tool-call":
                await callbacks.onStatus(`${summarizeToolChunk(chunk.input)} (called)`);
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
                const summary = summarizeRawChunk(chunk.rawValue);
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

        const [text, finishReason] = await Promise.all([result.text, result.finishReason]);
        if (abortController.signal.aborted) {
          return;
        }

        await callbacks.onComplete(text.trim().length > 0 ? text : finalContent, finishReason);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }

        await callbacks.onError(getErrorMessage(error));
      } finally {
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

    this.currentAbortController.abort("cancelled");
    try {
      await this.currentTurn;
    } catch {
      // The current turn already forwards errors through callbacks.
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
        description: "Send a message into the current room as this member. Use @handle in the content to mention teammates.",
        inputSchema: z.object({
          content: z.string().min(1),
        }),
        execute: async ({ content }) => {
          await this.host.sendGroupMessage({
            roomId: request.room.id,
            memberId: request.member.id,
            content,
          });
          return "group message sent";
        },
      }),
      oa_send_direct_message: tool({
        description: "Send a direct message from this member to another member handle in the same room.",
        inputSchema: z.object({
          targetHandle: z.string().min(1).describe("Target member handle, with or without leading @."),
          content: z.string().min(1),
        }),
        execute: async ({ targetHandle, content }) => {
          await this.host.sendDirectMessage({
            roomId: request.room.id,
            memberId: request.member.id,
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
}
