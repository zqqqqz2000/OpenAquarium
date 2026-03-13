import type {
  AccentTone,
  ProviderBinding,
  ProviderModelProfileId,
  TeamMemberBlueprint,
  TeamTemplate,
  UpdateTemplateInput,
  WatchBlueprint,
} from "@/domain/model";
import { toSkillDefinitions, type SkillDraft } from "@/lib/member-config-draft";
import { resolveTemplateVisibleMemberBlueprintIds } from "@/lib/room-message-preferences";

export interface TemplateMemberDraft {
  id: string;
  name: string;
  handle: string;
  summary: string;
  prompt: string;
  accentTone: AccentTone;
  modelProfileId?: ProviderModelProfileId;
  provider: ProviderBinding;
  isEntryMember: boolean;
  observeAllRoomMessages: boolean;
  acceptsDirectMessages: boolean;
  watchEnabled: boolean;
  watchIntervalMinutes: string;
  skills: SkillDraft[];
}

export interface TemplateConfigDraft {
  name: string;
  description: string;
  accentTone: AccentTone;
  defaultVisibleMemberBlueprintIds: string[];
  members: TemplateMemberDraft[];
}

function createWatchBlueprint(draft: TemplateMemberDraft): WatchBlueprint | undefined {
  if (!draft.watchEnabled) {
    return undefined;
  }

  const intervalMinutes = Number(draft.watchIntervalMinutes);
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error(`Watcher interval for @${draft.handle || draft.name || draft.id} must be a positive number.`);
  }

  return {
    intervalMinutes: Math.round(intervalMinutes),
    enabledByDefault: true,
  };
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

function resolveNextMemberToken(members: TemplateMemberDraft[]): string {
  const usedTokens = new Set(
    members.flatMap((member) => {
      const tokens = [slugify(member.id), slugify(member.handle)];
      return tokens.filter((token) => token.length > 0);
    }),
  );

  let index = members.length + 1;
  while (usedTokens.has(`member-${index}`)) {
    index += 1;
  }

  return `member-${index}`;
}

function createTemplateMemberDraft(member: TeamMemberBlueprint): TemplateMemberDraft {
  return {
    id: member.id,
    name: member.name,
    handle: member.handle,
    summary: member.summary,
    prompt: member.prompt,
    accentTone: member.accentTone,
    modelProfileId: member.modelProfileId,
    provider: cloneProviderBinding(member.provider),
    isEntryMember: member.isEntryMember ?? false,
    observeAllRoomMessages: member.observeAllRoomMessages ?? false,
    acceptsDirectMessages: member.acceptsDirectMessages ?? true,
    watchEnabled: Boolean(member.watch),
    watchIntervalMinutes: member.watch ? String(member.watch.intervalMinutes) : "15",
    skills: member.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      command: skill.command,
    })),
  };
}

export function createTemplateConfigDraft(template: TeamTemplate): TemplateConfigDraft {
  return {
    name: template.name,
    description: template.description,
    accentTone: template.accentTone,
    defaultVisibleMemberBlueprintIds: resolveTemplateVisibleMemberBlueprintIds(template),
    members: template.members.map((member) => createTemplateMemberDraft(member)),
  };
}

export function addEmptyTemplateMemberDraft(
  members: TemplateMemberDraft[],
  args: {
    templateAccentTone: AccentTone;
    baseMember?: TemplateMemberDraft;
  },
): TemplateMemberDraft[] {
  const sourceMember = args.baseMember ?? members[0];
  if (!sourceMember) {
    throw new Error("Cannot add a template member without an existing member to inherit provider defaults from.");
  }

  const token = resolveNextMemberToken(members);
  const memberNumber = Number(token.match(/(\d+)$/u)?.[1] ?? members.length + 1);

  return [
    ...members,
    {
      id: token,
      name: `Member ${memberNumber}`,
      handle: token,
      summary: "New team member.",
      prompt: "Handle tasks for your role, coordinate with the team, and send short visible progress updates when work takes time.",
      accentTone: sourceMember.accentTone ?? args.templateAccentTone,
      modelProfileId: sourceMember.modelProfileId,
      provider: cloneProviderBinding(sourceMember.provider),
      isEntryMember: members.length === 0,
      observeAllRoomMessages: members.length === 0,
      acceptsDirectMessages: sourceMember.acceptsDirectMessages,
      watchEnabled: false,
      watchIntervalMinutes: sourceMember.watchIntervalMinutes,
      skills: [],
    },
  ];
}

export function removeTemplateMemberDraft(members: TemplateMemberDraft[], memberId: string): TemplateMemberDraft[] {
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

function buildTemplateMemberBlueprint(draft: TemplateMemberDraft): TeamMemberBlueprint {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    handle: draft.handle.trim().replace(/^@/u, ""),
    summary: draft.summary.trim(),
    prompt: draft.prompt.trim(),
    accentTone: draft.accentTone,
    modelProfileId: draft.modelProfileId?.trim() || undefined,
    isEntryMember: draft.isEntryMember,
    observeAllRoomMessages: draft.observeAllRoomMessages,
    acceptsDirectMessages: draft.acceptsDirectMessages,
    provider: cloneProviderBinding(draft.provider),
    skills: toSkillDefinitions(draft.skills),
    watch: createWatchBlueprint(draft),
  };
}

export function buildTemplateConfigInput(template: TeamTemplate, draft: TemplateConfigDraft): UpdateTemplateInput {
  return {
    templateId: template.id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    accentTone: draft.accentTone,
    defaultVisibleMemberBlueprintIds: draft.defaultVisibleMemberBlueprintIds,
    members: draft.members.map((memberDraft) => buildTemplateMemberBlueprint(memberDraft)),
  };
}
