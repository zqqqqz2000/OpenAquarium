import type {
  ProviderKind,
  GlobalWorkspaceConfig,
  OpenAICompatibleMCPServer,
  ProviderModelProfile,
  ProviderProfileKind,
  ProviderProfileType,
  UpdateGlobalConfigInput,
} from "@/domain/model";
import {
  parseEnvText,
  parseJsonObjectText,
  splitCapabilities,
  splitLines,
  type ProviderConfigDraftFields,
} from "@/lib/member-config-draft";

export interface ModelProfileDraft extends ProviderConfigDraftFields {
  id: string;
  name: string;
  description: string;
  providerType: ProviderProfileType;
  providerKind: ProviderProfileKind;
  providerBaseUrl: string;
  providerApiKeyEnvVar: string;
  providerHeadersFormat: "kv" | "json";
  providerHeadersText: string;
  providerExtraBodyFormat: "kv" | "json";
  providerExtraBodyText: string;
  providerMcpServersText: string;
}

export interface GlobalConfigDraft {
  modelProfiles: ModelProfileDraft[];
  templateChatModelProfileId?: string;
}

export function createModelProfileDraft(profile: ProviderModelProfile): ModelProfileDraft {
  if (profile.providerType === "openai-compatible") {
    return {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      providerType: profile.providerType,
      providerKind: profile.binding.kind,
      providerLabel: profile.binding.label,
      providerCommand: "",
      providerArgsText: "",
      providerCapabilitiesText: "",
      providerWorkingDirectory: "",
      providerEnvText: "",
      providerBaseUrl: profile.binding.baseURL,
      providerApiKeyEnvVar: profile.binding.apiKeyEnvVar ?? "",
      providerHeadersFormat: profile.binding.headersFormat,
      providerHeadersText:
        profile.binding.headersFormat === "json"
          ? JSON.stringify(profile.binding.headers, null, 2)
          : Object.entries(profile.binding.headers)
            .map(([key, value]) => `${key}=${value}`)
            .join("\n"),
      providerExtraBodyFormat: profile.binding.extraBodyFormat,
      providerExtraBodyText:
        profile.binding.extraBodyFormat === "json"
          ? JSON.stringify(profile.binding.extraBody, null, 2)
          : Object.entries(profile.binding.extraBody)
            .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
            .join("\n"),
      providerMcpServersText: JSON.stringify(profile.binding.mcpServers, null, 2),
    };
  }

  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    providerType: profile.providerType,
    providerKind: profile.binding.kind,
    providerLabel: profile.binding.label,
    providerCommand: profile.binding.command,
    providerArgsText: profile.binding.args.join("\n"),
    providerCapabilitiesText: profile.binding.capabilities.join(", "),
    providerWorkingDirectory: profile.binding.workingDirectory ?? "",
    providerEnvText: Object.entries(profile.binding.env)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    providerBaseUrl: "",
    providerApiKeyEnvVar: "",
    providerHeadersFormat: "kv",
    providerHeadersText: "",
    providerExtraBodyFormat: "json",
    providerExtraBodyText: "",
    providerMcpServersText: "[]",
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
    providerType: "acp",
    providerKind: "codex-acp",
    providerLabel: "ACP provider",
    providerCommand: "",
    providerArgsText: "",
    providerCapabilitiesText: "prompt, cancel",
    providerWorkingDirectory: "",
    providerEnvText: "",
    providerBaseUrl: "",
    providerApiKeyEnvVar: "",
    providerHeadersFormat: "kv",
    providerHeadersText: "",
    providerExtraBodyFormat: "json",
    providerExtraBodyText: "",
    providerMcpServersText: "[]",
  };
}

function parseMcpServersText(value: string): OpenAICompatibleMCPServer[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }

  const parsed = JSON.parse(normalized) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("MCP servers must be a JSON array.");
  }

  return parsed as OpenAICompatibleMCPServer[];
}

export function buildGlobalConfigInput(current: GlobalWorkspaceConfig, draft: GlobalConfigDraft): UpdateGlobalConfigInput {
  const modelProfiles = draft.modelProfiles.map((profile) => {
    const existing = current.modelProfiles.find((candidate) => candidate.id === profile.id);
    if (profile.providerType === "openai-compatible") {
      const fallbackBinding =
        existing?.providerType === "openai-compatible"
          ? existing.binding
          : {
              kind: "openai-compatible" as const,
              label: "OpenAI-Compatible API",
              baseURL: "https://api.openai.com/v1",
              headersFormat: "kv" as const,
              headers: {},
              extraBodyFormat: "json" as const,
              extraBody: {},
              mcpServers: [],
            };

      return {
        id: profile.id.trim(),
        name: profile.name.trim(),
        description: profile.description.trim(),
        providerType: "openai-compatible" as const,
        binding: {
          ...fallbackBinding,
          label: profile.providerLabel.trim(),
          baseURL: profile.providerBaseUrl.trim(),
          apiKeyEnvVar: profile.providerApiKeyEnvVar.trim() || undefined,
          headersFormat: profile.providerHeadersFormat,
          headers:
            profile.providerHeadersFormat === "json"
              ? Object.fromEntries(
                  Object.entries(parseJsonObjectText(profile.providerHeadersText)).map(([key, value]) => [key, String(value)]),
                )
              : parseEnvText(profile.providerHeadersText),
          extraBodyFormat: profile.providerExtraBodyFormat,
          extraBody:
            profile.providerExtraBodyFormat === "json"
              ? parseJsonObjectText(profile.providerExtraBodyText)
              : parseEnvText(profile.providerExtraBodyText),
          mcpServers: parseMcpServersText(profile.providerMcpServersText),
        },
      };
    }

    const fallbackBinding =
      existing?.providerType === "acp"
        ? existing.binding
        : {
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
        kind: profile.providerKind as ProviderKind,
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
