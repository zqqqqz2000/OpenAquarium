import type { ChatMessage, MemberTask, Project, Room, TeamMember, WorkspaceSnapshot } from "../domain/model";
import { formatTime } from "../lib/utils";

function summarizeMessage(snapshot: WorkspaceSnapshot, message: ChatMessage): string {
  const mentionSuffix =
    message.mentionedMemberIds.length > 0
      ? ` | mentions: ${message.mentionedMemberIds
          .map((memberId) => `@${snapshot.members[memberId]?.handle ?? memberId}`)
          .join(", ")}`
      : "";
  const recipientSuffix =
    message.recipientMemberIds.length > 0
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
  const directCommands = [
    `Group message: ${workspaceRoot}/bin/oa-room-send --room ${room.id} --member ${member.id} --scope group --text "your message"`,
    `Direct message: ${workspaceRoot}/bin/oa-room-send --room ${room.id} --member ${member.id} --scope direct --target @handle --text "private message"`,
    `Run room watcher: ${workspaceRoot}/bin/oa-room-watch --watcher WATCHER_ID`,
    `Inspect room state: ${workspaceRoot}/bin/oa-room-state --room ${room.id}`,
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
    "",
    "[Team Roster]",
    roster,
    "",
    "[Recent Room Transcript]",
    recentMessages || "(none)",
    "",
    "[Communication Rules]",
    "1. If you need to speak in the room or DM another member, use the CLI commands below.",
    "2. A group message that includes @handle will interrupt that member and deliver the message.",
    "3. Do not assume hidden roles. The prompt and skills define each member's current job.",
    "4. Keep room messages concise and actionable.",
    "5. Do not paste your reasoning, tool narration, or step-by-step plan into room messages.",
    "6. The final task completion text is private trace output, not a room reply. Only text sent via the room/DM commands is user-visible.",
    "",
    "[Available Commands]",
    directCommands,
    "",
    "[Member Skills]",
    member.skills.map((skill) => `- ${skill.name}: ${skill.description}\n  command: ${skill.command}`).join("\n") || "(none)",
    "",
    "[Instruction]",
    "Perform the current task. If a room or direct response is needed, actually send it using the command line tool. Continue until the task is complete.",
  ].join("\n");
}
