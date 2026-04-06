import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import type { ExecutionRequest } from "@/server/executor";
import { createWorkspaceTools } from "@/server/member-workspace-tools";
import { TerminalRegistry } from "@/server/terminal-registry";

function getToolExecutor<TInput, TResult>(toolDefinition: unknown): (input: TInput) => Promise<TResult> {
  const maybeTool = toolDefinition as {
    execute?: (input: TInput, options?: unknown) => Promise<TResult>;
  };
  if (!maybeTool.execute) {
    throw new Error("Expected tool to expose an execute function");
  }
  return (input: TInput) => maybeTool.execute!(input, undefined);
}

function createRequest(projectPath: string): ExecutionRequest {
  return {
    project: {
      id: "project_1",
      name: "Project",
      path: projectPath,
      createdAt: "2026-03-19T00:00:00.000Z",
    },
    room: {
      id: "room_1",
      projectId: "project_1",
      name: "Room",
      topic: "Topic",
      templateId: "template_1",
      memberIds: ["member_1"],
      watcherIds: [],
      entryMemberId: "member_1",
      createdAt: "2026-03-19T00:00:00.000Z",
    },
    member: {
      id: "member_1",
      roomId: "room_1",
      blueprintId: "blueprint_1",
      roleId: "blueprint_1",
      roleName: "lead",
      name: "Lead",
      handle: "lead",
      summary: "Lead member",
      prompt: "Handle the room",
      accentTone: "paper",
      allowedSkillIds: [],
      provider: {
        kind: "codex-acp",
        label: "Codex ACP",
        command: "codex",
        args: [],
        env: {},
        capabilities: ["prompt", "cancel"],
      },
      acceptsDirectMessages: true,
      isEntryMember: true,
      status: "idle",
    },
    task: {
      id: "task_1",
      roomId: "room_1",
      memberId: "member_1",
      sourceMessageId: "message_1",
      title: "Respond",
      status: "running",
      startedAt: "2026-03-19T00:00:00.000Z",
      updatedAt: "2026-03-19T00:00:00.000Z",
    },
    snapshot: {
      projects: {},
      projectOrder: [],
      rooms: {},
      roomOrderByProject: {},
      templates: {},
      templateOrder: [],
      members: {},
      messages: {},
      messageOrderByRoom: {},
      tasks: {},
      taskTraces: {},
      taskTraceOrderByTask: {},
      watchers: {},
      selection: {},
      currentUserName: "You",
    },
    prompt: "prompt",
  };
}

function createHost() {
  return {
    sendGroupMessage: () => Promise.resolve(),
    sendDirectMessage: () => Promise.resolve(),
    addRoleEmployee: () => Promise.resolve({ ok: true, notices: [] }),
    removeRoleEmployee: () => Promise.resolve({ ok: true, notices: [] }),
    renameRoleEmployee: () => Promise.resolve({ ok: true, notices: [] }),
    runWatcher: () => Promise.resolve(),
    inspectRoomState: () => Promise.resolve("state"),
  };
}

function buildNodeCommand(script: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}

describe("member workspace tools", () => {
  it("supports exec_command and write_stdin interactive sessions", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-member-tools-terminal-"));
    const tools = createWorkspaceTools({
      request: createRequest(workspaceRoot),
      host: createHost(),
      projectWorkingDirectory: workspaceRoot,
      accessibleRoots: [workspaceRoot],
      terminalRegistry: new TerminalRegistry(),
    });
    const execCommand = getToolExecutor<{
      cmd: string;
      shell?: string;
      login?: boolean;
      yield_time_ms: number;
      max_output_tokens: number;
    }, {
      session_id: string;
      running: boolean;
      output: string;
    }>(tools.exec_command);
    const writeStdin = getToolExecutor<{
      session_id: string;
      chars: string;
      yield_time_ms: number;
      max_output_tokens: number;
    }, {
      running: boolean;
      output: string;
    }>(tools.write_stdin);

    const initial = await execCommand({
      cmd: buildNodeCommand("process.stdin.setEncoding('utf8'); process.stdin.resume(); process.stdout.write('ready\\n'); process.stdin.once('data', (chunk) => { process.stdout.write('echo:' + chunk); process.exit(0); });"),
      shell: "/bin/zsh",
      login: false,
      yield_time_ms: 100,
      max_output_tokens: 400,
    });

    expect(initial.running).toBe(true);

    const afterInput = await writeStdin({
      session_id: initial.session_id,
      chars: "ping\n",
      yield_time_ms: 100,
      max_output_tokens: 400,
    });
    const finalState = afterInput.running
      ? await writeStdin({
          session_id: initial.session_id,
          chars: "",
          yield_time_ms: 200,
          max_output_tokens: 400,
        })
      : afterInput;

    expect(finalState.running).toBe(false);
    expect(`${afterInput.output}${finalState.output}`).toContain("echo:ping");
  });

  it("reads the latest terminal output with read_thread_terminal", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-member-tools-read-terminal-"));
    const tools = createWorkspaceTools({
      request: createRequest(workspaceRoot),
      host: createHost(),
      projectWorkingDirectory: workspaceRoot,
      accessibleRoots: [workspaceRoot],
      terminalRegistry: new TerminalRegistry(),
    });
    const execCommand = getToolExecutor<{
      cmd: string;
      shell?: string;
      login?: boolean;
      yield_time_ms: number;
      max_output_tokens: number;
    }, {
      session_id: string;
    }>(tools.exec_command);
    const readThreadTerminal = getToolExecutor<Record<string, never>, {
      output: string;
    }>(tools.read_thread_terminal);

    await execCommand({
      cmd: buildNodeCommand("setTimeout(() => process.stdout.write('later\\n'), 80); setTimeout(() => process.exit(0), 220);"),
      shell: "/bin/zsh",
      login: false,
      yield_time_ms: 10,
      max_output_tokens: 400,
    });
    await sleep(160);

    const output = await readThreadTerminal({});
    expect(output.output).toContain("later");
  });

  it("waits briefly for delayed terminal output when read_thread_terminal is called immediately", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-member-tools-read-terminal-immediate-"));
    const tools = createWorkspaceTools({
      request: createRequest(workspaceRoot),
      host: createHost(),
      projectWorkingDirectory: workspaceRoot,
      accessibleRoots: [workspaceRoot],
      terminalRegistry: new TerminalRegistry(),
    });
    const execCommand = getToolExecutor<{
      cmd: string;
      shell?: string;
      login?: boolean;
      yield_time_ms: number;
      max_output_tokens: number;
    }, {
      session_id: string;
    }>(tools.exec_command);
    const readThreadTerminal = getToolExecutor<Record<string, never>, {
      output: string;
      running: boolean;
    }>(tools.read_thread_terminal);

    await execCommand({
      cmd: buildNodeCommand("setTimeout(() => process.stdout.write('later-now\\n'), 60); setTimeout(() => process.exit(0), 220);"),
      shell: "/bin/zsh",
      login: false,
      yield_time_ms: 10,
      max_output_tokens: 400,
    });

    const output = await readThreadTerminal({});
    expect(output.running).toBe(true);
    expect(output.output).toContain("later-now");
  });

  it("applies structured patches inside the workspace root", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-member-tools-patch-"));
    const filePath = path.join(workspaceRoot, "notes.txt");
    await writeFile(filePath, "alpha\nbeta\ngamma\n", "utf8");
    const tools = createWorkspaceTools({
      request: createRequest(workspaceRoot),
      host: createHost(),
      projectWorkingDirectory: workspaceRoot,
      accessibleRoots: [workspaceRoot],
      terminalRegistry: new TerminalRegistry(),
    });
    const applyPatch = getToolExecutor<{
      patch: string;
    }, {
      count: number;
    }>(tools.apply_patch);

    await applyPatch({
      patch: [
        "*** Begin Patch",
        "*** Update File: notes.txt",
        "@@",
        " alpha",
        "-beta",
        "+delta",
        " gamma",
        "*** End Patch",
      ].join("\n"),
    });

    expect(await readFile(filePath, "utf8")).toBe("alpha\ndelta\ngamma\n");
  });

  it("returns local image metadata via view_image", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-member-tools-image-"));
    const imagePath = path.join(workspaceRoot, "pixel.png");
    await writeFile(
      imagePath,
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9kAAAAASUVORK5CYII=", "base64"),
    );
    const tools = createWorkspaceTools({
      request: createRequest(workspaceRoot),
      host: createHost(),
      projectWorkingDirectory: workspaceRoot,
      accessibleRoots: [workspaceRoot],
      terminalRegistry: new TerminalRegistry(),
    });
    const viewImage = getToolExecutor<{
      path: string;
    }, {
      format?: string;
      width?: number;
      height?: number;
      note: string;
    }>(tools.view_image);

    const metadata = await viewImage({
      path: imagePath,
    });

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1);
    expect(metadata.height).toBe(1);
    expect(metadata.note).toContain("Metadata only");
  });
});
