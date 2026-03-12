import type { ChatMessage, MemberTask, Project, Room, TeamMember, WorkspaceSnapshot } from "../domain/model";
import { extractAddressedMemberIds } from "../domain/workspace";
import { isVisibleMainRoomMessage } from "../lib/message-visibility";
import { formatTime } from "../lib/utils";
import {
  getOpenAquariumScriptPath,
  quoteShellToken,
  resolveProjectWorkingDirectory,
  rewriteCommandForProjectContext,
} from "./project-paths";
import { getMemberHistoryFilePath, getRoomContextDirectoryPath, getRoomTranscriptFilePath } from "./room-transcript-files";

const FULL_PROMPT_TRANSCRIPT_LIMIT = 14;
const DELTA_PROMPT_TRANSCRIPT_LIMIT = 6;
export const MEMBER_FULL_PROMPT_REFRESH_INTERVAL = 4;

type PromptMode = "full" | "delta";

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

function describeMember(member: TeamMember, workspaceRoot: string): string {
  const skillList = member.skills.map((skill) => `${skill.name}: ${rewriteCommandForProjectContext(skill.command, workspaceRoot)}`).join(" | ");

  return [
    `- ${member.name} (@${member.handle})`,
    `  summary: ${member.summary}`,
    `  observeAllRoomMessages: ${member.observeAllRoomMessages ? "true" : "false"}`,
    `  acceptsDirectMessages: ${member.acceptsDirectMessages ? "true" : "false"}`,
    `  provider: ${member.provider.label} -> ${member.provider.command} ${member.provider.args.join(" ")}`.trim(),
    `  skills: ${skillList || "(none)"}`,
  ].join("\n");
}

function describeMemberHandles(room: Room, snapshot: WorkspaceSnapshot): string {
  return room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .map((member) => `@${member.handle}: ${member.summary}`)
    .join("\n");
}

function getVisibleRoomMessages(snapshot: WorkspaceSnapshot, room: Room): ChatMessage[] {
  return (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is ChatMessage => Boolean(message) && isVisibleMainRoomMessage(message));
}

function sortMemberTasks(snapshot: WorkspaceSnapshot, memberId: string): MemberTask[] {
  return Object.values(snapshot.tasks)
    .filter((task) => task.memberId === memberId)
    .sort((left, right) => {
      const startedAtOrder = left.startedAt.localeCompare(right.startedAt);
      return startedAtOrder !== 0 ? startedAtOrder : left.id.localeCompare(right.id);
    });
}

function resolvePromptMode(snapshot: WorkspaceSnapshot, member: TeamMember, task: MemberTask): {
  mode: PromptMode;
  turnsBeforeCurrent: number;
  previousTask?: MemberTask;
} {
  const memberTasks = sortMemberTasks(snapshot, member.id);
  const currentTaskIndex = memberTasks.findIndex((candidate) => candidate.id === task.id);
  const turnsBeforeCurrent = currentTaskIndex >= 0 ? currentTaskIndex : memberTasks.length;
  const previousTask = currentTaskIndex > 0 ? memberTasks[currentTaskIndex - 1] : undefined;
  const needsFullPrompt =
    turnsBeforeCurrent === 0
    || !member.providerSessionId
    || turnsBeforeCurrent % MEMBER_FULL_PROMPT_REFRESH_INTERVAL === 0;

  return {
    mode: needsFullPrompt ? "full" : "delta",
    turnsBeforeCurrent,
    previousTask,
  };
}

function collectDeltaMessages(snapshot: WorkspaceSnapshot, room: Room, previousTask?: MemberTask): ChatMessage[] {
  const visibleMessages = getVisibleRoomMessages(snapshot, room);

  if (!previousTask) {
    return visibleMessages.slice(-DELTA_PROMPT_TRANSCRIPT_LIMIT);
  }

  const deltaMessages = visibleMessages.filter((message) => message.createdAt > previousTask.updatedAt);
  if (deltaMessages.length > 0) {
    return deltaMessages.slice(-DELTA_PROMPT_TRANSCRIPT_LIMIT);
  }

  return visibleMessages.slice(-DELTA_PROMPT_TRANSCRIPT_LIMIT);
}

function formatTaskSourceMessage(sourceMessage: ChatMessage): string {
  if (sourceMessage.transport === "watch-digest") {
    return "(private watcher digest; see Watcher Context below)";
  }

  return sourceMessage.content;
}

function buildWatcherContextSections(sourceMessage: ChatMessage): string[] {
  if (sourceMessage.transport !== "watch-digest") {
    return [];
  }

  return [
    "",
    "[Watcher Context]",
    "This task was triggered by a private watcher digest. The unseen room activity below was not posted into the room for others. Decide yourself whether any visible room reply is actually needed.",
    sourceMessage.content,
  ];
}

function buildRoomContextFileSections(workspaceRoot: string, room: Room, snapshot: WorkspaceSnapshot, transcriptFilePath?: string): string[] {
  const roomContextDirectoryPath = getRoomContextDirectoryPath(workspaceRoot, room);
  const resolvedTranscriptFilePath = transcriptFilePath ?? getRoomTranscriptFilePath(workspaceRoot, room);
  const memberHistoryFiles = room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .filter((member): member is TeamMember => member !== undefined)
    .map((member) => `@${member.handle}: ${getMemberHistoryFilePath(workspaceRoot, room, member)}`);

  return [
    "[Shared Room Context]",
    `room context directory: ${roomContextDirectoryPath}`,
    `room transcript file: ${resolvedTranscriptFilePath}`,
    "member history files:",
    ...(memberHistoryFiles.length > 0 ? memberHistoryFiles : ["(none)"]),
  ];
}

function buildMemberReferenceSyntaxSections(): string[] {
  return [
    "[Member Reference Syntax]",
    "@handle: passive reference only. Never use plain @handle to route work. Use it when explaining, citing, or comparing members for the user or team. It does not notify the member, does not route work, and does not start a task for them.",
    "@>handle: active routing. That member immediately receives the message as work and may be interrupted to act on it. Use @>handle only when you want that member to start working now.",
  ];
}

function buildSharedSections(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: TeamMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  routingNote: string;
  promptMode: PromptMode;
  taskSequence: number;
}): string[] {
  const { workspaceRoot, project, room, member, task, snapshot, transcriptFilePath, routingNote, promptMode, taskSequence } = args;
  const projectWorkingDirectory = resolveProjectWorkingDirectory(project, workspaceRoot);
  const roomSendScript = quoteShellToken(getOpenAquariumScriptPath(workspaceRoot, "oa-room-send"));
  const roomStateScript = quoteShellToken(getOpenAquariumScriptPath(workspaceRoot, "oa-room-state"));
  const sourceMessage = snapshot.messages[task.sourceMessageId];
  const preferredTools = [
    "oa_send_group_message: preferred for visible room replies. Sent content is rendered to the user as Markdown.",
    "oa_send_direct_message: preferred for private teammate DMs and replies to @user. Sent content is rendered as Markdown.",
    "oa_room_state: inspect transcript and member/task state before retrying a send.",
    "oa_read_file: read transcript files or source files when you need deeper context.",
    "oa_run_room_watcher: trigger a watcher immediately when needed.",
    `CLI group fallback only if the dedicated tools are unavailable: ${roomSendScript} --room ${room.id} --member ${member.id} --scope group --text "your message"`,
    `CLI direct fallback only if needed: ${roomSendScript} --room ${room.id} --member ${member.id} --scope direct --target @user --text "private message"`,
    `CLI state fallback: ${roomStateScript} --room ${room.id}`,
  ].join("\n");

  return [
    "You are an agent-team member inside OpenAquarium.",
    "",
    "[Turn Context]",
    `prompt mode: ${promptMode}`,
    `member turn: ${taskSequence}`,
    `persistent session: ${member.providerSessionId ? "resume existing ACP session when possible" : "initializing session"}`,
    "",
    "[Member Configuration]",
    `name: ${member.name}`,
    `handle: @${member.handle}`,
    `prompt: ${member.prompt}`,
    `summary: ${member.summary}`,
    `isEntryMember: ${member.isEntryMember ? "true" : "false"}`,
    `observeAllRoomMessages: ${member.observeAllRoomMessages ? "true" : "false"}`,
    "",
    "[Project]",
    `project: ${project.name}`,
    `project path: ${project.path ?? "(default workspace root)"}`,
    `project working directory: ${projectWorkingDirectory}`,
    `OpenAquarium runtime root: ${workspaceRoot}`,
    `room: ${room.name}`,
    `topic: ${room.topic}`,
    "",
    ...buildRoomContextFileSections(workspaceRoot, room, snapshot, transcriptFilePath),
    "",
    ...buildMemberReferenceSyntaxSections(),
    "",
    "[Task]",
    `taskId: ${task.id}`,
    `title: ${task.title}`,
    `source message: ${formatTaskSourceMessage(sourceMessage)}`,
    `source transport: ${sourceMessage.transport}`,
    `routing note: ${routingNote}`,
    ...buildWatcherContextSections(sourceMessage),
    "",
    "[Preferred Tools]",
    preferredTools,
  ].filter((value): value is string => value !== undefined);
}

function buildFullPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: TeamMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  routingNote: string;
  taskSequence: number;
}): string {
  const { room, snapshot, member } = args;
  const recentMessages = getVisibleRoomMessages(snapshot, room)
    .slice(-FULL_PROMPT_TRANSCRIPT_LIMIT)
    .map((message) => summarizeMessage(snapshot, message))
    .join("\n");
  const roster = room.memberIds.map((memberId) => describeMember(snapshot.members[memberId], args.workspaceRoot)).join("\n");

  return [
    ...buildSharedSections({
      ...args,
      promptMode: "full",
    }),
    "",
    "[Team Roster]",
    roster,
    "",
    "[Recent Room Transcript]",
    recentMessages || "(none)",
    "",
    "[Communication Rules]",
    "1. If you need to speak in the room or DM someone, prefer the dedicated ACP tools listed below instead of generic shell commands.",
    "2. `@handle` is only a passive reference for explanation. Never use plain `@handle` to assign work. It does not notify that teammate, does not route work, and does not start a task for them.",
    "3. `@>handle` is an active assignment. That teammate immediately gets the message as work and may be interrupted to act on it.",
    "4. Do not assume hidden roles. The prompt and skills define each member's current job.",
    "5. Keep room messages concise and actionable, but do not stay silent on long tasks.",
    "6. If work will take more than a short turn, send an early visible progress update, then send another update at meaningful milestones, blockers, or plan changes.",
    "7. Prefer group messages for user-facing progress updates; use direct messages for private coordination or explicit one-to-one follow-up. Use @user when you need to reply privately to the human.",
    "8. If work is sequential, only use `@>handle` for the member(s) who should act now. Do not route downstream members early just because they will be needed later.",
    "9. Do not DM teammates just to repeat the same public instruction that is already clear in the room. Use DM only for private coordination, blockers, or a single targeted nudge after checking room state.",
    "10. If you are a watcher or scribe waiting on upstream replies, stay quiet until the required room messages actually exist; do not proactively chase teammates unless the current task explicitly asks you to.",
    "11. Once you have completed your scoped visible reply, stop. Do not keep generating follow-up chatter unless a new routed message or blocker requires it.",
    "12. Do not paste your reasoning, tool narration, or step-by-step plan into room or DM messages.",
    "13. Do not send the same room or DM content twice. If a send result is unclear, inspect room state first and only retry if the message is actually missing.",
    "14. The final task completion text is private session output, not a room reply. Only text sent via the room/DM tools is user-visible.",
    "15. Treat the shared room context directory as the durable source for room transcript and per-member histories. Read the relevant files when watcher context reports unseen messages or member state changes.",
    "16. User-visible room and direct messages render as Markdown. Send plain text when simple is enough, but use valid Markdown when structure, code, links, or lists help.",
    "",
    "[Member Skills]",
    member.skills.map((skill) => `- ${skill.name}: ${skill.description}\n  command: ${skill.command}`).join("\n") || "(none)",
    "",
    "[Instruction]",
    "Perform the current task. If a room or direct response is needed, actually send it using the tools. Keep the user and team updated with short progress messages while you work, and continue until the task is complete.",
  ].join("\n");
}

function buildDeltaPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: TeamMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
  routingNote: string;
  taskSequence: number;
  previousTask?: MemberTask;
}): string {
  const { room, snapshot, previousTask } = args;
  const deltaMessages = collectDeltaMessages(snapshot, room, previousTask)
    .map((message) => summarizeMessage(snapshot, message))
    .join("\n");

  return [
    ...buildSharedSections({
      ...args,
      promptMode: "delta",
    }),
    "",
    "[Session Continuity]",
    previousTask
      ? `Your previous task in this room was ${previousTask.id} (${previousTask.title}), updated at ${previousTask.updatedAt}.`
      : "No earlier task was found for this member in this room.",
    "Reuse your persistent ACP session context when it helps, but treat the current room transcript and source message as the source of truth if they conflict.",
    "If the delta below is insufficient, read the room transcript file with oa_read_file instead of guessing.",
    "",
    "[Team Handles]",
    describeMemberHandles(room, snapshot) || "(none)",
    "",
    "[Recent Delta Transcript]",
    deltaMessages || "(none)",
    "",
    "[Critical Rules]",
    "1. `@handle` is only a passive reference. Never use plain `@handle` to assign work. It does not notify the member, does not route work, and does not start a task.",
    "2. `@>handle` is active routing: that teammate immediately receives the message as work and may be interrupted to act on it.",
    "3. Send progress updates for work that lasts more than a short turn.",
    "4. Do not leak reasoning or tool narration into user-visible messages.",
    "5. Do not resend the same room or DM content unless room state confirms it is missing.",
    "6. Read the shared room context files when you need older context than the delta shown here, especially for watcher-triggered state changes.",
    "7. User-visible room and direct messages render as Markdown, so send valid Markdown whenever formatting helps.",
    "",
    "[Instruction]",
    "Continue from the existing member session with only the new information above. Respond using tools when you need visible output, and finish once the current task is actually handled.",
  ].join("\n");
}

export function buildTaskPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: TeamMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  transcriptFilePath?: string;
}): string {
  const { snapshot, room, member, task } = args;
  const sourceMessage = snapshot.messages[task.sourceMessageId];
  const addressedRoutingNote = extractAddressedMemberIds(snapshot, room.id, sourceMessage.content).length > 0
    ? "This source message used one or more active @>handles, so every targeted teammate was routed as a real assignment."
    : "This source message did not use any active @>handle, so it followed the normal fallback routing.";
  const { mode, turnsBeforeCurrent, previousTask } = resolvePromptMode(snapshot, member, task);
  const taskSequence = turnsBeforeCurrent + 1;

  return mode === "full"
    ? buildFullPrompt({
        ...args,
        routingNote: addressedRoutingNote,
        taskSequence,
      })
    : buildDeltaPrompt({
        ...args,
        routingNote: addressedRoutingNote,
        taskSequence,
        previousTask,
      });
}
