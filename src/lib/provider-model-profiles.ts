import type { GlobalWorkspaceConfig, ProviderBinding, ProviderModelProfile } from "@/domain/model";
import { createCodexAcpProvider } from "@/lib/acp";

export const DEFAULT_CODEX_MODEL_PROFILE_ID = "model-codex-acp-default";
export const DEFAULT_OPENAQUARIUM_CONFIG_DIRECTORY = "~/.config/openaquarium";

export function createDefaultProviderModelProfiles(): ProviderModelProfile[] {
  return [
    {
      id: DEFAULT_CODEX_MODEL_PROFILE_ID,
      name: "Codex ACP",
      description: "Default Codex ACP model profile for template editing and room members.",
      providerType: "acp",
      binding: createCodexAcpProvider(),
    },
  ];
}

export function createDefaultGlobalWorkspaceConfig(
  directory = DEFAULT_OPENAQUARIUM_CONFIG_DIRECTORY,
): GlobalWorkspaceConfig {
  const modelProfiles = createDefaultProviderModelProfiles();

  return {
    directory,
    modelProfiles,
    templateChatModelProfileId: modelProfiles[0]?.id ?? DEFAULT_CODEX_MODEL_PROFILE_ID,
  };
}

export function findProviderModelProfile(
  modelProfiles: ProviderModelProfile[],
  profileId?: string,
): ProviderModelProfile | undefined {
  if (!profileId) {
    return undefined;
  }

  return modelProfiles.find((profile) => profile.id === profileId);
}

export function resolveProviderBindingFromProfile(
  fallbackProvider: ProviderBinding,
  modelProfiles: ProviderModelProfile[],
  profileId?: string,
): ProviderBinding {
  return findProviderModelProfile(modelProfiles, profileId)?.binding ?? fallbackProvider;
}
