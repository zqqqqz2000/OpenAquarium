import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  ChatMessage,
  OpenAICompatibleConversationState,
  OpenAICompatibleConversationSummary,
  ProjectRole,
  ProviderBinding,
  TeamMember,
  TeamMemberBlueprint,
  TeamTemplate,
  WorkspaceAccount,
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

function normalizeUserHandle(value: string): string {
  return value.trim().replace(/^[@>]+/u, "").toLowerCase();
}

function normalizeWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
): WorkspaceSnapshot {
  const legacyPlaceholderCommands = new Set(["clerk-acp", "research-acp"]);
  const defaultAccountId = "account_default";
  const nowMs = Date.now();

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

  const normalizedAccounts: Record<string, WorkspaceAccount> = (() => {
    const entries = Object.entries(snapshot.accounts ?? {}).filter(
      (
        entry,
      ): entry is [string, WorkspaceAccount] => !entry[1].archivedAt,
    );
    if (entries.length > 0) {
      return Object.fromEntries(entries);
    }

    return {
      [defaultAccountId]: {
        id: defaultAccountId,
        displayName: snapshot.currentUserName,
        handle: "user",
      },
    };
  })();

  const normalizedAccountOrder = dedupeIds(
    [
      ...(snapshot.accountOrder?.length ? snapshot.accountOrder : Object.keys(normalizedAccounts)),
      ...(normalizedAccounts[defaultAccountId] ? [defaultAccountId] : []),
    ],
  ).filter((accountId) => Boolean(normalizedAccounts[accountId]));

  const normalizedCurrentAccountId =
    (snapshot.currentAccountId && normalizedAccounts[snapshot.currentAccountId])
      ? snapshot.currentAccountId
      : (normalizedAccounts[defaultAccountId] ? defaultAccountId : normalizedAccountOrder[0]);

  const normalizedUsers = Object.fromEntries(
    Object.entries(snapshot.users ?? {}).flatMap(([userId, user]) => {
      if (user.archivedAt) {
        return [];
      }

      const handle = normalizeUserHandle(user.handle ?? "");
      const displayName = user.displayName?.trim() || handle || userId;
      const passwordSalt = user.passwordSalt?.trim() || "";
      const passwordHash = user.passwordHash?.trim() || "";
      const createdAt = user.createdAt?.trim() || "";

      if (!handle || !passwordSalt || !passwordHash || !createdAt) {
        return [];
      }

      return [[userId, {
        ...user,
        handle,
        displayName,
        isAdmin: user.isAdmin === true,
        passwordSalt,
        passwordHash,
        createdAt,
        updatedAt: user.updatedAt?.trim() || createdAt,
      }]];
    }),
  );

  const normalizedUserOrder = dedupeIds(
    [
      ...(snapshot.userOrder?.length ? snapshot.userOrder : Object.keys(normalizedUsers)),
    ],
  ).filter((userId) => Boolean(normalizedUsers[userId]));

  const normalizedAuthSessions = Object.fromEntries(
    Object.entries(snapshot.authSessions ?? {}).flatMap(([sessionId, session]) => {
      const tokenHash = session.tokenHash?.trim() || "";
      const createdAt = session.createdAt?.trim() || "";
      const expiresAt = session.expiresAt?.trim() || "";
      const lastSeenAt = session.lastSeenAt?.trim() || createdAt;
      const expiresAtMs = Date.parse(expiresAt);

      if (
        !normalizedUsers[session.userId]
        || !tokenHash
        || !createdAt
        || !Number.isFinite(expiresAtMs)
        || expiresAtMs <= nowMs
      ) {
        return [];
      }

      return [[sessionId, {
        ...session,
        tokenHash,
        createdAt,
        lastSeenAt,
        expiresAt,
      }]];
    }),
  );

  const normalizedAuthSessionOrder = dedupeIds(
    [
      ...(snapshot.authSessionOrder?.length ? snapshot.authSessionOrder : Object.keys(normalizedAuthSessions)),
    ],
  ).filter((sessionId) => Boolean(normalizedAuthSessions[sessionId]));

  const normalizedUserSetupTokens = Object.fromEntries(
    Object.entries(snapshot.userSetupTokens ?? {}).flatMap(([tokenId, token]) => {
      const tokenHash = token.tokenHash?.trim() || "";
      const createdAt = token.createdAt?.trim() || "";
      const expiresAt = token.expiresAt?.trim() || "";
      const expiresAtMs = Date.parse(expiresAt);

      if (
        token.usedAt
        || !normalizedUsers[token.userId]
        || !tokenHash
        || !createdAt
        || !Number.isFinite(expiresAtMs)
        || expiresAtMs <= nowMs
      ) {
        return [];
      }

      return [[tokenId, {
        ...token,
        tokenHash,
        createdAt,
        expiresAt,
        createdByUserId: normalizedUsers[token.createdByUserId ?? ""] ? token.createdByUserId : undefined,
        usedAt: undefined,
      }]];
    }),
  );

  const normalizedUserSetupTokenOrder = dedupeIds(
    [
      ...(snapshot.userSetupTokenOrder?.length ? snapshot.userSetupTokenOrder : Object.keys(normalizedUserSetupTokens)),
    ],
  ).filter((tokenId) => Boolean(normalizedUserSetupTokens[tokenId]));

  const normalizedProjectMemberships = Object.fromEntries(
    Object.entries(snapshot.projectMemberships ?? {}).flatMap(([membershipId, membership]) => {
      const createdAt = membership.createdAt?.trim() || "";

      if (
        membership.archivedAt
        || !createdAt
        || !snapshot.projects[membership.projectId]
        || !normalizedUsers[membership.userId]
      ) {
        return [];
      }

      const role: ProjectRole =
        membership.role === "owner" || membership.role === "admin"
          ? membership.role
          : "member";

      return [[membershipId, {
        ...membership,
        role,
        createdAt,
        updatedAt: membership.updatedAt?.trim() || createdAt,
      }]];
    }),
  );

  const normalizedHumans = Object.fromEntries(
    Object.entries(snapshot.humans ?? {}).flatMap(([humanId, human]) => {
      if (!snapshot.rooms[human.roomId]) {
        return [];
      }

      const fallbackAccountId = normalizedCurrentAccountId ?? normalizedAccountOrder[0];
      if (!fallbackAccountId) {
        return [];
      }

      return [[humanId, {
        ...human,
        accountId: human.accountId ?? fallbackAccountId,
      }]];
    }),
  );

  const normalizedHumanOrderByRoom = Object.fromEntries(
    Object.keys(snapshot.rooms).map((roomId) => {
      const humanIdsFromSnapshot = snapshot.humanOrderByRoom?.[roomId] ?? [];
      const humanIdsFromHumans = Object.entries(normalizedHumans)
        .filter(([, human]) => human.roomId === roomId)
        .map(([humanId]) => humanId);

      return [
        roomId,
        dedupeIds([...humanIdsFromSnapshot, ...humanIdsFromHumans])
          .filter((humanId) => normalizedHumans[humanId]?.roomId === roomId),
      ];
    }),
  );

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
    accounts: normalizedAccounts,
    accountOrder: normalizedAccountOrder,
    users: normalizedUsers,
    userOrder: normalizedUserOrder,
    authSessions: normalizedAuthSessions,
    authSessionOrder: normalizedAuthSessionOrder,
    userSetupTokens: normalizedUserSetupTokens,
    userSetupTokenOrder: normalizedUserSetupTokenOrder,
    projectMemberships: normalizedProjectMemberships,
    humans: normalizedHumans,
    humanOrderByRoom: normalizedHumanOrderByRoom,
    messages: normalizedMessages,
    messageOrderByRoom: normalizedMessageOrderByRoom,
    currentAccountId: normalizedCurrentAccountId,
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
    accounts: normalizedAccounts,
    accountOrder: normalizedAccountOrder,
    users: normalizedUsers,
    userOrder: normalizedUserOrder,
    authSessions: normalizedAuthSessions,
    authSessionOrder: normalizedAuthSessionOrder,
    userSetupTokens: normalizedUserSetupTokens,
    userSetupTokenOrder: normalizedUserSetupTokenOrder,
    projectMemberships: normalizedProjectMemberships,
    humans: normalizedHumans,
    humanOrderByRoom: normalizedHumanOrderByRoom,
    messages: normalizedMessages,
    messageOrderByRoom: normalizedMessageOrderByRoom,
    watchers: normalizedWatchers,
    taskTraces: snapshot.taskTraces ?? {},
    taskTraceOrderByTask: snapshot.taskTraceOrderByTask ?? {},
    currentAccountId: normalizedCurrentAccountId,
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
    this.pendingWrite = this.pendingWrite.then(async () => {
      const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
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
