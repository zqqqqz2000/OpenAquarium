import path from "node:path";

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { Tool } from "@ai-sdk/provider-utils";
import { createACPProvider, type ModelInfo } from "@mcpc-tech/acp-ai-provider";
import { convertToModelMessages, generateText, streamText, type UIMessageChunk } from "ai";
import * as z from "zod";

import type {
  GlobalWorkspaceConfig,
  ProviderConnectionTestResult,
  ProviderModelProfile,
  TeamTemplate,
  TemplateStudioModelCatalog,
  TemplateStudioModelOption,
  TemplateStudioChatMessage,
} from "@/domain/model";
import type { TemplateStudioChatDataParts, TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";
import { findProviderModelProfile } from "@/lib/provider-model-profiles";
import { createConfiguredMcpTools } from "@/server/openai-compatible-mcp";
import {
  buildOpenAICompatibleRequestHeaders,
  buildOpenAICompatibleUrl,
  createOpenAICompatibleProvider,
} from "@/server/openai-compatible-provider";

export interface TemplateStudioChatRequest {
  configDirectory: string;
  templateId: string;
  messages: TemplateStudioChatMessage[];
  templates: TeamTemplate[];
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
  modelId?: string;
}

export interface TemplateStudioChatResult {
  assistantMessage: string;
  modelProfileId: string;
  modelId?: string;
}

export interface TemplateStudioChatStreamRequest {
  configDirectory: string;
  templateId: string;
  messages: TemplateStudioUIMessage[];
  templates: TeamTemplate[];
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
  modelId?: string;
  abortSignal?: AbortSignal;
}

export interface TemplateStudioChatStreamResult {
  consumeStream(): PromiseLike<void>;
  toUIMessageStream(options: {
    originalMessages?: TemplateStudioUIMessage[];
    sendReasoning?: boolean;
    sendSources?: boolean;
  }): ReadableStream<UIMessageChunk<unknown, TemplateStudioChatDataParts>>;
}

export interface TemplateStudioChatStreamRun {
  result: TemplateStudioChatStreamResult;
  modelProfileId: string;
  modelId?: string;
  cleanup(): Promise<void>;
}

export interface TemplateStudioModelCatalogRequest {
  configDirectory: string;
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
}

export interface ProviderProfileModelCatalogRequest {
  configDirectory: string;
  profile: ProviderModelProfile;
}

export interface ProviderProfileTestRequest {
  configDirectory: string;
  profile: ProviderModelProfile;
  modelId?: string;
  prompt: string;
}

const openAICompatibleModelCatalogSchema = z.object({
  data: z.array(
    z.object({
      id: z.string().min(1),
      owned_by: z.string().optional(),
    }),
  ),
});

type TemplateStudioLanguageProvider = {
  languageModel(modelId: string): LanguageModelV3;
  tools: Record<string, Tool>;
  cleanup(): void | Promise<void>;
};

function describeTemplates(templates: TeamTemplate[]): string {
  return JSON.stringify(
    templates.map((template) => ({
      id: template.id,
      name: template.name,
      members: template.members.map((member) => ({
        id: member.id,
        handle: member.handle,
        modelProfileId: member.modelProfileId,
      })),
    })),
    null,
    2,
  );
}

function describeSelectedTemplate(template: TeamTemplate | undefined): string {
  if (!template) {
    return "Selected team template not found in current templates.";
  }

  return JSON.stringify(
    {
      id: template.id,
      name: template.name,
      description: template.description,
      members: template.members.map((member) => ({
        id: member.id,
        name: member.name,
        handle: member.handle,
        summary: member.summary,
        modelProfileId: member.modelProfileId,
      })),
    },
    null,
    2,
  );
}

function buildTemplateStudioSystemPrompt(args: {
  configDirectory: string;
  templateId: string;
  templates: TeamTemplate[];
  selectedProfile: ProviderModelProfile;
}): string {
  const selectedTemplate = args.templates.find((template) => template.id === args.templateId);
  const templatesFilePath = path.join(args.configDirectory, "templates.json");
  const configFilePath = path.join(args.configDirectory, "config.json");
  const schemaFilePath = path.join(args.configDirectory, "template.schema.json");

  return [
    "[OA_TEMPLATE_STUDIO]",
    "Edit OpenAquarium team templates by changing the real files in the working directory.",
    "Read template.schema.json and templates.json before editing. Do not invent file contents from memory.",
    "",
    "[Context]",
    `Selected template id: ${args.templateId}`,
    `Config directory: ${args.configDirectory}`,
    `Working directory: ${
      args.selectedProfile.providerType === "acp"
        ? (args.selectedProfile.binding.workingDirectory ?? args.configDirectory)
        : args.configDirectory
    }`,
    `Templates file: ${templatesFilePath}`,
    `Template schema file: ${schemaFilePath}`,
    `Config file: ${configFilePath}`,
    `Current chat model profile: ${args.selectedProfile.name}`,
    "",
    "[Rules]",
    "1. By default, edit only the selected template. If the user explicitly asks for a new template or a different template, do that.",
    "2. Keep template ids and member ids stable unless the user asks to create or rename them.",
    "3. Keep templates.json valid JSON and compatible with the schema.",
    "4. Member skills must be represented with allowedSkillIds as an array of skill id strings. Do not write legacy skills objects unless the file already uses them and you are preserving compatibility during a minimal edit.",
    "5. Do not edit config.json unless the user explicitly asks for global model changes.",
    "6. Prefer the smallest change that satisfies the request.",
    "7. For new members or templates, infer missing required fields from the closest existing template/member and keep provider/model defaults stable unless asked otherwise.",
    "8. When finished, reply briefly with what changed and which template ids were affected.",
    "",
    "[Selected Team Template]",
    describeSelectedTemplate(selectedTemplate),
    "",
    "[Current Team Templates]",
    describeTemplates(args.templates),
  ].join("\n");
}

function normalizeChatMessages(messages: TemplateStudioChatMessage[]): TemplateStudioChatMessage[] {
  return messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function resolveSelectedProfile(args: {
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
}): ProviderModelProfile | undefined {
  return (
    findProviderModelProfile(args.globalConfig.modelProfiles, args.modelProfileId)
    ?? findProviderModelProfile(args.globalConfig.modelProfiles, args.globalConfig.templateChatModelProfileId)
    ?? args.globalConfig.modelProfiles[0]
  );
}

function mapRuntimeModel(model: ModelInfo): TemplateStudioModelOption {
  return {
    id: model.modelId,
    label: model.name,
    description: model.description ?? undefined,
  };
}

function buildUnavailableCatalog(args: {
  selectedProfile: ProviderModelProfile;
  unavailableMessage: string;
}): TemplateStudioModelCatalog {
  return {
    source: "unavailable",
    providerType: args.selectedProfile.providerType,
    providerKind: args.selectedProfile.binding.kind,
    providerLabel: args.selectedProfile.binding.label,
    selectedProfileId: args.selectedProfile.id,
    currentModelId: undefined,
    unavailableMessage: args.unavailableMessage,
    availableModels: [],
  };
}

async function cleanupProvider(provider: { cleanup: () => void | Promise<void> }): Promise<void> {
  try {
    await provider.cleanup();
  } catch {
    // Cleanup failures should not replace the primary runtime-model error path.
  }
}

function getOptionalToolSet(tools: Record<string, Tool>): Record<string, Tool> | undefined {
  return Object.keys(tools).length > 0 ? tools : undefined;
}

async function loadTemplateStudioModelCatalog(args: TemplateStudioModelCatalogRequest): Promise<TemplateStudioModelCatalog> {
  const selectedProfile = resolveSelectedProfile(args);
  if (!selectedProfile) {
    throw new Error("Template Studio requires at least one configured model profile.");
  }

  return loadModelCatalogForProfile({
    configDirectory: args.configDirectory,
    profile: selectedProfile,
  });
}

async function loadModelCatalogForProfile(args: ProviderProfileModelCatalogRequest): Promise<TemplateStudioModelCatalog> {
  const { configDirectory, profile } = args;

  if (profile.providerType === "openai-compatible") {
    try {
      const response = await fetch(buildOpenAICompatibleUrl(profile.binding.baseURL, "/models"), {
        headers: buildOpenAICompatibleRequestHeaders(profile.binding),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} when loading models`);
      }

      const parsed = openAICompatibleModelCatalogSchema.parse(await response.json());
      const availableModels = parsed.data.map((model) => ({
        id: model.id,
        label: model.id,
        description: model.owned_by ? `owned by ${model.owned_by}` : undefined,
      }));

      if (availableModels.length > 0) {
        return {
          source: "runtime",
          providerType: profile.providerType,
          providerKind: profile.binding.kind,
          providerLabel: profile.binding.label,
          selectedProfileId: profile.id,
          currentModelId: undefined,
          availableModels,
        };
      }

      return buildUnavailableCatalog({
        selectedProfile: profile,
        unavailableMessage: "Runtime model capability unavailable: /models returned no available models.",
      });
    } catch (error) {
      return buildUnavailableCatalog({
        selectedProfile: profile,
        unavailableMessage: `Runtime model capability unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const provider = createACPProvider({
    command: profile.binding.command,
    args: profile.binding.args,
    env: profile.binding.env,
    session: {
      cwd: profile.binding.workingDirectory ?? configDirectory,
      mcpServers: [],
    },
  });

  try {
    const session = await provider.initSession();
    const availableModels = session.models?.availableModels?.map(mapRuntimeModel) ?? [];

    if (availableModels.length > 0) {
      return {
        source: "runtime",
        providerType: profile.providerType,
        providerKind: profile.binding.kind,
        providerLabel: profile.binding.label,
        selectedProfileId: profile.id,
        currentModelId: session.models?.currentModelId,
        availableModels,
      };
    }

    return buildUnavailableCatalog({
      selectedProfile: profile,
      unavailableMessage: "Runtime model capability unavailable: session returned no available models.",
    });
  } catch (error) {
    return buildUnavailableCatalog({
      selectedProfile: profile,
      unavailableMessage: `Runtime model capability unavailable: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    await cleanupProvider(provider);
  }
}

async function createLanguageProviderForProfile(args: {
  configDirectory: string;
  selectedProfile: ProviderModelProfile;
  modelId?: string;
}): Promise<{
  provider: TemplateStudioLanguageProvider;
  modelId: string;
}> {
  const { configDirectory, selectedProfile } = args;

  if (selectedProfile.providerType === "openai-compatible") {
    if (!args.modelId?.trim()) {
      throw new Error("OpenAI-compatible provider requires a model id.");
    }

    const provider = createOpenAICompatibleProvider(selectedProfile.binding);
    const mcpTools = await createConfiguredMcpTools({
      binding: selectedProfile.binding,
      defaultWorkingDirectory: configDirectory,
    });

    return {
      provider: {
        languageModel: (modelId: string) => provider.languageModel(modelId),
        tools: mcpTools.tools,
        cleanup: () => mcpTools.close(),
      },
      modelId: args.modelId.trim(),
    };
  }

  const provider = createACPProvider({
    command: selectedProfile.binding.command,
    args: selectedProfile.binding.args,
    env: selectedProfile.binding.env,
    session: {
      cwd: selectedProfile.binding.workingDirectory ?? configDirectory,
      mcpServers: [],
    },
  });

  return {
    provider: {
      languageModel: (modelId: string) => provider.languageModel(modelId || undefined),
      tools: {},
      cleanup: () => provider.cleanup(),
    },
    modelId: args.modelId?.trim() || "",
  };
}

function buildProviderTestSystemPrompt(): string {
  return [
    "You are running an OpenAquarium provider connectivity check.",
    "Reply in plain text with exactly one short sentence.",
    "Do not use markdown.",
    "Do not call tools during this check.",
  ].join("\n");
}

async function resolveChatExecution(args: {
  configDirectory: string;
  templateId: string;
  templates: TeamTemplate[];
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
  modelId?: string;
  messages: TemplateStudioUIMessage[];
}): Promise<{
  selectedProfile: ProviderModelProfile;
  provider: TemplateStudioLanguageProvider;
  modelMessages: Awaited<ReturnType<typeof convertToModelMessages>>;
  modelId: string;
}> {
  const selectedProfile = resolveSelectedProfile(args);

  if (!selectedProfile) {
    throw new Error("Template Studio requires at least one configured model profile.");
  }

  if (args.messages.length === 0) {
    throw new Error("Template Studio chat requires at least one message.");
  }

  const modelMessages = await convertToModelMessages(args.messages, {
    ignoreIncompleteToolCalls: true,
  });
  const { provider, modelId } = await createLanguageProviderForProfile({
    configDirectory: args.configDirectory,
    selectedProfile,
    modelId: args.modelId,
  });

  return {
    selectedProfile,
    provider,
    modelMessages,
    modelId,
  };
}

export interface TemplateStudioChatServiceLike {
  chat(input: TemplateStudioChatRequest): Promise<TemplateStudioChatResult>;
  stream(input: TemplateStudioChatStreamRequest): Promise<TemplateStudioChatStreamRun>;
  getModelCatalog(input: TemplateStudioModelCatalogRequest): Promise<TemplateStudioModelCatalog>;
  getModelCatalogForProfile(input: ProviderProfileModelCatalogRequest): Promise<TemplateStudioModelCatalog>;
  testProfile(input: ProviderProfileTestRequest): Promise<ProviderConnectionTestResult>;
  dispose(): Promise<void>;
}

export class TemplateStudioChatService implements TemplateStudioChatServiceLike {
  async chat(input: TemplateStudioChatRequest): Promise<TemplateStudioChatResult> {
    const messages = normalizeChatMessages(input.messages).map((message, index) => ({
      id: `template-studio-legacy-${index}`,
      role: message.role,
      parts: [
        {
          type: "text" as const,
          text: message.content,
        },
      ],
    }));

    const { modelMessages, provider, selectedProfile, modelId } = await resolveChatExecution({
      configDirectory: input.configDirectory,
      templateId: input.templateId,
      templates: input.templates,
      globalConfig: input.globalConfig,
      modelProfileId: input.modelProfileId,
      modelId: input.modelId,
      messages,
    });
    const model = provider.languageModel(modelId);

    try {
      const result = await generateText({
        model,
        system: buildTemplateStudioSystemPrompt({
          configDirectory: input.configDirectory,
          templateId: input.templateId,
          templates: input.templates,
          selectedProfile,
        }),
        messages: modelMessages,
        tools: getOptionalToolSet(provider.tools),
      });

      return {
        assistantMessage: result.text.trim(),
        modelProfileId: selectedProfile.id,
        modelId: modelId || undefined,
      };
    } finally {
      await cleanupProvider(provider);
    }
  }

  async stream(input: TemplateStudioChatStreamRequest): Promise<TemplateStudioChatStreamRun> {
    const { modelMessages, provider, selectedProfile, modelId } = await resolveChatExecution({
      configDirectory: input.configDirectory,
      templateId: input.templateId,
      templates: input.templates,
      globalConfig: input.globalConfig,
      modelProfileId: input.modelProfileId,
      modelId: input.modelId,
      messages: input.messages,
    });
    const model = provider.languageModel(modelId);
    const result = streamText({
      model,
      system: buildTemplateStudioSystemPrompt({
        configDirectory: input.configDirectory,
        templateId: input.templateId,
        templates: input.templates,
        selectedProfile,
      }),
      messages: modelMessages,
      tools: getOptionalToolSet(provider.tools),
      abortSignal: input.abortSignal,
    });

    return {
      result,
      modelProfileId: selectedProfile.id,
      modelId: modelId || undefined,
      cleanup: () => cleanupProvider(provider),
    };
  }

  async getModelCatalog(input: TemplateStudioModelCatalogRequest): Promise<TemplateStudioModelCatalog> {
    return loadTemplateStudioModelCatalog(input);
  }

  async getModelCatalogForProfile(input: ProviderProfileModelCatalogRequest): Promise<TemplateStudioModelCatalog> {
    return loadModelCatalogForProfile(input);
  }

  async testProfile(input: ProviderProfileTestRequest): Promise<ProviderConnectionTestResult> {
    const { provider, modelId } = await createLanguageProviderForProfile({
      configDirectory: input.configDirectory,
      selectedProfile: input.profile,
      modelId: input.modelId,
    });
    const toolCount = Object.keys(provider.tools).length;
    const model = provider.languageModel(modelId);

    try {
      const result = await generateText({
        model,
        system: buildProviderTestSystemPrompt(),
        prompt: input.prompt,
        tools: getOptionalToolSet(provider.tools),
      });

      return {
        profileId: input.profile.id,
        providerType: input.profile.providerType,
        providerKind: input.profile.binding.kind,
        providerLabel: input.profile.binding.label,
        modelId: modelId || undefined,
        prompt: input.prompt,
        responseText: result.text.trim(),
        toolCount,
        testedAt: new Date().toISOString(),
      };
    } finally {
      await cleanupProvider(provider);
    }
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
