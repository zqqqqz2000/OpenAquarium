import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatMessage, ProviderBinding, TeamMember, TeamMemberBlueprint, TeamTemplate, WorkspaceSnapshot } from "../domain/model";
import { getErrorCode, type RuntimeError } from "./error-utils";
import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND, createCodexAcpProvider, mergeCodexAcpEnv } from "../lib/acp";
import type { DiagnosticsLogger } from "./diagnostics";
import { summarizeWorkspaceSnapshot } from "./diagnostics";
import { compactWorkspaceSnapshot } from "./workspace-snapshot-compact";

interface PersistedWorkspaceState {
  savedAt: string;
  snapshot: WorkspaceSnapshot;
}

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function normalizeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const legacyPlaceholderCommands = new Set(["clerk-acp", "research-acp"]);

  const normalizeCodexArgs = (args: string[]): string[] => {
    const normalized: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--mode" && index + 1 < args.length) {
        index += 1;
        continue;
      }

      normalized.push(args[index]);
    }

    return normalized;
  };

  const normalizeProvider = (provider: ProviderBinding): ProviderBinding => {
    if (legacyPlaceholderCommands.has(provider.command)) {
      return {
        ...createCodexAcpProvider({
          env: provider.env,
          workingDirectory: provider.workingDirectory,
        }),
      };
    }

    if (provider.kind !== "codex-acp") {
      return provider;
    }

    if (provider.command === CODEX_ACP_NPX_COMMAND && provider.args[0] === CODEX_ACP_NPX_ARGS[0]) {
      return {
        ...provider,
        args: [CODEX_ACP_NPX_ARGS[0], ...normalizeCodexArgs(provider.args.slice(1))],
        env: mergeCodexAcpEnv(provider.env),
      };
    }

    if (provider.command !== "codex-acp") {
      return provider;
    }

    return {
      ...provider,
      command: CODEX_ACP_NPX_COMMAND,
      args: [...CODEX_ACP_NPX_ARGS, ...normalizeCodexArgs(provider.args)],
      env: mergeCodexAcpEnv(provider.env),
    };
  };

  const normalizeTemplate = (template: TeamTemplate): TeamTemplate => ({
    ...template,
    members: template.members.map((member): TeamMemberBlueprint => ({
      ...member,
      provider: normalizeProvider(member.provider),
    })),
  });

  const normalizeMember = (member: TeamMember): TeamMember => ({
    ...member,
    provider: normalizeProvider(member.provider),
  });

  const normalizeMessage = (message: ChatMessage): ChatMessage => ({
    ...message,
    visibility:
      message.visibility
      ?? (message.author.kind === "member" && message.taskId ? "internal" : "public"),
  });

  const normalizedMessageOrderByRoom = Object.fromEntries(
    Object.entries(snapshot.messageOrderByRoom).map(([roomId, messageIds]) => [
      roomId,
      dedupeIds(messageIds).filter((messageId) => snapshot.messages[messageId]?.roomId === roomId),
    ]),
  );

  const normalizedWatchers = Object.fromEntries(
    Object.entries(snapshot.watchers).map(([watcherId, watcher]) => {
      const roomMessageIds = normalizedMessageOrderByRoom[watcher.roomId] ?? [];
      const lastConsumedMessageId =
        watcher.lastConsumedMessageId === undefined
          ? undefined
          : roomMessageIds.includes(watcher.lastConsumedMessageId)
            ? watcher.lastConsumedMessageId
            : roomMessageIds[roomMessageIds.length - 1];

      return [
        watcherId,
        {
          ...watcher,
          lastConsumedMessageId,
        },
      ];
    }),
  );

  return {
    ...snapshot,
    templates: Object.fromEntries(
      Object.entries(snapshot.templates).map(([templateId, template]) => [templateId, normalizeTemplate(template)]),
    ),
    members: Object.fromEntries(
      Object.entries(snapshot.members).map(([memberId, member]) => [memberId, normalizeMember(member)]),
    ),
    messages: Object.fromEntries(
      Object.entries(snapshot.messages).map(([messageId, message]) => [messageId, normalizeMessage(message)]),
    ),
    messageOrderByRoom: normalizedMessageOrderByRoom,
    watchers: normalizedWatchers,
    taskTraces: snapshot.taskTraces ?? {},
    taskTraceOrderByTask: snapshot.taskTraceOrderByTask ?? {},
  };
}

export class WorkspacePersistence {
  private readonly filePath: string;
  private readonly logger?: DiagnosticsLogger;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(filePath: string, logger?: DiagnosticsLogger) {
    this.filePath = filePath;
    this.logger = logger;
  }

  async load(): Promise<WorkspaceSnapshot | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      const normalized = compactWorkspaceSnapshot(normalizeWorkspaceSnapshot(parsed.snapshot));
      this.logger?.info("state-loaded", {
        filePath: this.filePath,
        bytes: raw.length,
        ...summarizeWorkspaceSnapshot(normalized),
      });
      return normalized;
    } catch (error) {
      if (getErrorCode(error as RuntimeError) === "ENOENT") {
        this.logger?.info("state-missing", {
          filePath: this.filePath,
        });
        return undefined;
      }
      throw error;
    }
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const compactedSnapshot = compactWorkspaceSnapshot(snapshot);
    const directory = path.dirname(this.filePath);
    const payload = JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        snapshot: compactedSnapshot,
      } satisfies PersistedWorkspaceState,
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;

    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(tempPath, payload, "utf8");
      await rename(tempPath, this.filePath);
      this.logger?.info("state-saved", {
        filePath: this.filePath,
        bytes: payload.length,
        ...summarizeWorkspaceSnapshot(compactedSnapshot),
      });
    });

    await this.pendingWrite;
  }
}
