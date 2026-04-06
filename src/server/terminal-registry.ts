import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { randomUUID } from "node:crypto";

import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from "@agentclientprotocol/sdk";

import { resolveCommandPath } from "./acp-session";

interface TerminalEntry {
  process: ChildProcessByStdio<Writable, Readable, Readable>;
  sessionId: string;
  output: string;
  unreadOutput: string;
  outputByteLimit: number;
  truncated: boolean;
  unreadTruncated: boolean;
  waitForExit: Promise<WaitForTerminalExitResponse>;
}

function clampOutput(output: string, byteLimit: number): { output: string; truncated: boolean } {
  const buffer = Buffer.from(output, "utf8");
  if (buffer.byteLength <= byteLimit) {
    return { output, truncated: false };
  }

  const truncatedBuffer = buffer.subarray(buffer.byteLength - byteLimit);
  return {
    output: truncatedBuffer.toString("utf8"),
    truncated: true,
  };
}

export class TerminalRegistry {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly terminalIdsBySession = new Map<string, string[]>();

  unreadOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const entry = this.require(params.terminalId);
    const exitStatus = entry.process.exitCode === null && entry.process.signalCode === null
      ? undefined
      : {
          exitCode: entry.process.exitCode ?? undefined,
          signal: entry.process.signalCode ?? undefined,
        };

    return Promise.resolve({
      output: entry.unreadOutput,
      truncated: entry.unreadTruncated,
      exitStatus,
    });
  }

  create(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = randomUUID();
    const cwd = params.cwd ?? process.cwd();
    const env = {
      ...process.env,
      ...Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value])),
    };
    const resolvedCommand = resolveCommandPath(params.command, cwd, env);
    if (!resolvedCommand) {
      throw new Error(`Command "${params.command}" is not available from "${cwd}"`);
    }

    const child = spawn(resolvedCommand, params.args ?? [], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let resolveWait: (result: WaitForTerminalExitResponse) => void = () => undefined;
    const waitForExit = new Promise<WaitForTerminalExitResponse>((resolve) => {
      resolveWait = resolve;
    });
    const outputByteLimit = params.outputByteLimit ?? 96_000;
    const entry: TerminalEntry = {
      process: child,
      sessionId: params.sessionId,
      output: "",
      unreadOutput: "",
      outputByteLimit,
      truncated: false,
      unreadTruncated: false,
      waitForExit,
    };
    const append = (chunk: Buffer): void => {
      const next = clampOutput(`${entry.output}${chunk.toString("utf8")}`, entry.outputByteLimit);
      entry.output = next.output;
      entry.truncated ||= next.truncated;
      const nextUnread = clampOutput(`${entry.unreadOutput}${chunk.toString("utf8")}`, entry.outputByteLimit);
      entry.unreadOutput = nextUnread.output;
      entry.unreadTruncated ||= nextUnread.truncated;
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("exit", (code, signal) => {
      resolveWait({
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
      });
    });
    this.entries.set(terminalId, entry);
    const terminalIds = this.terminalIdsBySession.get(params.sessionId) ?? [];
    terminalIds.push(terminalId);
    this.terminalIdsBySession.set(params.sessionId, terminalIds);

    return Promise.resolve({ terminalId });
  }

  output(params: TerminalOutputRequest & { consume?: boolean }): Promise<TerminalOutputResponse> {
    const entry = this.require(params.terminalId);
    const exitStatus = entry.process.exitCode === null && entry.process.signalCode === null
      ? undefined
      : {
          exitCode: entry.process.exitCode ?? undefined,
          signal: entry.process.signalCode ?? undefined,
        };

    const output = params.consume ? entry.unreadOutput : entry.output;
    const truncated = params.consume ? entry.unreadTruncated : entry.truncated;
    if (params.consume) {
      entry.unreadOutput = "";
      entry.unreadTruncated = false;
    }

    return Promise.resolve({
      output,
      truncated,
      exitStatus,
    });
  }

  async wait(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    const entry = this.require(params.terminalId);
    return entry.waitForExit;
  }

  kill(params: KillTerminalRequest): Promise<KillTerminalResponse> {
    const entry = this.require(params.terminalId);
    entry.process.kill("SIGTERM");
    return Promise.resolve({});
  }

  write(params: { terminalId: string; input: string }): Promise<void> {
    const entry = this.require(params.terminalId);
    if (entry.process.exitCode !== null || entry.process.signalCode !== null) {
      throw new Error(`Terminal "${params.terminalId}" has already exited`);
    }

    return new Promise((resolve, reject) => {
      entry.process.stdin.write(params.input, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  latestTerminalId(sessionId: string): string | undefined {
    const terminalIds = this.terminalIdsBySession.get(sessionId);
    return terminalIds?.[terminalIds.length - 1];
  }

  release(params: ReleaseTerminalRequest): Promise<void> {
    const entry = this.require(params.terminalId);
    if (entry.process.exitCode === null && entry.process.signalCode === null) {
      entry.process.kill("SIGTERM");
    }
    this.entries.delete(params.terminalId);
    const terminalIds = this.terminalIdsBySession.get(entry.sessionId);
    if (terminalIds) {
      const nextTerminalIds = terminalIds.filter((terminalId) => terminalId !== params.terminalId);
      if (nextTerminalIds.length > 0) {
        this.terminalIdsBySession.set(entry.sessionId, nextTerminalIds);
      } else {
        this.terminalIdsBySession.delete(entry.sessionId);
      }
    }
    return Promise.resolve();
  }

  async disposeAll(): Promise<void> {
    await Promise.all(
      [...this.entries.keys()].map((terminalId) => this.release({ sessionId: "dispose", terminalId })),
    );
  }

  private require(terminalId: string): TerminalEntry {
    const entry = this.entries.get(terminalId);
    if (!entry) {
      throw new Error(`Unknown terminal "${terminalId}"`);
    }
    return entry;
  }
}
