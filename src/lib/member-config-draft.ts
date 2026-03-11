import type { ProviderBinding, ProviderModelProfileId, SkillDefinition, TeamMember, UpdateMemberConfigInput, WatchSubscription } from "@/domain/model";

export interface SkillDraft {
  id: string;
  name: string;
  description: string;
  command: string;
}

export interface ProviderConfigDraftFields {
  providerLabel: string;
  providerCommand: string;
  providerArgsText: string;
  providerCapabilitiesText: string;
  providerWorkingDirectory: string;
  providerEnvText: string;
}

export interface MemberConfigDraft {
  summary: string;
  prompt: string;
  modelProfileId?: ProviderModelProfileId;
  acceptsDirectMessages: boolean;
  skills: SkillDraft[];
}

export interface WatcherDraft {
  enabled: boolean;
  intervalMinutes: string;
}

export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function splitCapabilities(text: string): string[] {
  return text
    .split(/[,\n]/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function parseEnvText(text: string): Record<string, string> {
  return splitLines(text).reduce<Record<string, string>>((env, line) => {
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid env line "${line}". Use KEY=VALUE.`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) {
      throw new Error(`Invalid env line "${line}". Missing key.`);
    }
    env[key] = value;
    return env;
  }, {});
}

export function toSkillDefinitions(skills: SkillDraft[]): SkillDefinition[] {
  return skills
    .map((skill) => ({
      id: skill.id.trim(),
      name: skill.name.trim(),
      description: skill.description.trim(),
      command: skill.command.trim(),
    }))
    .filter((skill) => skill.name.length > 0 || skill.description.length > 0 || skill.command.length > 0)
    .map((skill, index) => {
      if (!skill.name || !skill.command) {
        throw new Error(`Skill #${index + 1} requires both a name and command.`);
      }

      return {
        ...skill,
        id: skill.id || `skill-${index + 1}`,
      };
    });
}

export function createMemberConfigDraft(member: TeamMember): MemberConfigDraft {
  return {
    summary: member.summary,
    prompt: member.prompt,
    modelProfileId: member.modelProfileId,
    acceptsDirectMessages: member.acceptsDirectMessages,
    skills: member.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      command: skill.command,
    })),
  };
}

export function createWatcherDraft(watcher?: WatchSubscription): WatcherDraft {
  return {
    enabled: watcher?.enabled ?? false,
    intervalMinutes: watcher ? String(watcher.intervalMinutes) : "15",
  };
}

export function addEmptySkillDraft(skills: SkillDraft[]): SkillDraft[] {
  return [
    ...skills,
    {
      id: crypto.randomUUID(),
      name: "",
      description: "",
      command: "",
    },
  ];
}

export function buildProviderFromDraft(existingProvider: ProviderBinding, draft: ProviderConfigDraftFields): ProviderBinding {
  return {
    ...existingProvider,
    label: draft.providerLabel.trim(),
    command: draft.providerCommand.trim(),
    args: splitLines(draft.providerArgsText),
    workingDirectory: draft.providerWorkingDirectory.trim() || undefined,
    capabilities: splitCapabilities(draft.providerCapabilitiesText),
    env: parseEnvText(draft.providerEnvText),
  };
}

export function buildMemberConfigInput(member: TeamMember, draft: MemberConfigDraft): UpdateMemberConfigInput {
  return {
    memberId: member.id,
    summary: draft.summary.trim(),
    prompt: draft.prompt.trim(),
    modelProfileId: draft.modelProfileId?.trim() || undefined,
    acceptsDirectMessages: draft.acceptsDirectMessages,
    skills: toSkillDefinitions(draft.skills),
    provider: member.provider,
  };
}

export function buildWatcherConfigInput(memberId: string, draft: WatcherDraft): {
  memberId: string;
  enabled: boolean;
  intervalMinutes: number;
} {
  const intervalMinutes = Number(draft.intervalMinutes);

  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error("Watcher interval must be a positive number.");
  }

  return {
    memberId,
    enabled: draft.enabled,
    intervalMinutes: Math.round(intervalMinutes),
  };
}
