export type ProjectId = string;
export type RoomId = string;
export type TemplateId = string;
export type MemberId = string;
export type MessageId = string;
export type TaskId = string;
export type WatcherId = string;
export type TraceId = string;
export type ProviderModelProfileId = string;

export type ProviderKind = "codex-acp" | "generic-acp";
export type MemberStatus = "idle" | "running" | "interrupted";
export type TaskStatus = "running" | "interrupted" | "completed";
export type MessageTransport = "group" | "direct" | "watch-digest" | "status";
export type MessageStatus = "sent" | "streaming" | "completed" | "interrupted";
export type MessageVisibility = "public" | "internal";
export type AccentTone = "paper" | "postit" | "blueprint" | "correction";
export type TaskTraceKind = "task-started" | "task-prompt" | "draft" | "status" | "completed" | "error" | "interrupted";
export type CodexThinkingDepth = "low" | "mid" | "high" | "extra-high";

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  command: string;
}

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

export interface ProviderModelProfile {
  id: ProviderModelProfileId;
  name: string;
  description: string;
  providerType: "acp";
  binding: ProviderBinding;
}

export interface WatchBlueprint {
  intervalMinutes: number;
  enabledByDefault: boolean;
  persistent?: boolean;
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
  skills: SkillDefinition[];
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
  skills: SkillDefinition[];
  provider: ProviderBinding;
  acceptsDirectMessages: boolean;
  isEntryMember: boolean;
  codexThinkingDepth?: CodexThinkingDepth;
  status: MemberStatus;
  providerSessionId?: string;
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
  pausedUntilActivity?: boolean;
  lastConsumedMessageId?: MessageId;
  lastConsumedStateAt?: string;
}

export interface ChatAuthor {
  kind: "user" | "member" | "system";
  id: string;
  label: string;
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
  quotedMemberIds?: MemberId[];
  recipientMemberIds: MemberId[];
  recipientUser?: boolean;
  taskId?: TaskId;
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

export interface WorkspaceSnapshot {
  projects: Record<ProjectId, Project>;
  projectOrder: ProjectId[];
  rooms: Record<RoomId, Room>;
  roomOrderByProject: Record<ProjectId, RoomId[]>;
  templates: Record<TemplateId, TeamTemplate>;
  templateOrder: TemplateId[];
  members: Record<MemberId, TeamMember>;
  messages: Record<MessageId, ChatMessage>;
  messageOrderByRoom: Record<RoomId, MessageId[]>;
  tasks: Record<TaskId, MemberTask>;
  taskTraces: Record<TraceId, TaskTraceEntry>;
  taskTraceOrderByTask: Record<TaskId, TraceId[]>;
  watchers: Record<WatcherId, WatchSubscription>;
  selection: WorkspaceSelection;
  currentUserName: string;
}

export interface CreateProjectInput {
  projectName: string;
  templateId: TemplateId;
  path?: string;
}

export interface CreateRoomInput {
  projectId: ProjectId;
  templateId: TemplateId;
}

export interface PostUserMessageInput {
  roomId: RoomId;
  content: string;
  mentionedMemberIds?: MemberId[];
  quotedMemberIds?: MemberId[];
  directMemberId?: MemberId;
}

export interface PostMemberMessageInput {
  roomId: RoomId;
  memberId: MemberId;
  content: string;
  mentionedMemberIds?: MemberId[];
  quotedMemberIds?: MemberId[];
  directMemberId?: MemberId;
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
  skills: SkillDefinition[];
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
  skills: SkillDefinition[];
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
  providerType: "acp";
  providerKind: ProviderKind;
  providerLabel: string;
  selectedProfileId: ProviderModelProfileId;
  availableModels: TemplateStudioModelOption[];
  currentModelId?: string;
  unavailableMessage?: string;
}

export interface UpsertWatcherInput {
  memberId: MemberId;
  enabled: boolean;
  intervalMinutes: number;
  persistent?: boolean;
}
