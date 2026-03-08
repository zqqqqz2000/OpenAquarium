import * as acp from "@agentclientprotocol/sdk";
import { spawn, type ChildProcessByStdio } from "node:child_process";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import type { TeamMember } from "../domain/model";
import type { ExecutionRequest, ExecutorCallbacks, MemberExecutor } from "./executor";
import { buildClientCapabilities, buildClientConnection, isCommandAvailable, resolveMockAcpCommand } from "./acp-session";
import { AcpWorkspaceClient } from "./acp-workspace-client";
import { getErrorCode, getErrorMessage } from "./error-utils";
import { TerminalRegistry } from "./terminal-registry";

function resolveSpawnCommand(member: TeamMember): { command: string; args: string[] } {
  if (member.provider.command.trim().length > 0) {
    return {
      command: member.provider.command,
      args: member.provider.args,
    };
  }

  return {
    command: process.execPath,
    args: ["./src/server/mock-acp-agent.ts"],
  };
}

export class AcpMemberExecutor implements MemberExecutor {
  private readonly workspaceRoot: string;
  private readonly member: TeamMember;
  private readonly bridge: AcpWorkspaceClient;
  private readonly terminalRegistry = new TerminalRegistry();
  private child?: ChildProcessByStdio<Writable, Readable, null>;
  private connection?: acp.ClientSideConnection;
  private sessionId?: string;
  private currentTurn?: Promise<void>;
  private currentTaskId?: string;

  constructor(args: { workspaceRoot: string; member: TeamMember }) {
    this.workspaceRoot = args.workspaceRoot;
    this.member = args.member;
    this.bridge = new AcpWorkspaceClient({
      workspaceRoot: this.workspaceRoot,
      terminalRegistry: this.terminalRegistry,
    });
  }

  async execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void> {
    await this.cancel();
    const connection = await this.ensureConnection();
    const activeTaskId = request.task.id;
    let finalContent = "";
    this.currentTaskId = activeTaskId;
    this.bridge.setCallbacks({
      onDraft: async (chunk) => {
        finalContent = `${finalContent}${chunk}`;
        await callbacks.onDraft(finalContent);
      },
      onStatus: callbacks.onStatus,
    });

    const runTurn = async (): Promise<void> => {
      try {
        const response = await connection.prompt({
          sessionId: this.sessionId!,
          prompt: [
            {
              type: "text",
              text: request.prompt,
            },
          ],
        });

        if (response.stopReason === "cancelled") {
          return;
        }

        await callbacks.onComplete(finalContent, response.stopReason);
      } catch (error) {
        await callbacks.onError(getErrorMessage(error));
      } finally {
        this.bridge.clearCallbacks();
        if (this.currentTaskId === activeTaskId) {
          this.currentTaskId = undefined;
          this.currentTurn = undefined;
        }
      }
    };

    this.currentTurn = runTurn();
    await this.currentTurn;
  }

  async cancel(): Promise<void> {
    if (!this.currentTurn || !this.connection || !this.sessionId) {
      return;
    }

    try {
      await this.connection.cancel({
        sessionId: this.sessionId,
      });
      await this.currentTurn;
    } catch {
      // Let the next execute attempt recreate the connection if needed.
    }
  }

  async dispose(): Promise<void> {
    await this.cancel();
    await this.terminalRegistry.disposeAll();
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.connection = undefined;
    this.sessionId = undefined;
  }

  private async ensureConnection(): Promise<acp.ClientSideConnection> {
    if (this.connection && this.sessionId) {
      return this.connection;
    }

    const primary = resolveSpawnCommand(this.member);
    const sessionCwd = this.member.provider.workingDirectory ?? this.workspaceRoot;
    const primaryEnv = {
      ...process.env,
      ...this.member.provider.env,
    };

    const launch = await this.connectWithFallback({
      primary,
      primaryCwd: sessionCwd,
      primaryEnv,
      fallback: resolveMockAcpCommand(),
    });
    this.connection = launch.connection;
    this.child = launch.child;
    const session = await this.connection.newSession({
      cwd: sessionCwd,
      mcpServers: [],
    });
    this.sessionId = session.sessionId;

    return this.connection;
  }

  private async connectWithFallback(args: {
    primary: { command: string; args: string[] };
    primaryCwd: string;
    primaryEnv: Record<string, string | undefined>;
    fallback: { command: string; args: string[] };
  }): Promise<{ child: ChildProcessByStdio<Writable, Readable, null>; connection: acp.ClientSideConnection }> {
    if (!isCommandAvailable(args.primary.command, args.primaryCwd, args.primaryEnv)) {
      return this.launchConnection({
        command: args.fallback.command,
        args: args.fallback.args,
        cwd: this.workspaceRoot,
        env: process.env,
      });
    }

    try {
      return await this.launchConnection({
        command: args.primary.command,
        args: args.primary.args,
        cwd: args.primaryCwd,
        env: args.primaryEnv,
      });
    } catch (error) {
      if (!this.shouldUseFallback(error)) {
        throw error;
      }

      return this.launchConnection({
        command: args.fallback.command,
        args: args.fallback.args,
        cwd: this.workspaceRoot,
        env: process.env,
      });
    }
  }

  private shouldUseFallback(error: unknown): boolean {
    if (getErrorCode(error) === "ENOENT") {
      return true;
    }

    if (this.member.provider.command.trim().length === 0) {
      return false;
    }

    if (!this.member.provider.command.includes(path.sep) && !this.member.provider.command.startsWith(".")) {
      return false;
    }

    return !isCommandAvailable(this.member.provider.command, this.workspaceRoot, process.env);
  }

  private async launchConnection(args: {
    command: string;
    args: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  }): Promise<{ child: ChildProcessByStdio<Writable, Readable, null>; connection: acp.ClientSideConnection }> {
    let child: ChildProcessByStdio<Writable, Readable, null> | undefined;

    try {
      child = spawn(args.command, args.args, {
        cwd: args.cwd,
        env: args.env,
        stdio: ["pipe", "pipe", "inherit"],
      });
      const connection = buildClientConnection(this.bridge, child);
      await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: {
          name: "OpenAquarium",
          version: "0.1.0",
        },
        clientCapabilities: buildClientCapabilities(),
      });
      return {
        child,
        connection,
      };
    } catch (error) {
      child?.kill("SIGTERM");
      throw error;
    }
  }
}
