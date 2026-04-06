import type { ProviderBinding, Room, TeamTemplate, TeamMemberBlueprint, UpdateTemplateInput } from "@/domain/model";
import { parseAllowedSkillIdsText } from "@/lib/member-config-draft";
import type { RoomTeamDraft, RoomTeamMemberDraft } from "@/lib/room-team-draft";

function cloneProviderBinding(provider: ProviderBinding): ProviderBinding {
  return {
    ...provider,
    args: [...provider.args],
    env: { ...provider.env },
    capabilities: [...provider.capabilities],
  };
}

function buildTemplateMember(member: RoomTeamMemberDraft): TeamMemberBlueprint {
  const intervalMinutes = Number(member.watchIntervalMinutes);

  return {
    id: member.id,
    name: member.name.trim(),
    handle: member.handle.trim().replace(/^@/u, ""),
    isRole: member.isRole,
    summary: member.summary.trim(),
    prompt: member.prompt.trim(),
    accentTone: member.accentTone,
    modelProfileId: member.modelProfileId?.trim() || undefined,
    modelId: member.modelId?.trim() || undefined,
    allowedSkillIds: parseAllowedSkillIdsText(member.allowedSkillIdsText),
    provider: cloneProviderBinding(member.provider),
    isEntryMember: member.isEntryMember,
    acceptsDirectMessages: true,
    codexThinkingDepth: member.codexThinkingDepth,
    watch: member.watchConfigured
      ? {
          enabledByDefault: member.watchEnabled,
          intervalMinutes: Number.isFinite(intervalMinutes) && intervalMinutes > 0 ? Math.round(intervalMinutes) : 15,
          persistent: member.watchPersistent,
          prompt: member.watchPrompt.trim() || undefined,
        }
      : undefined,
  };
}

export function buildDefaultTemplateInput(args: {
  room: Room;
  draft: RoomTeamDraft;
  sourceTemplate?: TeamTemplate;
}): UpdateTemplateInput {
  const members = args.draft.members.map((member) => buildTemplateMember(member));
  const memberIds = members.map((member) => member.id);
  const defaultVisibleMemberBlueprintIds =
    args.room.visibleMemberIds?.filter((memberId) => memberIds.includes(memberId))
    ?? args.sourceTemplate?.defaultVisibleMemberBlueprintIds?.filter((memberId) => memberIds.includes(memberId))
    ?? memberIds;

  return {
    templateId: args.room.templateId,
    name: args.draft.name.trim(),
    description: args.draft.description.trim(),
    accentTone: args.draft.accentTone,
    defaultVisibleMemberBlueprintIds,
    members,
  };
}
