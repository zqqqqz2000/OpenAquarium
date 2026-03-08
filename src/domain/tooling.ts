import type { Room, TeamMember } from "./model";

export interface MemberCliCommand {
  id: string;
  label: string;
  command: string;
}

export function buildMemberCliCommands(room: Room, member: TeamMember): MemberCliCommand[] {
  const baseCommand = `oa-room-send --room ${room.id} --member ${member.id}`;

  return [
    {
      id: `${member.id}-group`,
      label: "Send group message",
      command: `${baseCommand} --scope group --text "Status update from ${member.handle}"`,
    },
    {
      id: `${member.id}-direct`,
      label: "Send direct message",
      command: `${baseCommand} --scope direct --target @${member.handle} --text "Need your eyes on this thread."`,
    },
    ...member.skills.map((skill) => ({
      id: `${member.id}-${skill.id}`,
      label: skill.name,
      command: skill.command,
    })),
  ];
}
