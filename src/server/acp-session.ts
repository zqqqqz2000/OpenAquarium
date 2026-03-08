import * as acp from "@agentclientprotocol/sdk";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { readableToWebStream, writableToWebStream } from "./stdio-web-stream";

export function resolveMockAcpCommand(): { command: string; args: string[] } {
  if (process.argv[0]?.includes("bun") || process.execPath.includes("bun")) {
    return {
      command: process.execPath,
      args: ["./src/server/mock-acp-agent.ts"],
    };
  }

  return {
    command: "bun",
    args: ["./src/server/mock-acp-agent.ts"],
  };
}

export function isCommandAvailable(command: string, cwd: string, env: Record<string, string | undefined>): boolean {
  if (command.trim().length === 0) {
    return false;
  }

  if (command.includes(path.sep) || command.startsWith(".")) {
    const candidate = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return existsSync(candidate);
  }

  const pathEntries = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return pathEntries.some((entry) => existsSync(path.join(entry, command)));
}

export function buildClientCapabilities(): NonNullable<acp.InitializeRequest["clientCapabilities"]> {
  return {
    fs: {
      readTextFile: true,
      writeTextFile: true,
    },
    terminal: true,
  };
}

export function buildClientConnection(
  client: acp.Client,
  child: ChildProcessByStdio<Writable, Readable, null>,
): acp.ClientSideConnection {
  return new acp.ClientSideConnection(
    () => client,
    acp.ndJsonStream(writableToWebStream(child.stdin), readableToWebStream(child.stdout)),
  );
}
