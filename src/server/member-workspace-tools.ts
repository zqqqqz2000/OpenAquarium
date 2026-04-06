import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { tool } from "ai";
import * as z from "zod";

import type { Project, RoomId } from "../domain/model";
import { applyStructuredPatch } from "./apply-patch";
import { inspectLocalImage } from "./image-inspector";
import { isPathInsideRoot, resolveAcpSessionWorkingDirectory, resolveProjectWorkingDirectory } from "./project-paths";
import { TerminalRegistry } from "./terminal-registry";
import type { ExecutionRequest } from "./executor";

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

const DEFAULT_TERMINAL_YIELD_TIME_MS = 1_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2_000;
const MAX_OUTPUT_TOKENS = 16_000;
const READ_THREAD_TERMINAL_WAIT_MS = 300;
const READ_THREAD_TERMINAL_POLL_MS = 25;

function approximateOutputByteLimit(maxOutputTokens: number): number {
  return Math.min(Math.max(maxOutputTokens * 8, 4_096), 256_000);
}

function trimOutputForTokens(output: string, maxOutputTokens: number): { output: string; truncated: boolean } {
  const maxChars = Math.max(256, maxOutputTokens * 4);
  if (output.length <= maxChars) {
    return {
      output,
      truncated: false,
    };
  }

  return {
    output: output.slice(-maxChars),
    truncated: true,
  };
}

async function waitForTerminalYield(args: {
  terminalRegistry: TerminalRegistry;
  sessionId: string;
  terminalId: string;
  yieldTimeMs: number;
}): Promise<{
  exitStatus?: {
    exitCode?: number;
    signal?: string;
  };
}> {
  const waitForExit = args.terminalRegistry.wait({
    sessionId: args.sessionId,
    terminalId: args.terminalId,
  }).then((exitStatus) => ({
    exitStatus: {
      exitCode: exitStatus.exitCode ?? undefined,
      signal: exitStatus.signal ?? undefined,
    },
  }));
  const timeout = sleep(args.yieldTimeMs, {});
  return Promise.race([waitForExit, timeout]);
}

async function readTerminalResult(args: {
  terminalRegistry: TerminalRegistry;
  sessionId: string;
  terminalId: string;
  maxOutputTokens: number;
  consume: boolean;
}) {
  const output = await args.terminalRegistry.output({
    sessionId: args.sessionId,
    terminalId: args.terminalId,
    consume: args.consume,
  });
  const trimmed = trimOutputForTokens(output.output, args.maxOutputTokens);

  return {
    session_id: args.terminalId,
    running: !output.exitStatus,
    exit_code: output.exitStatus?.exitCode ?? null,
    signal: output.exitStatus?.signal ?? null,
    truncated: output.truncated || trimmed.truncated,
    output: trimmed.output,
  };
}

async function readThreadTerminalResult(args: {
  terminalRegistry: TerminalRegistry;
  sessionId: string;
  terminalId: string;
  maxOutputTokens: number;
}) {
  const initial = await readTerminalResult({
    terminalRegistry: args.terminalRegistry,
    sessionId: args.sessionId,
    terminalId: args.terminalId,
    maxOutputTokens: args.maxOutputTokens,
    consume: true,
  });

  if (initial.output.length > 0 || !initial.running) {
    return initial;
  }

  const deadline = Date.now() + READ_THREAD_TERMINAL_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(READ_THREAD_TERMINAL_POLL_MS);
    const unread = await args.terminalRegistry.unreadOutput({
      sessionId: args.sessionId,
      terminalId: args.terminalId,
    });
    if (unread.output.length > 0 || unread.exitStatus) {
      break;
    }
  }

  return readTerminalResult({
    terminalRegistry: args.terminalRegistry,
    sessionId: args.sessionId,
    terminalId: args.terminalId,
    maxOutputTokens: args.maxOutputTokens,
    consume: true,
  });
}

function resolveShellCommand(input: {
  cmd: string;
  shell?: string;
  login?: boolean;
}): {
  command: string;
  args: string[];
} {
  const shell = input.shell?.trim() || "bash";
  const shellName = path.basename(shell).toLowerCase();
  const loginArgs = input.login === false
    ? []
    : shellName === "bash" || shellName === "zsh"
      ? ["-l"]
      : [];
  return {
    command: shell,
    args: [...loginArgs, "-c", input.cmd],
  };
}

export function resolveExecutorDirectories(args: {
  workspaceRoot: string;
  project?: Pick<Project, "path">;
  providerWorkingDirectory?: string;
}): {
  projectRoot: string;
  projectWorkingDirectory: string;
  accessibleRoots: string[];
} {
  const projectRoot = resolveProjectWorkingDirectory(args.project ?? {}, args.workspaceRoot);
  const projectWorkingDirectory = resolveAcpSessionWorkingDirectory({
    workspaceRoot: args.workspaceRoot,
    project: args.project ?? {},
    providerWorkingDirectory: args.providerWorkingDirectory,
  });

  return {
    projectRoot,
    projectWorkingDirectory,
    accessibleRoots: [...new Set([projectRoot, args.workspaceRoot])],
  };
}

export function resolveAccessiblePath(args: {
  filePath: string;
  projectWorkingDirectory: string;
  accessibleRoots: string[];
}): string {
  const resolvedPath = path.normalize(
    path.isAbsolute(args.filePath) ? args.filePath : path.resolve(args.projectWorkingDirectory, args.filePath),
  );
  if (!args.accessibleRoots.some((rootPath) => isPathInsideRoot(rootPath, resolvedPath))) {
    throw new Error(`Path "${args.filePath}" is outside the project or OpenAquarium workspace roots`);
  }
  return resolvedPath;
}

export function createWorkspaceTools(args: {
  request: ExecutionRequest;
  host: MemberToolHost;
  projectWorkingDirectory: string;
  accessibleRoots: string[];
  terminalRegistry: TerminalRegistry;
}) {
  const { request, host, projectWorkingDirectory, accessibleRoots, terminalRegistry } = args;

  const roomStateTool = tool({
    description: "Inspect the current room transcript and active member/task state.",
    inputSchema: z.object({}),
    execute: async () => host.inspectRoomState({ roomId: request.room.id }),
  });

  return {
    oa_send_group_message: tool({
      description: "Send a message into the current room as this member. Prefer this tool over shelling out. Any @>handle mention actively routes work to that teammate. Plain @handle is only a passive reference; never use it to assign work because it does not notify or route them.",
      inputSchema: z.object({
        content: z.string().min(1),
      }),
      execute: async ({ content }) => {
        await host.sendGroupMessage({
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
        await host.sendDirectMessage({
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
        return host.addRoleEmployee({
          roomId: request.room.id,
          memberId: request.member.id,
          role,
          employeeHandle,
          reason,
        });
      },
    }),
    oa_role_remove_employee: tool({
      description: "Remove an existing employee from an existing room role owner. The role must be an existing room role owner handle shown in the room roster. This is a structured staffing tool, not a room message.",
      inputSchema: z.object({
        role: z.string().min(1).describe("Existing room role owner handle, with or without leading @, such as builder or checker."),
        employeeHandle: z.string().min(1).describe("Employee handle to remove, with or without leading @."),
        reason: z.string().min(1).optional(),
      }),
      execute: async ({ role, employeeHandle, reason }) => {
        return host.removeRoleEmployee({
          roomId: request.room.id,
          memberId: request.member.id,
          role,
          employeeHandle,
          reason,
        });
      },
    }),
    oa_role_rename_employee: tool({
      description: "Rename an existing role employee. This is a structured staffing tool, not a room message.",
      inputSchema: z.object({
        employeeHandle: z.string().min(1).describe("Employee handle to rename, with or without leading @."),
        name: z.string().min(1).describe("New display name."),
      }),
      execute: async ({ employeeHandle, name }) => {
        return host.renameRoleEmployee({
          roomId: request.room.id,
          memberId: request.member.id,
          employeeHandle,
          name,
        });
      },
    }),
    oa_run_room_watcher: tool({
      description: "Trigger a watcher for this room immediately.",
      inputSchema: z.object({
        watcherId: z.string().min(1),
      }),
      execute: async ({ watcherId }) => {
        await host.runWatcher({ watcherId });
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
        const resolvedPath = resolveAccessiblePath({
          filePath,
          projectWorkingDirectory,
          accessibleRoots,
        });
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
        const resolvedPath = resolveAccessiblePath({
          filePath,
          projectWorkingDirectory,
          accessibleRoots,
        });
        await mkdir(path.dirname(resolvedPath), { recursive: true });
        await writeFile(resolvedPath, content, "utf8");
        return `wrote ${path.relative(projectWorkingDirectory, resolvedPath)}`;
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
      execute: async ({ command, args: commandArgs, cwd, outputByteLimit }) => {
        const resolvedCwd = cwd
          ? resolveAccessiblePath({
            filePath: cwd,
            projectWorkingDirectory,
            accessibleRoots,
          })
          : projectWorkingDirectory;
        const created = await terminalRegistry.create({
          sessionId: request.task.id,
          command,
          args: commandArgs,
          cwd: resolvedCwd,
          outputByteLimit,
        });
        const exitStatus = await terminalRegistry.wait({
          sessionId: request.task.id,
          terminalId: created.terminalId,
        });
        const output = await terminalRegistry.output({
          sessionId: request.task.id,
          terminalId: created.terminalId,
        });
        await terminalRegistry.release({
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
    exec_command: tool({
      description: "Run a shell command with Codex-style semantics. Returns a session id while the process is still running so you can poll or write more stdin later.",
      inputSchema: z.object({
        cmd: z.string().min(1),
        workdir: z.string().optional(),
        yield_time_ms: z.number().int().positive().max(60_000).default(DEFAULT_TERMINAL_YIELD_TIME_MS),
        max_output_tokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).default(DEFAULT_MAX_OUTPUT_TOKENS),
        shell: z.string().optional(),
        login: z.boolean().default(true),
        tty: z.boolean().optional(),
      }),
      execute: async ({ cmd, workdir, yield_time_ms, max_output_tokens, shell, login, tty: _tty }) => {
        const resolvedCwd = workdir
          ? resolveAccessiblePath({
            filePath: workdir,
            projectWorkingDirectory,
            accessibleRoots,
          })
          : projectWorkingDirectory;
        const shellCommand = resolveShellCommand({
          cmd,
          shell,
          login,
        });
        const created = await terminalRegistry.create({
          sessionId: request.task.id,
          command: shellCommand.command,
          args: shellCommand.args,
          cwd: resolvedCwd,
          outputByteLimit: approximateOutputByteLimit(max_output_tokens),
        });
        await waitForTerminalYield({
          terminalRegistry,
          sessionId: request.task.id,
          terminalId: created.terminalId,
          yieldTimeMs: yield_time_ms,
        });
        return readTerminalResult({
          terminalRegistry,
          sessionId: request.task.id,
          terminalId: created.terminalId,
          maxOutputTokens: max_output_tokens,
          consume: true,
        });
      },
    }),
    write_stdin: tool({
      description: "Write more input to a running exec_command session, or poll it by sending an empty string.",
      inputSchema: z.object({
        session_id: z.string().min(1),
        chars: z.string().optional(),
        yield_time_ms: z.number().int().positive().max(60_000).default(DEFAULT_TERMINAL_YIELD_TIME_MS),
        max_output_tokens: z.number().int().positive().max(MAX_OUTPUT_TOKENS).default(DEFAULT_MAX_OUTPUT_TOKENS),
      }),
      execute: async ({ session_id, chars, yield_time_ms, max_output_tokens }) => {
        if (chars && chars.length > 0) {
          await terminalRegistry.write({
            terminalId: session_id,
            input: chars,
          });
        }
        await waitForTerminalYield({
          terminalRegistry,
          sessionId: request.task.id,
          terminalId: session_id,
          yieldTimeMs: yield_time_ms,
        });
        return readTerminalResult({
          terminalRegistry,
          sessionId: request.task.id,
          terminalId: session_id,
          maxOutputTokens: max_output_tokens,
          consume: true,
        });
      },
    }),
    read_thread_terminal: tool({
      description: "Read recent output from the latest terminal session created during this task.",
      inputSchema: z.object({}),
      execute: async () => {
        const terminalId = terminalRegistry.latestTerminalId(request.task.id);
        if (!terminalId) {
          return {
            output: "",
            running: false,
            exit_code: null,
            signal: null,
            truncated: false,
            message: "No terminal session has been started for this task.",
          };
        }
        return readThreadTerminalResult({
          terminalRegistry,
          sessionId: request.task.id,
          terminalId,
          maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        });
      },
    }),
    apply_patch: tool({
      description: "Apply a structured patch using the same Begin/End Patch format that Codex uses for precise edits.",
      inputSchema: z.object({
        patch: z.string().min(1),
      }),
      execute: async ({ patch }) => {
        const result = await applyStructuredPatch({
          patch,
          resolvePath: (filePath) =>
            resolveAccessiblePath({
              filePath,
              projectWorkingDirectory,
              accessibleRoots,
            }),
        });
        return {
          changed_files: result.changedPaths,
          count: result.changedPaths.length,
        };
      },
    }),
    view_image: tool({
      description: "Inspect a local image file and return metadata such as dimensions and format. This is metadata-only; it does not perform semantic vision analysis.",
      inputSchema: z.object({
        path: z.string().min(1),
      }),
      execute: async ({ path: filePath }) => {
        const resolvedPath = resolveAccessiblePath({
          filePath,
          projectWorkingDirectory,
          accessibleRoots,
        });
        return inspectLocalImage(resolvedPath);
      },
    }),
  };
}
