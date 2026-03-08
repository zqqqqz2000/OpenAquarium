import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
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

interface TerminalEntry {
  process: ChildProcessByStdio<null, Readable, Readable>;
  output: string;
  outputByteLimit: number;
  truncated: boolean;
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

  create(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
    const terminalId = randomUUID();
    const child = spawn(params.command, params.args ?? [], {
      cwd: params.cwd ?? process.cwd(),
      env: {
        ...process.env,
        ...Object.fromEntries((params.env ?? []).map((entry) => [entry.name, entry.value])),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolveWait: (result: WaitForTerminalExitResponse) => void = () => undefined;
    const waitForExit = new Promise<WaitForTerminalExitResponse>((resolve) => {
      resolveWait = resolve;
    });
    const outputByteLimit = params.outputByteLimit ?? 96_000;
    const entry: TerminalEntry = {
      process: child,
      output: "",
      outputByteLimit,
      truncated: false,
      waitForExit,
    };
    const append = (chunk: Buffer): void => {
      const next = clampOutput(`${entry.output}${chunk.toString("utf8")}`, entry.outputByteLimit);
      entry.output = next.output;
      entry.truncated ||= next.truncated;
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

    return Promise.resolve({ terminalId });
  }

  output(params: TerminalOutputRequest): Promise<TerminalOutputResponse> {
    const entry = this.require(params.terminalId);
    const exitStatus = entry.process.exitCode === null && entry.process.signalCode === null
      ? undefined
      : {
          exitCode: entry.process.exitCode ?? undefined,
          signal: entry.process.signalCode ?? undefined,
        };

    return Promise.resolve({
      output: entry.output,
      truncated: entry.truncated,
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

  release(params: ReleaseTerminalRequest): Promise<void> {
    const entry = this.require(params.terminalId);
    if (entry.process.exitCode === null && entry.process.signalCode === null) {
      entry.process.kill("SIGTERM");
    }
    this.entries.delete(params.terminalId);
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
