import type { ModelMessage } from "@ai-sdk/provider-utils";

import type { JsonValue } from "@/lib/json";

export type ProjectId = string;
export type RoomId = string;
export type TemplateId = string;
export type MemberId = string;
export type HumanParticipantId = string;
export type MessageId = string;
export type TaskId = string;
export type WatcherId = string;
export type TraceId = string;
export type ProviderModelProfileId = string;
export type AccountId = string;
export type UserId = string;
export type AuthSessionId = string;
export type UserSetupTokenId = string;
export type ProjectMembershipId = string;
export type ProjectRole = "owner" | "admin" | "member";

export type ProviderKind = "codex-acp" | "generic-acp";
export type ProviderProfileType = "acp" | "openai-compatible";
export type ProviderProfileKind = ProviderKind | "openai-compatible";
export type ProviderTextFormat = "kv" | "json";
export type MemberStatus = "idle" | "running" | "interrupted";
export type TaskStatus = "running" | "interrupted" | "completed";
export type MessageTransport = "group" | "direct" | "watch-digest" | "status";
export type MessageStatus = "sent" | "streaming" | "completed" | "interrupted";
export type MessageVisibility = "public" | "internal";
export type AccentTone = "paper" | "postit" | "blueprint" | "correction";
export type TaskTraceKind = "task-started" | "task-prompt" | "draft" | "status" | "completed" | "error" | "interrupted";
export type CodexThinkingDepth = "low" | "mid" | "high" | "extra-high";
export type RoomActorKind = "human" | "bot" | "system";
export type ChatAuthorKind = RoomActorKind | "user" | "member";

export interface TemplateStudioChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderBinding {
  kind: ProviderKind;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  workingDirectory?: string;
  capabilities: string[];
}

export interface OpenAICompatibleProviderBinding {
  kind: "openai-compatible";
  label: string;
  baseURL: string;
  apiKeyEnvVar?: string;
  headersFormat: ProviderTextFormat;
  headers: Record<string, string>;
  extraBodyFormat: ProviderTextFormat;
  extraBody: { [key: string]: JsonValue };
  mcpServers: OpenAICompatibleMCPServer[];
  modelLimits?: Record<string, OpenAICompatibleModelLimit>;
  compactionModelId?: string;
  compactionReservedTokens?: number;
  compactionOffloadThresholdChars?: number;
}

export interface OpenAICompatibleModelLimit {
  context: number;
  input?: number;
  output?: number;
}

export interface OpenAICompatibleStdioMCPServer {
  id: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

export interface OpenAICompatibleRemoteMCPServer {
  id: string;
  transport: "http" | "sse";
  url: string;
  headersFormat: ProviderTextFormat;
  headers: Record<string, string>;
}

export type OpenAICompatibleMCPServer =
  | OpenAICompatibleStdioMCPServer
  | OpenAICompatibleRemoteMCPServer;

export interface OpenAICompatibleConversationSummary {
  compactedAt: string;
  sourceMessageCount: number;
  tailMessageCount: number;
  modelId: string;
}

export interface OpenAICompatibleConversationState {
  messages: ModelMessage[];
  summary?: OpenAICompatibleConversationSummary;
}

export interface ACPProviderModelProfile {
  id: ProviderModelProfileId;
  name: string;
  description: string;
  providerType: "acp";
  binding: ProviderBinding;
}

export interface OpenAICompatibleProviderModelProfile {
  id: ProviderModelProfileId;
  name: string;
  description: string;
  providerType: "openai-compatible";
  binding: OpenAICompatibleProviderBinding;
}

export type ProviderModelProfile =
  | ACPProviderModelProfile
  | OpenAICompatibleProviderModelProfile;

export interface WatchBlueprint {
  intervalMinutes: number;
  enabledByDefault: boolean;
  persistent?: boolean;
  prompt?: string;
}

export interface TeamMemberBlueprint {
  id: string;
  name: string;
  handle: string;
  isRole?: boolean;
  summary: string;
  prompt: string;
  accentTone: AccentTone;
  modelProfileId?: ProviderModelProfileId;
  modelId?: string;
  allowedSkillIds: string[];
  provider: ProviderBinding;
  isEntryMember?: boolean;
  acceptsDirectMessages?: boolean;
  codexThinkingDepth?: CodexThinkingDepth;
  watch?: WatchBlueprint;
}

export interface TeamTemplate {
  id: TemplateId;
  name: string;
  description: string;
  accentTone: AccentTone;
  defaultVisibleMemberBlueprintIds?: string[];
  members: TeamMemberBlueprint[];
}

export interface Project {
  id: ProjectId;
  name: string;
  path?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Room {
  id: RoomId;
  projectId: ProjectId;
  name: string;
  topic: string;
  templateId: TemplateId;
  teamName?: string;
  teamDescription?: string;
  teamAccentTone?: AccentTone;
  memberIds: MemberId[];
  watcherIds: WatcherId[];
  watchersSuspended?: boolean;
  entryMemberId: MemberId;
  createdAt: string;
  updatedAt?: string;
  visibleMemberIds?: MemberId[];
  lastReadMemberMessageAt?: string;
  unreadMemberMessageCount?: number;
}

export interface TeamMember {
  id: MemberId;
  roomId: RoomId;
  blueprintId: string;
  roleId: string;
  roleName: string;
  name: string;
  handle: string;
  isRole?: boolean;
  summary: string;
  note?: string;
  prompt: string;
  accentTone: AccentTone;
  modelProfileId?: ProviderModelProfileId;
  modelId?: string;
  allowedSkillIds: string[];
  provider: ProviderBinding;
  acceptsDirectMessages: boolean;
  isEntryMember: boolean;
  codexThinkingDepth?: CodexThinkingDepth;
  status: MemberStatus;
  providerSessionId?: string;
  openAICompatibleConversation?: OpenAICompatibleConversationState;
  activeTaskId?: TaskId;
  archivedAt?: string;
}

export interface WatchSubscription {
  id: WatcherId;
  roomId: RoomId;
  memberId: MemberId;
  intervalMinutes: number;
  enabled: boolean;
  persistent?: boolean;
  prompt?: string;
  pausedUntilActivity?: boolean;
  lastConsumedMessageId?: MessageId;
  lastConsumedStateAt?: string;
  pendingDigestMessageId?: MessageId;
  pendingConsumedMessageId?: MessageId;
  pendingConsumedStateAt?: string;
}

export interface RoomHumanParticipant {
  id: HumanParticipantId;
  roomId: RoomId;
  displayName: string;
  handle: string;
  kind: "human";
  accountId?: AccountId;
  archivedAt?: string;
}

export interface RoomBotActor {
  id: MemberId;
  roomId: RoomId;
  displayName: string;
  handle: string;
  kind: "bot";
  memberId: MemberId;
  archivedAt?: string;
}

export interface RoomSystemActor {
  id: string;
  roomId: RoomId;
  displayName: string;
  kind: "system";
  archivedAt?: string;
}

export type RoomActor = RoomHumanParticipant | RoomBotActor | RoomSystemActor;

interface BaseChatAuthor {
  kind: ChatAuthorKind;
  id: string;
  label: string;
  handle?: string;
}

export interface ChatAuthor extends BaseChatAuthor {
  actorKind?: RoomActorKind;
  humanId?: HumanParticipantId;
  memberId?: MemberId;
  accountId?: AccountId;
}

export interface HumanChatAuthor extends ChatAuthor {
  kind: "human";
  actorKind?: "human";
  humanId: HumanParticipantId;
}

export interface LegacyUserChatAuthor extends ChatAuthor {
  kind: "user";
  actorKind?: "human";
  humanId?: HumanParticipantId;
}

export interface BotChatAuthor extends ChatAuthor {
  kind: "bot";
  actorKind?: "bot";
  memberId: MemberId;
}

export interface LegacyMemberChatAuthor extends ChatAuthor {
  kind: "member";
  actorKind?: "bot";
  memberId?: MemberId;
}

export interface SystemChatAuthor extends ChatAuthor {
  kind: "system";
  actorKind?: "system";
}

export interface ChatMessage {
  id: MessageId;
  roomId: RoomId;
  author: ChatAuthor;
  content: string;
  createdAt: string;
  transport: MessageTransport;
  status: MessageStatus;
  visibility?: MessageVisibility;
  mentionedMemberIds: MemberId[];
  mentionedHumanIds?: HumanParticipantId[];
  quotedMemberIds?: MemberId[];
  recipientMemberIds: MemberId[];
  recipientHumanIds?: HumanParticipantId[];
  recipientUser?: boolean;
  taskId?: TaskId;
}

export interface RoomMessageHistoryPage {
  roomId: RoomId;
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: MessageId;
}

export interface MemberTask {
  id: TaskId;
  roomId: RoomId;
  memberId: MemberId;
  sourceMessageId: MessageId;
  title: string;
  status: TaskStatus;
  startedAt: string;
  updatedAt: string;
  interruptedByMessageId?: MessageId;
  draftMessageId?: MessageId;
}

export interface TaskTraceEntry {
  id: TraceId;
  taskId: TaskId;
  roomId: RoomId;
  memberId: MemberId;
  kind: TaskTraceKind;
  title: string;
  content: string;
  createdAt: string;
}

export interface WorkspaceSelection {
  projectId?: ProjectId;
  roomId?: RoomId;
  memberId?: MemberId;
}

export interface WorkspaceAccount {
  id: AccountId;
  displayName: string;
  handle?: string;
  archivedAt?: string;
}

export interface User {
  id: UserId;
  handle: string;
  displayName: string;
  isAdmin?: boolean;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
}

export interface AuthSession {
  id: AuthSessionId;
  userId: UserId;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface UserSetupToken {
  id: UserSetupTokenId;
  userId: UserId;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  createdByUserId?: UserId;
  usedAt?: string;
}

export interface ProjectMembership {
  id: ProjectMembershipId;
  projectId: ProjectId;
  userId: UserId;
  role: ProjectRole;
  createdAt: string;
  updatedAt?: string;
  archivedAt?: string;
}

export interface WorkspaceSnapshot {
  projects: Record<ProjectId, Project>;
  projectOrder: ProjectId[];
  rooms: Record<RoomId, Room>;
  roomOrderByProject: Record<ProjectId, RoomId[]>;
  templates: Record<TemplateId, TeamTemplate>;
  templateOrder: TemplateId[];
  members: Record<MemberId, TeamMember>;
  humans?: Record<HumanParticipantId, RoomHumanParticipant>;
  humanOrderByRoom?: Record<RoomId, HumanParticipantId[]>;
  messages: Record<MessageId, ChatMessage>;
  messageOrderByRoom: Record<RoomId, MessageId[]>;
  tasks: Record<TaskId, MemberTask>;
  taskTraces: Record<TraceId, TaskTraceEntry>;
  taskTraceOrderByTask: Record<TaskId, TraceId[]>;
  watchers: Record<WatcherId, WatchSubscription>;
  accounts?: Record<AccountId, WorkspaceAccount>;
  accountOrder?: AccountId[];
  users?: Record<UserId, User>;
  userOrder?: UserId[];
  authSessions?: Record<AuthSessionId, AuthSession>;
  authSessionOrder?: AuthSessionId[];
  userSetupTokens?: Record<UserSetupTokenId, UserSetupToken>;
  userSetupTokenOrder?: UserSetupTokenId[];
  projectMemberships?: Record<ProjectMembershipId, ProjectMembership>;
  selection: WorkspaceSelection;
  currentUserName: string;
  currentAccountId?: AccountId;
}

export interface LoginInput {
  handle: string;
  password: string;
  displayName?: string;
}

export interface UpdateMeInput {
  handle?: string;
  displayName?: string;
}

export interface UpsertWorkspaceAccountInput {
  displayName: string;
  handle?: string;
  roomId?: RoomId;
  activate?: boolean;
}

export interface SetActiveAccountInput {
  accountId: AccountId;
  roomId?: RoomId;
}

export interface CreateProjectInput {
  projectName: string;
  templateId?: TemplateId;
  path?: string;
}

export interface CreateRoomInput {
  projectId: ProjectId;
  templateId: TemplateId;
}

export interface PostUserMessageInput {
  roomId: RoomId;
  content: string;
  authorHumanId?: HumanParticipantId;
  mentionedMemberIds?: MemberId[];
  mentionedHumanIds?: HumanParticipantId[];
  quotedMemberIds?: MemberId[];
  directMemberId?: MemberId;
  directHumanId?: HumanParticipantId;
}

export interface PostMemberMessageInput {
  roomId: RoomId;
  memberId: MemberId;
  content: string;
  mentionedMemberIds?: MemberId[];
  mentionedHumanIds?: HumanParticipantId[];
  quotedMemberIds?: MemberId[];
  directMemberId?: MemberId;
  directHumanId?: HumanParticipantId;
  directToUser?: boolean;
  taskId?: TaskId;
}

export interface PostMemberDraftInput {
  taskId: TaskId;
  content: string;
}

export interface CompleteTaskInput {
  taskId: TaskId;
  finalContent?: string;
  publishResult?: boolean;
}

export interface UpdateMemberConfigInput {
  memberId: MemberId;
  isRole?: boolean;
  summary: string;
  prompt: string;
  modelProfileId?: ProviderModelProfileId;
  modelId?: string;
  acceptsDirectMessages: boolean;
  codexThinkingDepth?: CodexThinkingDepth;
  allowedSkillIds: string[];
  provider: ProviderBinding;
}

export interface UpdateTemplateInput {
  templateId: TemplateId;
  name: string;
  description: string;
  accentTone: AccentTone;
  defaultVisibleMemberBlueprintIds?: string[];
  members: TeamMemberBlueprint[];
}

export interface RoomWatcherConfig {
  enabled: boolean;
  intervalMinutes: number;
  persistent?: boolean;
  prompt?: string;
}

export interface RoomTeamMemberInput {
  memberId: string;
  roleId?: string;
  roleName?: string;
  isRole?: boolean;
  name: string;
  handle: string;
  summary: string;
  note?: string;
  prompt: string;
  accentTone: AccentTone;
  modelProfileId?: ProviderModelProfileId;
  modelId?: string;
  allowedSkillIds: string[];
  provider: ProviderBinding;
  isEntryMember?: boolean;
  acceptsDirectMessages?: boolean;
  codexThinkingDepth?: CodexThinkingDepth;
  watch?: RoomWatcherConfig;
}

export interface UpdateRoomTeamInput {
  roomId: RoomId;
  teamName: string;
  teamDescription: string;
  teamAccentTone: AccentTone;
  members: RoomTeamMemberInput[];
}

export interface UpdateRoomSettingsInput {
  roomId: RoomId;
  visibleMemberIds: MemberId[];
}

export interface UpdateGlobalConfigInput {
  modelProfiles: ProviderModelProfile[];
  templateChatModelProfileId?: ProviderModelProfileId;
}

export interface GlobalWorkspaceConfig {
  directory: string;
  modelProfiles: ProviderModelProfile[];
  templateChatModelProfileId?: ProviderModelProfileId;
}

export interface TemplateStudioModelOption {
  id: string;
  label: string;
  description?: string;
  profileId?: ProviderModelProfileId;
}

export interface TemplateStudioModelCatalog {
  source: "runtime" | "unavailable";
  providerType: ProviderProfileType;
  providerKind: ProviderProfileKind;
  providerLabel: string;
  selectedProfileId: ProviderModelProfileId;
  availableModels: TemplateStudioModelOption[];
  currentModelId?: string;
  unavailableMessage?: string;
}

export interface ProviderConnectionTestResult {
  profileId: ProviderModelProfileId;
  providerType: ProviderProfileType;
  providerKind: ProviderProfileKind;
  providerLabel: string;
  modelId?: string;
  prompt: string;
  responseText: string;
  toolCount: number;
  testedAt: string;
}

export interface UpsertWatcherInput {
  memberId: MemberId;
  enabled: boolean;
  intervalMinutes: number;
  persistent?: boolean;
  prompt?: string;
}
