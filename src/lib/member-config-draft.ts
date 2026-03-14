import type {
  CodexThinkingDepth,
  ProviderBinding,
  ProviderModelProfileId,
  TeamMember,
  UpdateMemberConfigInput,
  WatchSubscription,
} from "@/domain/model";
import { normalizeAllowedSkillIds } from "@/lib/skills";

export interface ProviderConfigDraftFields {
  providerLabel: string;
  providerCommand: string;
  providerArgsText: string;
  providerCapabilitiesText: string;
  providerWorkingDirectory: string;
  providerEnvText: string;
}

export interface MemberConfigDraft {
  isRole: boolean;
  summary: string;
  prompt: string;
  modelProfileId?: ProviderModelProfileId;
  modelId?: string;
  codexThinkingDepth?: CodexThinkingDepth;
  allowedSkillIdsText: string;
}

export interface WatcherDraft {
  enabled: boolean;
  intervalMinutes: string;
  persistent?: boolean;
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

export function parseAllowedSkillIdsText(text: string): string[] {
  return normalizeAllowedSkillIds(text.split(/[,\n]/u));
}

export function createMemberConfigDraft(member: TeamMember): MemberConfigDraft {
  const allowedSkillIds = member.allowedSkillIds ?? [];

  return {
    isRole: member.isRole === true,
    summary: member.summary,
    prompt: member.prompt,
    modelProfileId: member.modelProfileId,
    modelId: member.modelId,
    codexThinkingDepth: member.codexThinkingDepth,
    allowedSkillIdsText: allowedSkillIds.join("\n"),
  };
}

export function createWatcherDraft(watcher?: WatchSubscription): WatcherDraft {
  return {
    enabled: watcher?.enabled ?? false,
    intervalMinutes: watcher ? String(watcher.intervalMinutes) : "15",
    persistent: watcher?.persistent ?? false,
  };
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
    isRole: draft.isRole,
    summary: draft.summary.trim(),
    prompt: draft.prompt.trim(),
    modelProfileId: draft.modelProfileId?.trim() || undefined,
    modelId: draft.modelId?.trim() || undefined,
    acceptsDirectMessages: true,
    codexThinkingDepth: draft.codexThinkingDepth,
    allowedSkillIds: parseAllowedSkillIdsText(draft.allowedSkillIdsText),
    provider: member.provider,
  };
}

export function buildWatcherConfigInput(memberId: string, draft: WatcherDraft): {
  memberId: string;
  enabled: boolean;
  intervalMinutes: number;
  persistent?: boolean;
} {
  const intervalMinutes = Number(draft.intervalMinutes);

  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    throw new Error("Watcher interval must be a positive number.");
  }

  return {
    memberId,
    enabled: draft.enabled,
    intervalMinutes: Math.round(intervalMinutes),
    persistent: draft.persistent ?? false,
  };
}
