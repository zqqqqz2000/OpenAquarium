import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceSnapshot } from "@/domain/model";

type DiagnosticValue = string | number | boolean | null;
type EnvMap = Record<string, string | undefined>;

export interface DiagnosticsLogger {
  info(event: string, fields?: Record<string, DiagnosticValue>): void;
  warn(event: string, fields?: Record<string, DiagnosticValue>): void;
  error(event: string, fields?: Record<string, DiagnosticValue>): void;
  shouldLog(key: string, intervalMs: number): boolean;
}

function noop(): void {
  return undefined;
}

function buildConsoleMethod(level: "info" | "warn" | "error"): (message?: unknown, ...optionalParams: unknown[]) => void {
  switch (level) {
    case "warn":
      return console.warn.bind(console);
    case "error":
      return console.error.bind(console);
    default:
      return console.log.bind(console);
  }
}

export function summarizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Record<string, DiagnosticValue> {
  return {
    projects: Object.keys(snapshot.projects).length,
    rooms: Object.keys(snapshot.rooms).length,
    members: Object.keys(snapshot.members).length,
    messages: Object.keys(snapshot.messages).length,
    tasks: Object.keys(snapshot.tasks).length,
    runningTasks: Object.values(snapshot.tasks).filter((task) => task.status === "running").length,
    traces: Object.keys(snapshot.taskTraces).length,
    watchers: Object.keys(snapshot.watchers).length,
    selectedRoomId: snapshot.selection.roomId ?? null,
  };
}

class NoopDiagnosticsLogger implements DiagnosticsLogger {
  info(): void {
    noop();
  }

  warn(): void {
    noop();
  }

  error(): void {
    noop();
  }

  shouldLog(): boolean {
    return false;
  }
}

class FileDiagnosticsLogger implements DiagnosticsLogger {
  private readonly filePath: string;
  private readonly consoleEnabled: boolean;
  private pendingWrite: Promise<void> = Promise.resolve();
  private readonly lastLogByKey = new Map<string, number>();

  constructor(args: { workspaceRoot: string; filePath?: string; consoleEnabled: boolean }) {
    this.filePath = args.filePath ?? path.join(args.workspaceRoot, ".openaquarium", "logs", "runtime.log");
    this.consoleEnabled = args.consoleEnabled;
  }

  info(event: string, fields: Record<string, DiagnosticValue> = {}): void {
    this.write("info", event, fields);
  }

  warn(event: string, fields: Record<string, DiagnosticValue> = {}): void {
    this.write("warn", event, fields);
  }

  error(event: string, fields: Record<string, DiagnosticValue> = {}): void {
    this.write("error", event, fields);
  }

  shouldLog(key: string, intervalMs: number): boolean {
    const now = Date.now();
    const lastLoggedAt = this.lastLogByKey.get(key) ?? 0;

    if (now - lastLoggedAt < intervalMs) {
      return false;
    }

    this.lastLogByKey.set(key, now);
    return true;
  }

  private write(level: "info" | "warn" | "error", event: string, fields: Record<string, DiagnosticValue>): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...fields,
    };
    const line = `${JSON.stringify(entry)}\n`;

    if (this.consoleEnabled) {
      buildConsoleMethod(level)(`[oa:${event}]`, fields);
    }

    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await appendFile(this.filePath, line, "utf8");
      })
      .catch((error: unknown) => {
        console.error("[oa:diagnostics-write-failed]", error);
      });
  }
}

export function createDiagnosticsLogger(args: {
  workspaceRoot: string;
  env?: EnvMap;
}): DiagnosticsLogger {
  const env = args.env ?? process.env;
  const explicitlyEnabled = env.OA_DIAGNOSTICS_ENABLED === "1";
  const runningTests = env.NODE_ENV === "test" || env.VITEST === "true";

  if (!explicitlyEnabled && runningTests) {
    return new NoopDiagnosticsLogger();
  }

  return new FileDiagnosticsLogger({
    workspaceRoot: args.workspaceRoot,
    filePath: env.OA_DIAGNOSTICS_LOG_FILE,
    consoleEnabled: env.OA_DIAGNOSTICS_CONSOLE !== "0",
  });
}
