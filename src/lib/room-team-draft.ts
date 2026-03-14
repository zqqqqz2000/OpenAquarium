import type {
  AccentTone,
  CodexThinkingDepth,
  ProviderBinding,
  ProviderModelProfileId,
  Room,
  RoomTeamMemberInput,
  TeamMember,
  UpdateRoomTeamInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import { toSkillDefinitions, type SkillDraft } from "@/lib/member-config-draft";
import { resolveRoomTeamSummary } from "@/lib/room-team";

export interface RoomTeamMemberDraft {
  id: string;
  roleId: string;
  roleName: string;
  isRole: boolean;
  name: string;
  handle: string;
  summary: string;
  note?: string;
  prompt: string;
  accentTone: AccentTone;
  modelProfileId?: ProviderModelProfileId;
  provider: ProviderBinding;
  isEntryMember: boolean;
  acceptsDirectMessages: boolean;
  codexThinkingDepth?: CodexThinkingDepth;
  watchConfigured: boolean;
  watchEnabled: boolean;
  watchPersistent: boolean;
  watchIntervalMinutes: string;
  skills: SkillDraft[];
}

export interface RoomTeamDraft {
  name: string;
  description: string;
  accentTone: AccentTone;
  members: RoomTeamMemberDraft[];
}

function cloneProviderBinding(provider: ProviderBinding): ProviderBinding {
  return {
    ...provider,
    args: [...provider.args],
    env: { ...provider.env },
    capabilities: [...provider.capabilities],
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function resolveNextMemberToken(members: RoomTeamMemberDraft[]): string {
  const usedTokens = new Set(
    members.flatMap((member) => {
      const tokens = [slugify(member.id), slugify(member.handle)];
      return tokens.filter((token) => token.length > 0);
    }),
  );

  let index = members.length + 1;
  while (usedTokens.has(`room-member-${index}`)) {
    index += 1;
  }

  return `room-member-${index}`;
}

function resolveRoleTemplateIdentity(memberNumber: number): {
  name: string;
  handle: string;
  roleName: string;
} {
  return {
    name: `Role ${memberNumber}`,
    handle: `role-${memberNumber}`,
    roleName: `Role ${memberNumber}`,
  };
}

function createRoomTeamMemberDraft(snapshot: WorkspaceSnapshot, room: Room, member: TeamMember): RoomTeamMemberDraft {
  const watcher = room.watcherIds
    .map((watcherId) => snapshot.watchers[watcherId])
    .find((candidate) => candidate?.memberId === member.id);

  return {
    id: member.id,
    roleId: member.roleId,
    roleName: member.roleName,
    isRole: member.isRole === true,
    name: member.name,
    handle: member.handle,
    summary: member.summary,
    note: member.note,
    prompt: member.prompt,
    accentTone: member.accentTone,
    modelProfileId: member.modelProfileId,
    provider: cloneProviderBinding(member.provider),
    isEntryMember: member.isEntryMember,
    acceptsDirectMessages: member.acceptsDirectMessages,
    codexThinkingDepth: member.codexThinkingDepth,
    watchConfigured: Boolean(watcher),
    watchEnabled: watcher?.enabled ?? false,
    watchPersistent: watcher?.persistent ?? false,
    watchIntervalMinutes: watcher ? String(watcher.intervalMinutes) : "15",
    skills: member.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      command: skill.command,
    })),
  };
}

export function createRoomTeamDraft(snapshot: WorkspaceSnapshot, room: Room): RoomTeamDraft {
  const team = resolveRoomTeamSummary(snapshot, room);

  return {
    name: team.name,
    description: team.description,
    accentTone: team.accentTone,
    members: room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .filter((member): member is TeamMember => Boolean(member))
      .map((member) => createRoomTeamMemberDraft(snapshot, room, member)),
  };
}

export function addEmptyRoomTeamMemberDraft(
  members: RoomTeamMemberDraft[],
  args: {
    teamAccentTone: AccentTone;
    baseMember?: RoomTeamMemberDraft;
    mode?: "role-template" | "employee";
  },
): RoomTeamMemberDraft[] {
  const sourceMember = args.baseMember ?? members[0];
  if (!sourceMember) {
    throw new Error("Cannot add a room member without an existing member to inherit provider defaults from.");
  }

  const token = resolveNextMemberToken(members);
  const memberNumber = Number(token.match(/(\d+)$/u)?.[1] ?? members.length + 1);
  const roleIdentity = resolveRoleTemplateIdentity(memberNumber);
  const isRoleTemplate = args.mode === "role-template";

  return [
    ...members,
    {
      id: token,
      roleId: isRoleTemplate ? token : sourceMember.roleId,
      roleName: isRoleTemplate ? roleIdentity.roleName : sourceMember.roleName,
      isRole: isRoleTemplate,
      name: isRoleTemplate ? roleIdentity.name : `Member ${memberNumber}`,
      handle: isRoleTemplate ? roleIdentity.handle : `${slugify(sourceMember.roleName)}-${memberNumber}`,
      summary: isRoleTemplate ? "Describe this role's responsibility." : sourceMember.summary,
      note: "",
      prompt: sourceMember.prompt,
      accentTone: sourceMember.accentTone ?? args.teamAccentTone,
      modelProfileId: sourceMember.modelProfileId,
      provider: cloneProviderBinding(sourceMember.provider),
      isEntryMember: members.length === 0,
      acceptsDirectMessages: true,
      codexThinkingDepth: sourceMember.codexThinkingDepth,
      watchConfigured: isRoleTemplate ? sourceMember.watchConfigured : false,
      watchEnabled: isRoleTemplate ? sourceMember.watchEnabled : false,
      watchPersistent: isRoleTemplate ? sourceMember.watchPersistent : false,
      watchIntervalMinutes: sourceMember.watchIntervalMinutes,
      skills: isRoleTemplate ? sourceMember.skills.map((skill) => ({ ...skill })) : [],
    },
  ];
}

export function removeRoomTeamMemberDraft(members: RoomTeamMemberDraft[], memberId: string): RoomTeamMemberDraft[] {
  const remainingMembers = members.filter((member) => member.id !== memberId);
  if (remainingMembers.length === 0) {
    return remainingMembers;
  }

  if (remainingMembers.some((member) => member.isEntryMember)) {
    return remainingMembers;
  }

  return remainingMembers.map((member, index) => ({
    ...member,
    isEntryMember: index === 0,
  }));
}

function buildRoomTeamMemberInput(draft: RoomTeamMemberDraft): RoomTeamMemberInput {
  const intervalMinutes = Number(draft.watchIntervalMinutes);
  if (draft.watchConfigured && (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0)) {
    throw new Error(`Watcher interval for @${draft.handle || draft.name || draft.id} must be a positive number.`);
  }

  return {
    memberId: draft.id,
    roleId: draft.roleId,
    roleName: draft.roleName,
    isRole: draft.isRole,
    name: draft.name.trim(),
    handle: draft.handle.trim().replace(/^@/u, ""),
    summary: draft.summary.trim(),
    note: draft.note?.trim() || undefined,
    prompt: draft.prompt.trim(),
    accentTone: draft.accentTone,
    modelProfileId: draft.modelProfileId?.trim() || undefined,
    isEntryMember: draft.isEntryMember,
    acceptsDirectMessages: draft.acceptsDirectMessages,
    codexThinkingDepth: draft.codexThinkingDepth,
    provider: cloneProviderBinding(draft.provider),
    skills: toSkillDefinitions(draft.skills),
    watch: draft.watchConfigured
      ? {
          enabled: draft.watchEnabled,
          intervalMinutes: Math.round(intervalMinutes),
          persistent: draft.watchPersistent,
        }
      : undefined,
  };
}

export function buildRoomTeamInput(room: Room, draft: RoomTeamDraft): UpdateRoomTeamInput {
  return {
    roomId: room.id,
    teamName: draft.name.trim(),
    teamDescription: draft.description.trim(),
    teamAccentTone: draft.accentTone,
    members: draft.members.map((memberDraft) => buildRoomTeamMemberInput(memberDraft)),
  };
}
