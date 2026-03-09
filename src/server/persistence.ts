import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ProviderBinding, TeamMember, TeamMemberBlueprint, TeamTemplate, WorkspaceSnapshot } from "../domain/model";
import { getErrorCode } from "./error-utils";
import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND, createCodexAcpProvider } from "../lib/acp";

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
      };
    }

    if (provider.command !== "codex-acp") {
      return provider;
    }

    return {
      ...provider,
      command: CODEX_ACP_NPX_COMMAND,
      args: [...CODEX_ACP_NPX_ARGS, ...normalizeCodexArgs(provider.args)],
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
        watcher.lastConsumedMessageId && roomMessageIds.includes(watcher.lastConsumedMessageId)
          ? watcher.lastConsumedMessageId
          : undefined;

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
    messageOrderByRoom: normalizedMessageOrderByRoom,
    watchers: normalizedWatchers,
    taskTraces: snapshot.taskTraces ?? {},
    taskTraceOrderByTask: snapshot.taskTraceOrderByTask ?? {},
  };
}

export class WorkspacePersistence {
  private readonly filePath: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<WorkspaceSnapshot | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      return normalizeWorkspaceSnapshot(parsed.snapshot);
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const directory = path.dirname(this.filePath);
    const payload = JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        snapshot,
      } satisfies PersistedWorkspaceState,
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;

    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(tempPath, payload, "utf8");
      await rename(tempPath, this.filePath);
    });

    await this.pendingWrite;
  }
}
