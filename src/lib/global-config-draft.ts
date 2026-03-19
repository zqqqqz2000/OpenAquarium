import type {
  ProviderKind,
  GlobalWorkspaceConfig,
  OpenAICompatibleMCPServer,
  OpenAICompatibleModelLimit,
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
  providerMcpServers: OpenAICompatibleMCPServer[];
  providerModelLimitsText: string;
  providerCompactionModelId: string;
  providerCompactionReservedTokens: string;
  providerCompactionOffloadThresholdChars: string;
}

export interface GlobalConfigDraft {
  modelProfiles: ModelProfileDraft[];
  templateChatModelProfileId?: string;
}

function cloneMcpServer(server: OpenAICompatibleMCPServer): OpenAICompatibleMCPServer {
  if (server.transport === "stdio") {
    return {
      ...server,
      args: [...server.args],
      env: { ...server.env },
    };
  }

  return {
    ...server,
    headers: { ...server.headers },
  };
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
      providerMcpServers: profile.binding.mcpServers.map(cloneMcpServer),
      providerModelLimitsText: JSON.stringify(profile.binding.modelLimits ?? {}, null, 2),
      providerCompactionModelId: profile.binding.compactionModelId ?? "",
      providerCompactionReservedTokens: String(profile.binding.compactionReservedTokens ?? 20_000),
      providerCompactionOffloadThresholdChars: String(profile.binding.compactionOffloadThresholdChars ?? 12_000),
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
    providerMcpServers: [],
    providerModelLimitsText: "{}",
    providerCompactionModelId: "",
    providerCompactionReservedTokens: "",
    providerCompactionOffloadThresholdChars: "",
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
    providerMcpServers: [],
    providerModelLimitsText: "{}",
    providerCompactionModelId: "",
    providerCompactionReservedTokens: "",
    providerCompactionOffloadThresholdChars: "",
  };
}

function parseModelLimitsText(value: string): Record<string, OpenAICompatibleModelLimit> {
  const normalized = value.trim();
  if (!normalized) {
    return {};
  }

  const parsed = JSON.parse(normalized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model limits must be a JSON object keyed by model id.");
  }

  return parsed as Record<string, OpenAICompatibleModelLimit>;
}

function parseNonNegativeInteger(value: string, fallback: number): number {
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }

  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Expected a non-negative integer.");
  }

  return parsed;
}

function parsePositiveInteger(value: string, fallback: number): number {
  const parsed = parseNonNegativeInteger(value, fallback);
  if (parsed <= 0) {
    throw new Error("Expected a positive integer.");
  }

  return parsed;
}

function stringifyHeaderValue(value: unknown): string {
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || value === null
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}

export function buildProviderModelProfileFromDraft(args: {
  draft: ModelProfileDraft;
  existing?: ProviderModelProfile;
}): ProviderModelProfile {
  const { draft, existing } = args;

  if (draft.providerType === "openai-compatible") {
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
            modelLimits: {},
            compactionReservedTokens: 20_000,
            compactionOffloadThresholdChars: 12_000,
          };

    return {
      id: draft.id.trim(),
      name: draft.name.trim(),
      description: draft.description.trim(),
      providerType: "openai-compatible",
      binding: {
        ...fallbackBinding,
        label: draft.providerLabel.trim(),
        baseURL: draft.providerBaseUrl.trim(),
        apiKeyEnvVar: draft.providerApiKeyEnvVar.trim() || undefined,
        headersFormat: draft.providerHeadersFormat,
        headers:
          draft.providerHeadersFormat === "json"
            ? Object.fromEntries(
                Object.entries(parseJsonObjectText(draft.providerHeadersText)).map(([key, value]) => [key, stringifyHeaderValue(value)]),
              )
            : parseEnvText(draft.providerHeadersText),
        extraBodyFormat: draft.providerExtraBodyFormat,
        extraBody:
          draft.providerExtraBodyFormat === "json"
            ? parseJsonObjectText(draft.providerExtraBodyText)
            : parseEnvText(draft.providerExtraBodyText),
        mcpServers: draft.providerMcpServers.map(cloneMcpServer),
        modelLimits: parseModelLimitsText(draft.providerModelLimitsText),
        compactionModelId: draft.providerCompactionModelId.trim() || undefined,
        compactionReservedTokens: parseNonNegativeInteger(
          draft.providerCompactionReservedTokens,
          fallbackBinding.compactionReservedTokens ?? 20_000,
        ),
        compactionOffloadThresholdChars: parsePositiveInteger(
          draft.providerCompactionOffloadThresholdChars,
          fallbackBinding.compactionOffloadThresholdChars ?? 12_000,
        ),
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
    id: draft.id.trim(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    providerType: "acp",
    binding: {
      ...fallbackBinding,
      kind: draft.providerKind as ProviderKind,
      label: draft.providerLabel.trim(),
      command: draft.providerCommand.trim(),
      args: splitLines(draft.providerArgsText),
      capabilities: splitCapabilities(draft.providerCapabilitiesText),
      workingDirectory: draft.providerWorkingDirectory.trim() || undefined,
      env: parseEnvText(draft.providerEnvText),
    },
  };
}

export function buildGlobalConfigInput(current: GlobalWorkspaceConfig, draft: GlobalConfigDraft): UpdateGlobalConfigInput {
  const modelProfiles = draft.modelProfiles.map((profile) =>
    buildProviderModelProfileFromDraft({
      draft: profile,
      existing: current.modelProfiles.find((candidate) => candidate.id === profile.id),
    }));

  return {
    modelProfiles,
    templateChatModelProfileId: draft.templateChatModelProfileId?.trim() || modelProfiles[0]?.id,
  };
}
