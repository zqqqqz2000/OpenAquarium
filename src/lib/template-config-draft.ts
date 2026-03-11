import type {
  AccentTone,
  ProviderModelProfileId,
  TeamMemberBlueprint,
  TeamTemplate,
  UpdateTemplateInput,
  WatchBlueprint,
} from "@/domain/model";
import { toSkillDefinitions, type SkillDraft } from "@/lib/member-config-draft";

export interface TemplateMemberDraft {
  id: string;
  name: string;
  handle: string;
  summary: string;
  prompt: string;
  accentTone: AccentTone;
  modelProfileId?: ProviderModelProfileId;
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

function createTemplateMemberDraft(member: TeamMemberBlueprint): TemplateMemberDraft {
  return {
    id: member.id,
    name: member.name,
    handle: member.handle,
    summary: member.summary,
    prompt: member.prompt,
    accentTone: member.accentTone,
    modelProfileId: member.modelProfileId,
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
    members: template.members.map((member) => createTemplateMemberDraft(member)),
  };
}

function buildTemplateMemberBlueprint(existing: TeamMemberBlueprint, draft: TemplateMemberDraft): TeamMemberBlueprint {
  return {
    ...existing,
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
    provider: existing.provider,
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
    members: draft.members.map((memberDraft) => {
      const existingMember = template.members.find((member) => member.id === memberDraft.id);
      if (!existingMember) {
        throw new Error(`Unknown template member "${memberDraft.id}"`);
      }

      return buildTemplateMemberBlueprint(existingMember, memberDraft);
    }),
  };
}
