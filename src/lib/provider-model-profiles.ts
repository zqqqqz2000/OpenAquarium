import type {
  ACPProviderModelProfile,
  GlobalWorkspaceConfig,
  OpenAICompatibleProviderBinding,
  OpenAICompatibleProviderModelProfile,
  ProviderBinding,
  ProviderModelProfile,
} from "@/domain/model";
import { createCodexAcpProvider } from "@/lib/acp";

export const DEFAULT_CODEX_MODEL_PROFILE_ID = "model-codex-acp-default";
export const DEFAULT_OPENAI_COMPATIBLE_MODEL_PROFILE_ID = "model-openai-compatible-default";
export const DEFAULT_OPENAQUARIUM_CONFIG_DIRECTORY = "~/.config/openaquarium";

export function createDefaultOpenAICompatibleProviderModelProfile(): OpenAICompatibleProviderModelProfile {
  return {
    id: DEFAULT_OPENAI_COMPATIBLE_MODEL_PROFILE_ID,
    name: "OpenAI-Compatible API",
    description:
      "Template Studio chat via an OpenAI-compatible HTTP API using the Vercel AI SDK provider.",
    providerType: "openai-compatible",
    binding: {
      kind: "openai-compatible",
      label: "OpenAI-Compatible API",
      baseURL: "https://api.openai.com/v1",
      apiKeyEnvVar: "OPENAI_API_KEY",
      headersFormat: "kv",
      headers: {},
      extraBodyFormat: "json",
      extraBody: {},
      mcpServers: [],
    },
  };
}

export function isACPProviderModelProfile(profile: ProviderModelProfile): profile is ACPProviderModelProfile {
  return profile.providerType === "acp";
}

export function isOpenAICompatibleProviderModelProfile(
  profile: ProviderModelProfile,
): profile is OpenAICompatibleProviderModelProfile {
  return profile.providerType === "openai-compatible";
}

export function createDefaultProviderModelProfiles(): ProviderModelProfile[] {
  return [
    {
      id: DEFAULT_CODEX_MODEL_PROFILE_ID,
      name: "Codex ACP",
      description:
        "Default Codex ACP model profile for template editing and room members. Uses codex-acp >=0.7.0 for runtime model discovery.",
      providerType: "acp",
      binding: createCodexAcpProvider(),
    },
    createDefaultOpenAICompatibleProviderModelProfile(),
  ];
}

export function createDefaultGlobalWorkspaceConfig(
  directory = DEFAULT_OPENAQUARIUM_CONFIG_DIRECTORY,
): GlobalWorkspaceConfig {
  const modelProfiles = createDefaultProviderModelProfiles();

  return {
    directory,
    modelProfiles,
    templateChatModelProfileId:
      modelProfiles[0]?.id ?? DEFAULT_CODEX_MODEL_PROFILE_ID,
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
  fallbackProvider: ProviderBinding | OpenAICompatibleProviderBinding,
  modelProfiles: ProviderModelProfile[],
  profileId?: string,
): ProviderBinding | OpenAICompatibleProviderBinding {
  const profile = findProviderModelProfile(modelProfiles, profileId);
  return profile?.binding ?? fallbackProvider;
}
