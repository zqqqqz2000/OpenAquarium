import type {
  ChatMessage,
  MemberTask,
  OpenAICompatibleProviderBinding,
  PersistedOpenAICompatibleMessage,
  Project,
  ProviderBinding,
  Room,
  TeamMember,
  WorkspaceSnapshot,
} from "../domain/model";
import { extractAddressedMemberIds } from "../domain/workspace";
import { resolveAvailableSkills } from "./skills";
import { isVisibleMemberRoomMessage } from "../lib/message-visibility";
import { formatTime } from "../lib/utils";
import type { ExecutionMember, ExecutionSessionContinuation } from "./executor";
import {
  getOpenAquariumScriptPath,
  quoteShellToken,
  resolveProjectWorkingDirectory,
} from "./project-paths";
import { getMemberHistoryFilePath, getRoomContextDirectoryPath, getRoomTranscriptFilePath } from "./room-transcript-files";
import { buildPersistedUserTurnMessage, formatConversationTrace } from "./openai-compatible-conversation";

const FULL_PROMPT_TRANSCRIPT_LIMIT = 14;
const DELTA_PROMPT_TRANSCRIPT_LIMIT = 6;
const PROJECT_TOPIC_PREVIEW_LIMIT = 600;
export const MEMBER_FULL_PROMPT_REFRESH_INTERVAL = 50;

type PromptMode = "full" | "delta";
type PromptMember = Omit<TeamMember, "provider"> & {
  provider: ProviderBinding | OpenAICompatibleProviderBinding;
};

export interface BuiltTaskPrompt {
  prompt: string;
  promptMode: PromptMode;
  promptTraceContent: string;
  messageHistory?: PersistedOpenAICompatibleMessage[];
}

function summarizeHandles(prefix: string, memberIds: string[], snapshot: WorkspaceSnapshot, marker = "@"): string {
  if (memberIds.length === 0) {
    return "";
  }

  return ` | ${prefix}: ${memberIds.map((memberId) => `${marker}${snapshot.members[memberId]?.handle ?? memberId}`).join(", ")}`;
}

function summarizeReferenceHandles(message: ChatMessage, snapshot: WorkspaceSnapshot): string {
  if ((message.quotedMemberIds?.length ?? 0) === 0) {
    return "";
  }

  return summarizeHandles("references", message.quotedMemberIds ?? [], snapshot);
}

function summarizeMessage(snapshot: WorkspaceSnapshot, message: ChatMessage): string {
  const recipientSuffix =
    message.recipientUser
      ? " | recipients: You"
      : summarizeHandles("recipients", message.recipientMemberIds, snapshot);

  return `[${formatTime(message.createdAt)}] ${message.author.label} (${message.transport}/${message.status}): ${message.content}${summarizeHandles("assignments", message.mentionedMemberIds, snapshot, "@>")}${summarizeReferenceHandles(message, snapshot)}${recipientSuffix}`;
}

function summarizeProjectTopic(topic: string): string {
  const normalized = topic.trim();
  if (normalized.length <= PROJECT_TOPIC_PREVIEW_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, PROJECT_TOPIC_PREVIEW_LIMIT)}… (truncated; read room transcript/context files for the full topic if needed)`;
}

function describeMember(member: TeamMember): string {
  return [
    `- @${member.handle}: ${member.summary}`,
    `  name: ${member.name}`,
    `  entry member: ${member.isEntryMember ? "true" : "false"}`,
  ].join("\n");
}

function buildAvailableSkillsSection(member: PromptMember, workspaceRoot: string): string[] {
  const availableSkills = resolveAvailableSkills(workspaceRoot, member.allowedSkillIds)
    .map((skill) => `- ${skill.id}\n  directory: ${skill.directoryPath}\n  entry: ${skill.entryPath}`)
    .join("\n");

  return [
    "[Available Skills]",
    availableSkills || "(none)",
  ];
}

function getVisibleRoomMessages(snapshot: WorkspaceSnapshot, room: Room): ChatMessage[] {
  return (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is ChatMessage => Boolean(message) && isVisibleMemberRoomMessage(message));
}

function getPromptVisibleRoomMessages(snapshot: WorkspaceSnapshot, room: Room, member: PromptMember): ChatMessage[] {
  return trimTrailingAuthoredMessages(getVisibleRoomMessages(snapshot, room), member.id);
}

function trimTrailingAuthoredMessages(messages: ChatMessage[], memberId: string): ChatMessage[] {
  let endIndex = messages.length;

  while (endIndex > 0) {
    const candidate = messages[endIndex - 1];
    if (candidate.author.kind !== "member" || candidate.author.id !== memberId) {
      break;
    }
    endIndex -= 1;
  }

  return endIndex === messages.length ? messages : messages.slice(0, endIndex);
}

function sortMemberTasks(snapshot: WorkspaceSnapshot, memberId: string): MemberTask[] {
  return Object.values(snapshot.tasks)
    .filter((task) => task.memberId === memberId)
    .sort((left, right) => {
      const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
      return startedAtOrder !== 0 ? startedAtOrder : left.id.localeCompare(right.id);
    });
}

function resolvePromptMode(args: {
  snapshot: WorkspaceSnapshot;
  member: PromptMember;
  task: MemberTask;
  retryAttempt?: number;
  sessionContinuation?: ExecutionSessionContinuation;
  openAICompatibleConversationContinuation?: ExecutionSessionContinuation;
}): {
  mode: PromptMode;
  turnsBeforeCurrent: number;
  previousTask?: MemberTask;
} {
  const {
    snapshot,
    member,
    task,
    sessionContinuation = member.providerSessionId ? "resumed" : "fresh",
    openAICompatibleConversationContinuation = member.openAICompatibleConversation ? "resumed" : "fresh",
  } = args;
  const memberTasks = sortMemberTasks(snapshot, member.id);
  const currentTaskIndex = memberTasks.findIndex((candidate) => candidate.id === task.id);
  const turnsBeforeCurrent = currentTaskIndex >= 0 ? currentTaskIndex : memberTasks.length;
  const previousTask = currentTaskIndex > 0 ? memberTasks[currentTaskIndex - 1] : undefined;
  if (member.provider.kind === "openai-compatible") {
    const needsFullPrompt =
      turnsBeforeCurrent === 0
      || turnsBeforeCurrent % MEMBER_FULL_PROMPT_REFRESH_INTERVAL === 0
      || openAICompatibleConversationContinuation === "fresh";
    return {
      mode: needsFullPrompt ? "full" : "delta",
      turnsBeforeCurrent,
      previousTask,
    };
  }
  const needsFullPrompt =
    turnsBeforeCurrent === 0
    || turnsBeforeCurrent % MEMBER_FULL_PROMPT_REFRESH_INTERVAL === 0
    || sessionContinuation === "fresh";

  return {
    mode: needsFullPrompt ? "full" : "delta",
    turnsBeforeCurrent,
    previousTask,
  };
}

function collectDeltaMessages(snapshot: WorkspaceSnapshot, room: Room, member: PromptMember, previousTask?: MemberTask): ChatMessage[] {
  const visibleMessages = getPromptVisibleRoomMessages(snapshot, room, member);

  if (!previousTask) {
    return visibleMessages.slice(-DELTA_PROMPT_TRANSCRIPT_LIMIT);
  }

  const deltaMessages = visibleMessages.filter((message) => message.createdAt > previousTask.updatedAt);
  if (deltaMessages.length > 0) {
    return deltaMessages.slice(-DELTA_PROMPT_TRANSCRIPT_LIMIT);
  }

  return [];
}

function formatTaskSourceMessage(sourceMessage: ChatMessage): string {
  if (sourceMessage.transport === "watch-digest") {
    return "(private watcher digest; see Watcher Context below)";
  }

  return sourceMessage.content;
}

function buildWatcherContextSections(sourceMessage: ChatMessage, watcherMode?: "persistent"): string[] {
  if (sourceMessage.transport !== "watch-digest") {
    return [];
  }

  return [
    "",
    "[Watcher Context]",
    watcherMode === "persistent"
      ? "This task was triggered by a private watcher digest while persistent watch is active. Periodic watcher turns can arrive even when there is no new room activity. If your current巡查/检查 is finished and there is nothing actionable, proactively pause your persistent watch. When the room gets new activity such as a new message or member state change, the persistent watch resumes automatically. The unseen room activity below was not posted into the room for others. Decide yourself whether any visible room reply is actually needed."
      : "This task was triggered by a private watcher digest. The unseen room activity below was not posted into the room for others. Decide yourself whether any visible room reply is actually needed.",
    sourceMessage.content,
  ];
}

function buildWatcherPromptSections(sourceMessage: ChatMessage, watcherPrompt?: string): string[] {
  if (sourceMessage.transport !== "watch-digest") {
    return [];
  }

  const normalizedWatcherPrompt = watcherPrompt?.trim();
  if (!normalizedWatcherPrompt) {
    return [];
  }

  return [
    "",
    "[Watcher Prompt]",
    normalizedWatcherPrompt,
  ];
}

function findEnabledPersistentWatcher(snapshot: WorkspaceSnapshot, room: Room, member: PromptMember) {
  return Object.values(snapshot.watchers).find(
    (watcher) => watcher.roomId === room.id && watcher.memberId === member.id && watcher.enabled && watcher.persistent,
  );
}

function buildRoomContextFileSections(workspaceRoot: string, room: Room, snapshot: WorkspaceSnapshot, transcriptFilePath?: string): string[] {
  const roomContextDirectoryPath = getRoomContextDirectoryPath(workspaceRoot, room);
  const resolvedTranscriptFilePath = transcriptFilePath ?? getRoomTranscriptFilePath(workspaceRoot, room);
  const memberHistoryCount = room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .filter((member): member is TeamMember => member !== undefined)
    .length;
  const exampleMember = room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .find((member): member is TeamMember => member !== undefined);
  const exampleMemberHistoryPath = exampleMember ? getMemberHistoryFilePath(workspaceRoot, room, exampleMember) : undefined;

  return [
    "[Shared Room Context]",
    `room context directory: ${roomContextDirectoryPath}`,
    `room transcript file: ${resolvedTranscriptFilePath}`,
    memberHistoryCount > 0
      ? `member history files: ${memberHistoryCount} file(s) under the room context directory${exampleMemberHistoryPath ? `, e.g. ${exampleMemberHistoryPath}` : ""}`
      : "member history files: (none)",
  ];
}

function buildMemberReferenceSyntaxSections(): string[] {
  return [
    "[Member Reference Syntax]",
    "@handle: passive reference only. Never use plain @handle to route work. Use it when explaining, citing, or comparing members for the user or team. It does not notify the member, does not route work, and does not start a task for them.",
    "@>handle: active routing. That member immediately receives the message as work and may be interrupted to act on it. Use @>handle only when you want that member to start working now.",
    "Active routing still works when `@>handle` appears inside backticks or fenced code blocks. Use normal message text when possible so the assignment stays easy to read.",
  ];
}

function buildRoleStaffingToolSections(): string[] {
  return [
    "[Role Staffing Tools]",
    "The workspace exposes structured staffing tools: `oa_role_add_employee`, `oa_role_remove_employee`, and `oa_role_rename_employee`.",
    "Use these tools directly for staffing changes. Do not send role-staffing instructions as room text.",
    "For `role`, use an existing role owner handle in this room, such as `builder` or `checker`, not a regular member like `research`.",
    "For `employeeHandle`, use a fresh new handle for the employee you are creating. Do not reuse an existing member handle.",
    "These tools return structured results. Only claim staffing succeeded when the tool result says `ok: true`.",
    "Whether you may actually use them is controlled by the specific member/template prompt, not by this shared prompt.",
    "Treat the staffing tools as authorized only when your member/template prompt explicitly grants them, for example with `允许使用岗位员工工具`.",
    "If your member/template prompt says `不允许使用岗位员工工具`, or does not explicitly grant them, do not use these tools.",
  ];
}

function buildRoleOwnersSection(room: Room, snapshot: WorkspaceSnapshot): string[] {
  const roleOwners = room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .filter((member): member is TeamMember => Boolean(member) && member.isRole === true && !member.archivedAt)
    .map((member) => `- @${member.handle}: role owner for ${member.roleName}`);

  return [
    "[Role Owners]",
    ...(roleOwners.length > 0 ? roleOwners : ["(none)"]),
  ];
}

function buildSharedSections(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: PromptMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  routingNote: string;
  promptMode: PromptMode;
  taskSequence: number;
  includeMemberPrompt: boolean;
}): string[] {
  const {
    workspaceRoot,
    project,
    room,
    member,
    task,
    snapshot,
    transcriptFilePath,
    routingNote,
    promptMode,
    taskSequence,
    includeMemberPrompt,
  } = args;
  const projectWorkingDirectory = resolveProjectWorkingDirectory(project, workspaceRoot);
  const roomSendScript = quoteShellToken(getOpenAquariumScriptPath(workspaceRoot, "oa-room-send"));
  const roomStateScript = quoteShellToken(getOpenAquariumScriptPath(workspaceRoot, "oa-room-state"));
  const roomWatchScript = quoteShellToken(getOpenAquariumScriptPath(workspaceRoot, "oa-room-watch"));
  const sourceMessage = snapshot.messages[task.sourceMessageId];
  const watcherPrompt =
    sourceMessage.transport === "watch-digest"
      ? Object.values(snapshot.watchers).find(
        (watcher) => watcher.memberId === member.id && watcher.roomId === room.id,
      )?.prompt
      : undefined;
  const preferredTools = [
    "oa_send_group_message: preferred for visible room replies.",
    "oa_send_direct_message: preferred for private teammate DMs and replies to @user.",
    "oa_role_add_employee / oa_role_remove_employee / oa_role_rename_employee: structured staffing tools; check the returned `ok` field before claiming success.",
    "oa_room_state: inspect transcript and member/task state before retrying a send.",
    "oa_read_file: read transcript files or source files when you need deeper context.",
    "oa_run_room_watcher: trigger a watcher immediately when needed.",
    `CLI pause fallback for persistent watch: ${roomWatchScript} --watcher <watcher-id> --pause-until-activity`,
    `CLI fallback examples if the dedicated tools are unavailable: ${roomSendScript} --room ${room.id} --member ${member.id} --scope group --text "your message" | ${roomSendScript} --room ${room.id} --member ${member.id} --scope direct --target @user --text "private message" | ${roomStateScript} --room ${room.id}`,
  ].join("\n");

  return [
    "You are an agent-team member inside OpenAquarium.",
    "",
    "[Turn Context]",
    `prompt mode: ${promptMode}`,
    `member turn: ${taskSequence}`,
    "",
    "[Member Configuration]",
    `name: ${member.name}`,
    `handle: @${member.handle}`,
    includeMemberPrompt
      ? `prompt: ${member.prompt}`
      : "prompt: omitted on this delta turn; reuse the persisted member/session instructions until the next full prompt refresh.",
    `summary: ${member.summary}`,
    `isEntryMember: ${member.isEntryMember ? "true" : "false"}`,
    `codexThinkingDepth: ${member.codexThinkingDepth ?? "default"}`,
    "",
    "[Project]",
    `project: ${project.name}`,
    `project path: ${project.path ?? "(default workspace root)"}`,
    `project working directory: ${projectWorkingDirectory}`,
    `OpenAquarium runtime root: ${workspaceRoot}`,
    `room: ${room.name}`,
    `topic: ${summarizeProjectTopic(room.topic)}`,
    "",
    ...buildRoomContextFileSections(workspaceRoot, room, snapshot, transcriptFilePath),
    "",
    ...buildMemberReferenceSyntaxSections(),
    "",
    ...buildRoleOwnersSection(room, snapshot),
    "",
    ...buildRoleStaffingToolSections(),
    "",
    "[Task]",
    `taskId: ${task.id}`,
    `status: ${task.status}`,
    `title: ${task.title}`,
    `source message: ${formatTaskSourceMessage(sourceMessage)}`,
    `source transport: ${sourceMessage.transport}`,
    `routing note: ${routingNote}`,
    ...buildWatcherContextSections(
      sourceMessage,
      sourceMessage.transport === "watch-digest" && Object.values(snapshot.watchers).some(
        (watcher) => watcher.memberId === member.id && watcher.roomId === room.id && watcher.persistent,
      )
        ? "persistent"
        : undefined,
    ),
    ...buildWatcherPromptSections(sourceMessage, watcherPrompt),
    "",
    "[Preferred Tools]",
    preferredTools,
  ].filter((value): value is string => value !== undefined);
}

function buildFullPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: PromptMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  routingNote: string;
  taskSequence: number;
  transcriptLimit?: number;
  transcriptLabel?: string;
}): string {
  const { room, snapshot, member } = args;
  const transcriptMessages = getPromptVisibleRoomMessages(snapshot, room, member);
  const visibleMessages =
    args.transcriptLimit === undefined
      ? transcriptMessages
      : transcriptMessages.slice(-args.transcriptLimit);
  const recentMessages = visibleMessages
    .map((message) => summarizeMessage(snapshot, message))
    .join("\n");
  const roster = room.memberIds.map((memberId) => describeMember(snapshot.members[memberId])).join("\n");
  const persistentWatcher = findEnabledPersistentWatcher(snapshot, room, member);
  const persistentWatchRules = persistentWatcher
    ? [
        "",
        "[Persistent Watch Rules]",
        "If you judge the current巡查/检查 work is finished and there is nothing actionable right now, proactively pause your persistent watch.",
        "When the room gets new activity such as a new message or member state change, your persistent watch resumes automatically.",
        `Pause command: oa-room-watch --watcher ${persistentWatcher.id} --pause-until-activity`,
      ]
    : [];

  return [
    ...buildSharedSections({
      ...args,
      promptMode: "full",
      includeMemberPrompt: true,
    }),
    "",
    "[Team Roster]",
    roster,
    "",
    args.transcriptLabel ?? "[Recent Room Transcript]",
    recentMessages || "(none)",
    "",
    "[Communication Rules]",
    "1. Prefer the dedicated ACP tools for room replies, DMs, watcher actions, and room-state checks.",
    "2. `@handle` is only a passive reference for explanation. Never use plain `@handle` to assign work. It does not notify that teammate, does not route work, and does not start a task for them.",
    "3. `@>handle` is an active assignment. That teammate immediately gets the message as work and may be interrupted to act on it, including inside backticks or fenced code blocks.",
    "4. Keep room messages concise and actionable, but do not stay silent on long tasks. Send an early visible progress update, then continue at meaningful milestones, blockers, or plan changes.",
    "5. Prefer group messages for user-facing progress updates; use direct messages only for private coordination or explicit one-to-one follow-up. Use @user when you need to reply privately to the human.",
    "6. Do not paste reasoning, tool narration, or step-by-step plans into room or DM messages, and do not resend the same room or DM content unless room state confirms it is missing.",
    "7. The final task completion text is private session output, not a room reply. Only text sent via the room/DM tools is user-visible.",
    "8. Treat the shared room context directory as the durable source for older room transcript and member history. Read the files when watcher context or the current transcript is insufficient. User-visible room and direct messages render as Markdown with code fences, Mermaid diagrams, math formulas, and CJK-friendly parsing. Prefer $$...$$ for formulas.",
    ...persistentWatchRules,
    "",
    ...buildAvailableSkillsSection(member, args.workspaceRoot),
    "",
    "[Instruction]",
    "Perform the current task. If a room or direct response is needed, actually send it using the tools. Keep the user and team updated with short progress messages while you work, and continue until the task is complete.",
  ].join("\n");
}

function buildCompactContextPathSections(args: {
  workspaceRoot: string;
  room: Room;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
}): string[] {
  return buildRoomContextFileSections(args.workspaceRoot, args.room, args.snapshot, args.transcriptFilePath);
}

function buildIncrementalPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: PromptMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  routingNote: string;
  taskSequence: number;
  previousTask?: MemberTask;
}): string {
  const { room, snapshot, previousTask } = args;
  const sourceMessage = snapshot.messages[args.task.sourceMessageId];
  const deltaMessages = collectDeltaMessages(snapshot, room, args.member, previousTask)
    .map((message) => summarizeMessage(snapshot, message))
    .join("\n");
  const watcherPrompt =
    sourceMessage.transport === "watch-digest"
      ? Object.values(snapshot.watchers).find(
        (watcher) => watcher.memberId === args.member.id && watcher.roomId === room.id,
      )?.prompt
      : undefined;

  return [
    "You are an agent-team member inside OpenAquarium.",
    "",
    "[Turn Context]",
    "prompt mode: delta",
    `member turn: ${args.taskSequence}`,
    "",
    "[Member Configuration]",
    `name: ${args.member.name}`,
    `handle: @${args.member.handle}`,
    `summary: ${args.member.summary}`,
    "",
    "[Task]",
    `taskId: ${args.task.id}`,
    `status: ${args.task.status}`,
    `title: ${args.task.title}`,
    `source message: ${formatTaskSourceMessage(sourceMessage)}`,
    `source transport: ${sourceMessage.transport}`,
    `routing note: ${args.routingNote}`,
    ...buildWatcherContextSections(
      sourceMessage,
      sourceMessage.transport === "watch-digest" && Object.values(snapshot.watchers).some(
        (watcher) => watcher.memberId === args.member.id && watcher.roomId === room.id && watcher.persistent,
      )
        ? "persistent"
        : undefined,
    ),
    ...buildWatcherPromptSections(sourceMessage, watcherPrompt),
    "",
    ...buildCompactContextPathSections(args),
    "",
    "[Relevant History]",
    previousTask
      ? `previous task: ${previousTask.id} (${previousTask.title}), updated at ${previousTask.updatedAt}`
      : "previous task: (none)",
    deltaMessages || "(none)",
    "",
    "[Instruction]",
    "Continue the current task using only the task state, watcher context, and relevant history above. If older context is needed, read the shared room context files instead of guessing.",
  ].join("\n");
}

export function buildTaskPromptPayload(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: ExecutionMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  retryAttempt?: number;
  sessionContinuation?: ExecutionSessionContinuation;
}): BuiltTaskPrompt {
  const { snapshot, room, member, task } = args;
  const sourceMessage = snapshot.messages[task.sourceMessageId];
  const addressedRoutingNote = extractAddressedMemberIds(snapshot, room.id, sourceMessage.content).length > 0
    ? "This source message used one or more active @>handles, so every targeted teammate was routed as a real assignment."
    : "This source message did not use any active @>handle, so it followed the normal fallback routing.";
  const openAICompatibleConversationContinuation: ExecutionSessionContinuation =
    member.provider.kind === "openai-compatible" && (member.openAICompatibleConversation?.messages.length ?? 0) > 0
      ? "resumed"
      : "fresh";
  const { mode, turnsBeforeCurrent, previousTask } = resolvePromptMode({
    snapshot,
    member,
    task,
    retryAttempt: args.retryAttempt,
    sessionContinuation: args.sessionContinuation,
    openAICompatibleConversationContinuation,
  });
  const taskSequence = turnsBeforeCurrent + 1;
  const prompt = mode === "full"
    ? buildFullPrompt({
        ...args,
        routingNote: addressedRoutingNote,
        taskSequence,
        transcriptLimit: args.member.provider.kind === "openai-compatible" ? undefined : FULL_PROMPT_TRANSCRIPT_LIMIT,
        transcriptLabel: args.member.provider.kind === "openai-compatible" ? "[Full Room Transcript]" : undefined,
      })
    : buildIncrementalPrompt({
        ...args,
        routingNote: addressedRoutingNote,
        taskSequence,
        previousTask,
      });

  if (member.provider.kind !== "openai-compatible") {
    return {
      prompt,
      promptMode: mode,
      promptTraceContent: prompt,
    };
  }

  const messageHistory = member.openAICompatibleConversation?.messages ?? [];
  return {
    prompt,
    promptMode: mode,
    messageHistory,
    promptTraceContent: formatConversationTrace({
      messageHistory,
      currentUserMessage: buildPersistedUserTurnMessage(prompt),
    }),
  };
}

export function buildTaskPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: ExecutionMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  retryAttempt?: number;
  sessionContinuation?: ExecutionSessionContinuation;
}): string {
  return buildTaskPromptPayload(args).prompt;
}
