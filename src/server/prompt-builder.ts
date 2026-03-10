import type { ChatMessage, MemberTask, Project, Room, TeamMember, WorkspaceSnapshot } from "../domain/model";
import { extractAddressedMemberIds } from "../domain/workspace";
import { formatTime } from "../lib/utils";

function summarizeMessage(snapshot: WorkspaceSnapshot, message: ChatMessage): string {
  const mentionSuffix =
    message.mentionedMemberIds.length > 0
      ? ` | mentions: ${message.mentionedMemberIds
          .map((memberId) => `@${snapshot.members[memberId]?.handle ?? memberId}`)
          .join(", ")}`
      : "";
  const recipientSuffix =
    message.recipientUser
      ? " | recipients: You"
      : message.recipientMemberIds.length > 0
      ? ` | recipients: ${message.recipientMemberIds
          .map((memberId) => `@${snapshot.members[memberId]?.handle ?? memberId}`)
          .join(", ")}`
      : "";

  return `[${formatTime(message.createdAt)}] ${message.author.label} (${message.transport}/${message.status}): ${message.content}${mentionSuffix}${recipientSuffix}`;
}

function describeMember(member: TeamMember): string {
  const skillList = member.skills.map((skill) => `${skill.name}: ${skill.command}`).join(" | ");

  return [
    `- ${member.name} (@${member.handle})`,
    `  summary: ${member.summary}`,
    `  observeAllRoomMessages: ${member.observeAllRoomMessages ? "true" : "false"}`,
    `  acceptsDirectMessages: ${member.acceptsDirectMessages ? "true" : "false"}`,
    `  provider: ${member.provider.label} -> ${member.provider.command} ${member.provider.args.join(" ")}`.trim(),
    `  skills: ${skillList || "(none)"}`,
  ].join("\n");
}

export function buildTaskPrompt(args: {
  workspaceRoot: string;
  project: Project;
  room: Room;
  member: TeamMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
}): string {
  const { workspaceRoot, project, room, member, task, snapshot } = args;
  const recentMessages = (snapshot.messageOrderByRoom[room.id] ?? [])
    .slice(-14)
    .map((messageId) => summarizeMessage(snapshot, snapshot.messages[messageId]))
    .join("\n");
  const roster = room.memberIds.map((memberId) => describeMember(snapshot.members[memberId])).join("\n");
  const sourceMessage = snapshot.messages[task.sourceMessageId];
  const addressedRoutingNote = extractAddressedMemberIds(snapshot, room.id, sourceMessage.content).length > 0
    ? "This source message started with explicit @handles, so it was routed as a real assignment."
    : "This source message did not start with explicit @handles, so later inline mentions are context only.";
  const preferredTools = [
    "oa_send_group_message: preferred for visible room replies.",
    "oa_send_direct_message: preferred for private teammate DMs and replies to @user.",
    "oa_room_state: inspect transcript and member/task state before retrying a send.",
    "oa_run_room_watcher: trigger a watcher immediately when needed.",
    `CLI group fallback only if the dedicated tools are unavailable: ${workspaceRoot}/bin/oa-room-send --room ${room.id} --member ${member.id} --scope group --text "your message"`,
    `CLI direct fallback only if needed: ${workspaceRoot}/bin/oa-room-send --room ${room.id} --member ${member.id} --scope direct --target @user --text "private message"`,
    `CLI state fallback: ${workspaceRoot}/bin/oa-room-state --room ${room.id}`,
  ].join("\n");

  return [
    "You are an agent-team member inside OpenAquarium.",
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
    `room: ${room.name}`,
    `topic: ${room.topic}`,
    "",
    "[Task]",
    `taskId: ${task.id}`,
    `title: ${task.title}`,
    `source message: ${sourceMessage.content}`,
    `source transport: ${sourceMessage.transport}`,
    `routing note: ${addressedRoutingNote}`,
    "",
    "[Team Roster]",
    roster,
    "",
    "[Recent Room Transcript]",
    recentMessages || "(none)",
    "",
    "[Communication Rules]",
    "1. If you need to speak in the room or DM someone, prefer the dedicated ACP tools listed below instead of generic shell commands.",
    "2. A group message only routes to teammates when it starts with one or more @handle mentions; inline mentions later in the sentence are references only.",
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
    "[Preferred Tools]",
    preferredTools,
    "",
    "[Member Skills]",
    member.skills.map((skill) => `- ${skill.name}: ${skill.description}\n  command: ${skill.command}`).join("\n") || "(none)",
    "",
    "[Instruction]",
    "Perform the current task. If a room or direct response is needed, actually send it using the command line tool. Keep the user and team updated with short progress messages while you work, and continue until the task is complete.",
  ].join("\n");
}
