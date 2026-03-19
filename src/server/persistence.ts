import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChatMessage,
  OpenAICompatibleConversationState,
  OpenAICompatibleConversationSummary,
  ProviderBinding,
  TeamMember,
  TeamMemberBlueprint,
  TeamTemplate,
  WorkspaceSnapshot,
} from "../domain/model";
import { modelMessageSchema } from "ai";
import { getErrorCode, type RuntimeError } from "./error-utils";
import {
  CODEX_ACP_NPX_ARGS,
  CODEX_ACP_NPX_COMMAND,
  CODEX_ACP_PACKAGE_NAME,
  createCodexAcpProvider,
  isCodexAcpPackageSpec,
  mergeCodexAcpEnv,
} from "../lib/acp";
import {
  countUnreadRoomMemberMessages,
  resolveTemplateVisibleMemberBlueprintIds,
} from "../lib/room-message-preferences";
import { resolveRoomTeamSummary } from "../lib/room-team";
import type { DiagnosticsLogger } from "./diagnostics";
import { summarizeWorkspaceSnapshot } from "./diagnostics";
import { normalizeWatcherCursorState } from "./watcher-cursor-normalization";
import { compactWorkspaceSnapshot } from "./workspace-snapshot-compact";

interface PersistedWorkspaceState {
  savedAt: string;
  snapshot: WorkspaceSnapshot;
}

function dedupeIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function normalizeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const legacyPlaceholderCommands = new Set(["clerk-acp", "research-acp"]);

  const isOpenAICompatibleConversationSummary = (
    value: OpenAICompatibleConversationState["summary"],
  ): value is OpenAICompatibleConversationSummary => (
    Boolean(value)
    && typeof value?.compactedAt === "string"
    && typeof value?.sourceMessageCount === "number"
    && typeof value?.tailMessageCount === "number"
    && typeof value?.modelId === "string"
  );

  const normalizeOpenAICompatibleConversation = (
    conversation: TeamMember["openAICompatibleConversation"],
  ): TeamMember["openAICompatibleConversation"] => {
    if (!conversation || !Array.isArray(conversation.messages)) {
      return undefined;
    }

    const messages = conversation.messages.flatMap((message) => {
      const parsed = modelMessageSchema.safeParse(message);
      return parsed.success ? [parsed.data] : [];
    });
    const summary = isOpenAICompatibleConversationSummary(conversation.summary)
      ? conversation.summary
      : undefined;

    if (messages.length === 0 && !summary) {
      return undefined;
    }

    return {
      messages,
      summary,
    };
  };

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

    if (
      provider.command === CODEX_ACP_NPX_COMMAND &&
      isCodexAcpPackageSpec(provider.args[0])
    ) {
      return {
        ...provider,
        args: [
          provider.args[0] === CODEX_ACP_PACKAGE_NAME
            ? CODEX_ACP_NPX_ARGS[0]
            : provider.args[0],
          ...normalizeCodexArgs(provider.args.slice(1)),
        ],
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
    members: template.members.map(
      (member): TeamMemberBlueprint => ({
        ...member,
        modelProfileId: member.modelProfileId,
        modelId: member.modelId,
        allowedSkillIds: member.allowedSkillIds ?? [],
        provider: normalizeProvider(member.provider),
      }),
    ),
  });

  const normalizeMember = (member: TeamMember): TeamMember => ({
    ...member,
    modelProfileId: member.modelProfileId,
    modelId: member.modelId,
    allowedSkillIds: member.allowedSkillIds ?? [],
    provider: normalizeProvider(member.provider),
    providerSessionId: member.providerSessionId,
    openAICompatibleConversation: normalizeOpenAICompatibleConversation(
      member.openAICompatibleConversation,
    ),
  });

  const normalizeMessage = (message: ChatMessage): ChatMessage => ({
    ...message,
    visibility:
      message.transport === "watch-digest"
        ? "internal"
        : (message.visibility ??
          (message.author.kind === "member" && message.taskId
            ? "internal"
            : "public")),
    quotedMemberIds: message.quotedMemberIds ?? [],
  });

  const normalizedMessageOrderByRoom = Object.fromEntries(
    Object.entries(snapshot.messageOrderByRoom).map(([roomId, messageIds]) => [
      roomId,
      dedupeIds(messageIds).filter(
        (messageId) => snapshot.messages[messageId]?.roomId === roomId,
      ),
    ]),
  );

  const normalizedWatchers = Object.fromEntries(
    Object.entries(snapshot.watchers).map(([watcherId, watcher]) => {
      const roomMessageIds = normalizedMessageOrderByRoom[watcher.roomId] ?? [];

      return [
        watcherId,
        normalizeWatcherCursorState(watcher, roomMessageIds, snapshot.messages),
      ];
    }),
  );

  const normalizedTemplates = Object.fromEntries(
    Object.entries(snapshot.templates).map(([templateId, template]) => [
      templateId,
      normalizeTemplate(template),
    ]),
  );
  const normalizedMembers = Object.fromEntries(
    Object.entries(snapshot.members).map(([memberId, member]) => [
      memberId,
      normalizeMember(member),
    ]),
  );
  const normalizedMessages = Object.fromEntries(
    Object.entries(snapshot.messages).map(([messageId, message]) => [
      messageId,
      normalizeMessage(message),
    ]),
  );
  const normalizedSnapshot = {
    ...snapshot,
    templates: normalizedTemplates,
    members: normalizedMembers,
    messages: normalizedMessages,
    messageOrderByRoom: normalizedMessageOrderByRoom,
  } satisfies WorkspaceSnapshot;
  const normalizedRooms = Object.fromEntries(
    Object.entries(snapshot.rooms).map(([roomId, room]) => [
      roomId,
      (() => {
        const legacyRoom = room as typeof room & {
          memberMessageFilter?: "all" | "only-members" | "hide-members";
        };
        const templateVisibleBlueprintIds = new Set(
          resolveTemplateVisibleMemberBlueprintIds(
            normalizedTemplates[room.templateId],
          ),
        );
        const resolvedRoom = {
          ...room,
          updatedAt: room.updatedAt ?? room.createdAt,
          visibleMemberIds:
            room.visibleMemberIds ??
            (legacyRoom.memberMessageFilter === "hide-members"
              ? []
              : room.memberIds.filter((memberId) => {
                  const member = normalizedMembers[memberId];
                  return member
                    ? templateVisibleBlueprintIds.has(member.blueprintId)
                    : false;
                })),
        };
        const latestSeenMemberMessageAt =
          (normalizedMessageOrderByRoom[roomId] ?? [])
            .map((messageId) => normalizedMessages[messageId])
            .filter((message): message is ChatMessage => Boolean(message))
            .filter(
              (message) =>
                message.author.kind === "member" &&
                message.transport !== "direct" &&
                message.visibility !== "internal",
            )
            .sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            )[0]?.createdAt ?? resolvedRoom.createdAt;
        const roomWithReadState = {
          ...resolvedRoom,
          teamName: resolveRoomTeamSummary(normalizedSnapshot, room).name,
          teamDescription: resolveRoomTeamSummary(normalizedSnapshot, room)
            .description,
          teamAccentTone: resolveRoomTeamSummary(normalizedSnapshot, room)
            .accentTone,
          lastReadMemberMessageAt:
            resolvedRoom.lastReadMemberMessageAt ?? latestSeenMemberMessageAt,
        };

        return {
          ...roomWithReadState,
          unreadMemberMessageCount: countUnreadRoomMemberMessages(
            {
              ...normalizedSnapshot,
              rooms: {
                ...snapshot.rooms,
                [roomId]: roomWithReadState,
              },
              messages: normalizedMessages,
              messageOrderByRoom: normalizedMessageOrderByRoom,
            },
            roomWithReadState,
            normalizedTemplates[room.templateId],
          ),
        };
      })(),
    ]),
  );

  return {
    ...snapshot,
    projects: Object.fromEntries(
      Object.entries(snapshot.projects).map(([projectId, project]) => [
        projectId,
        {
          ...project,
          updatedAt: project.updatedAt ?? project.createdAt,
        },
      ]),
    ),
    rooms: normalizedRooms,
    templates: normalizedTemplates,
    members: normalizedMembers,
    messages: normalizedMessages,
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
      const normalized = compactWorkspaceSnapshot(
        normalizeWorkspaceSnapshot(parsed.snapshot),
      );
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
