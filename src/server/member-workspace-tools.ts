import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { tool } from "ai";
import * as z from "zod";

import type { Project, RoomId } from "../domain/model";
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
  };
}
