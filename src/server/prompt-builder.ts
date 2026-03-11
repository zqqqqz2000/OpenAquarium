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

const FULL_PROMPT_TRANSCRIPT_LIMIT = 14;
const DELTA_PROMPT_TRANSCRIPT_LIMIT = 6;
export const MEMBER_FULL_PROMPT_REFRESH_INTERVAL = 4;

type PromptMode = "full" | "delta";

function summarizeHandles(prefix: string, memberIds: string[], snapshot: WorkspaceSnapshot): string {
  if (memberIds.length === 0) {
    return "";
  }

  return ` | ${prefix}: ${memberIds.map((memberId) => `@${snapshot.members[memberId]?.handle ?? memberId}`).join(", ")}`;
}

function summarizeQuotedHandles(message: ChatMessage, snapshot: WorkspaceSnapshot): string {
  if ((message.quotedMemberIds?.length ?? 0) === 0) {
    return "";
  }

  return ` | quotes: ${message.quotedMemberIds?.map((memberId) => `"${snapshot.members[memberId]?.handle ?? memberId}`).join(", ")}`;
}

function summarizeMessage(snapshot: WorkspaceSnapshot, message: ChatMessage): string {
  const recipientSuffix =
    message.recipientUser
      ? " | recipients: You"
      : summarizeHandles("recipients", message.recipientMemberIds, snapshot);

  return `[${formatTime(message.createdAt)}] ${message.author.label} (${message.transport}/${message.status}): ${message.content}${summarizeHandles("mentions", message.mentionedMemberIds, snapshot)}${summarizeQuotedHandles(message, snapshot)}${recipientSuffix}`;
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
    "oa_send_group_message: preferred for visible room replies.",
    "oa_send_direct_message: preferred for private teammate DMs and replies to @user.",
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
    transcriptFilePath ? `room transcript file: ${transcriptFilePath}` : undefined,
    "",
    "[Task]",
    `taskId: ${task.id}`,
    `title: ${task.title}`,
    `source message: ${sourceMessage.content}`,
    `source transport: ${sourceMessage.transport}`,
    `routing note: ${routingNote}`,
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
    "2. Any @handle mention in a group message routes that teammate. Use \"handle when you want to reference or quote someone without assigning them work.",
    "3. Do not assume hidden roles. The prompt and skills define each member's current job.",
    "4. Keep room messages concise and actionable, but do not stay silent on long tasks.",
    "5. If work will take more than a short turn, send an early visible progress update, then send another update at meaningful milestones, blockers, or plan changes.",
    "6. Prefer group messages for user-facing progress updates; use direct messages for private coordination or explicit one-to-one follow-up. Use @user when you need to reply privately to the human.",
    "7. If work is sequential, only @ the member(s) who should act now. Do not route downstream members early just because they will be needed later.",
    "8. Do not DM teammates just to repeat the same public instruction that is already clear in the room. Use DM only for private coordination, blockers, or a single targeted nudge after checking room state.",
    "9. If you are a watcher or scribe waiting on upstream replies, stay quiet until the required room messages actually exist; do not proactively chase teammates unless the current task explicitly asks you to.",
    "10. Once you have completed your scoped visible reply, stop. Do not keep generating follow-up chatter unless a new routed message or blocker requires it.",
    "11. Do not paste your reasoning, tool narration, or step-by-step plan into room or DM messages.",
    "12. Do not send the same room or DM content twice. If a send result is unclear, inspect room state first and only retry if the message is actually missing.",
    "13. The final task completion text is private session output, not a room reply. Only text sent via the room/DM tools is user-visible.",
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
    "1. Any @handle mention routes that teammate. Use \"handle for non-routing references or quotes.",
    "2. Send progress updates for work that lasts more than a short turn.",
    "3. Do not leak reasoning or tool narration into user-visible messages.",
    "4. Do not resend the same room or DM content unless room state confirms it is missing.",
    "5. Read the transcript file when you need older context than the delta shown here.",
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
    ? "This source message mentioned one or more @handles, so every mentioned teammate was routed as a real assignment."
    : "This source message did not mention any teammate handle, so it followed the normal fallback routing.";
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
