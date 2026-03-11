import type { GlobalWorkspaceConfig, ProviderKind, ProviderModelProfile, UpdateGlobalConfigInput } from "@/domain/model";
import {
  parseEnvText,
  splitCapabilities,
  splitLines,
  type ProviderConfigDraftFields,
} from "@/lib/member-config-draft";

export interface ModelProfileDraft extends ProviderConfigDraftFields {
  id: string;
  name: string;
  description: string;
  providerKind: ProviderKind;
}

export interface GlobalConfigDraft {
  modelProfiles: ModelProfileDraft[];
  templateChatModelProfileId?: string;
}

export function createModelProfileDraft(profile: ProviderModelProfile): ModelProfileDraft {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    providerKind: profile.binding.kind,
    providerLabel: profile.binding.label,
    providerCommand: profile.binding.command,
    providerArgsText: profile.binding.args.join("\n"),
    providerCapabilitiesText: profile.binding.capabilities.join(", "),
    providerWorkingDirectory: profile.binding.workingDirectory ?? "",
    providerEnvText: Object.entries(profile.binding.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  };
}

export function createGlobalConfigDraft(config: GlobalWorkspaceConfig): GlobalConfigDraft {
  return {
    modelProfiles: config.modelProfiles.map((profile) => createModelProfileDraft(profile)),
    templateChatModelProfileId: config.templateChatModelProfileId ?? config.modelProfiles[0]?.id,
  };
}

export function addEmptyModelProfileDraft(): ModelProfileDraft {
  return {
    id: `model-${crypto.randomUUID()}`,
    name: "New model profile",
    description: "Describe when this profile should be used.",
    providerKind: "codex-acp",
    providerLabel: "ACP provider",
    providerCommand: "",
    providerArgsText: "",
    providerCapabilitiesText: "prompt, cancel",
    providerWorkingDirectory: "",
    providerEnvText: "",
  };
}

export function buildGlobalConfigInput(current: GlobalWorkspaceConfig, draft: GlobalConfigDraft): UpdateGlobalConfigInput {
  const modelProfiles = draft.modelProfiles.map((profile) => {
    const existing = current.modelProfiles.find((candidate) => candidate.id === profile.id);
    const fallbackBinding = existing?.binding ?? {
      kind: "codex-acp" as const,
      label: "ACP provider",
      command: "",
      args: [],
      env: {},
      capabilities: ["prompt", "cancel"],
    };

    return {
      id: profile.id.trim(),
      name: profile.name.trim(),
      description: profile.description.trim(),
      providerType: "acp" as const,
      binding: {
        ...fallbackBinding,
        kind: profile.providerKind,
        label: profile.providerLabel.trim(),
        command: profile.providerCommand.trim(),
        args: splitLines(profile.providerArgsText),
        capabilities: splitCapabilities(profile.providerCapabilitiesText),
        workingDirectory: profile.providerWorkingDirectory.trim() || undefined,
        env: parseEnvText(profile.providerEnvText),
      },
    };
  });

  return {
    modelProfiles,
    templateChatModelProfileId: draft.templateChatModelProfileId?.trim() || modelProfiles[0]?.id,
  };
}
