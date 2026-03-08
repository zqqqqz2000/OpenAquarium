import type * as acp from "@agentclientprotocol/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TerminalRegistry } from "./terminal-registry";

export interface AcpClientCallbacks {
  onDraft?(chunk: string): Promise<void> | void;
  onStatus?(summary: string): Promise<void> | void;
}

function choosePermissionOutcome(params: acp.RequestPermissionRequest): acp.RequestPermissionResponse {
  const allowOption =
    params.options.find((option) => option.kind === "allow_once") ??
    params.options.find((option) => option.kind === "allow_always") ??
    params.options[0];

  if (!allowOption) {
    return {
      outcome: {
        outcome: "cancelled",
      },
    };
  }

  return {
    outcome: {
      outcome: "selected",
      optionId: allowOption.optionId,
    },
  };
}

function isInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class AcpWorkspaceClient implements acp.Client {
  private readonly workspaceRoot: string;
  private readonly terminalRegistry: TerminalRegistry;
  private callbacks?: AcpClientCallbacks;

  constructor(args: { workspaceRoot: string; terminalRegistry: TerminalRegistry }) {
    this.workspaceRoot = args.workspaceRoot;
    this.terminalRegistry = args.terminalRegistry;
  }

  setCallbacks(callbacks: AcpClientCallbacks): void {
    this.callbacks = callbacks;
  }

  clearCallbacks(): void {
    this.callbacks = undefined;
  }

  requestPermission(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    return Promise.resolve(choosePermissionOutcome(params));
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    if (!this.callbacks) {
      return;
    }

    const update = params.update;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text") {
          await this.callbacks.onDraft?.(update.content.text);
        }
        return;
      case "tool_call":
        await this.callbacks.onStatus?.(`${update.title} (${update.status ?? "pending"})`);
        return;
      case "tool_call_update":
        await this.callbacks.onStatus?.(`${update.title ?? update.toolCallId} -> ${update.status ?? "updated"}`);
        return;
      case "plan":
        await this.callbacks.onStatus?.(`Plan updated: ${update.entries.length} step(s)`);
        return;
      default:
        return;
    }
  }

  async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    const resolvedPath = path.resolve(params.path);
    this.assertAccessible(resolvedPath);
    const content = await readFile(resolvedPath, "utf8");
    const lines = content.split("\n");
    const startLine = Math.max((params.line ?? 1) - 1, 0);
    const selected = lines.slice(startLine, params.limit ? startLine + params.limit : undefined).join("\n");

    return {
      content: selected,
    };
  }

  async writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    const resolvedPath = path.resolve(params.path);
    this.assertAccessible(resolvedPath);
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, params.content, "utf8");
    return {};
  }

  createTerminal(params: acp.CreateTerminalRequest): Promise<acp.CreateTerminalResponse> {
    return this.terminalRegistry.create(params);
  }

  terminalOutput(params: acp.TerminalOutputRequest): Promise<acp.TerminalOutputResponse> {
    return this.terminalRegistry.output(params);
  }

  waitForTerminalExit(params: acp.WaitForTerminalExitRequest): Promise<acp.WaitForTerminalExitResponse> {
    return this.terminalRegistry.wait(params);
  }

  killTerminal(params: acp.KillTerminalRequest): Promise<acp.KillTerminalResponse> {
    return this.terminalRegistry.kill(params);
  }

  releaseTerminal(params: acp.ReleaseTerminalRequest): Promise<void> {
    return this.terminalRegistry.release(params);
  }

  private assertAccessible(targetPath: string): void {
    if (!isInsideRoot(this.workspaceRoot, targetPath)) {
      throw new Error(`Path "${targetPath}" is outside the workspace root`);
    }
  }
}
