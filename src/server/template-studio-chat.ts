import path from "node:path";

import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import { convertToModelMessages, generateText } from "ai";

import type {
  GlobalWorkspaceConfig,
  ProviderModelProfile,
  TeamTemplate,
  TemplateStudioChatMessage,
} from "@/domain/model";
import { findProviderModelProfile } from "@/lib/provider-model-profiles";

export interface TemplateStudioChatRequest {
  configDirectory: string;
  templateId: string;
  messages: TemplateStudioChatMessage[];
  templates: TeamTemplate[];
  globalConfig: GlobalWorkspaceConfig;
  modelProfileId?: string;
}

export interface TemplateStudioChatResult {
  assistantMessage: string;
  modelProfileId: string;
}

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
    "You edit OpenAquarium's global template files.",
    "Use the ACP session's normal file-editing ability in the working directory. Do not invent file contents from memory.",
    "",
    "[Scope]",
    `Selected template id: ${args.templateId}`,
    `Config directory: ${args.configDirectory}`,
    `Working directory: ${args.selectedProfile.binding.workingDirectory ?? args.configDirectory}`,
    `Templates file: ${templatesFilePath}`,
    `Template schema file: ${schemaFilePath}`,
    `Config file: ${configFilePath}`,
    `Current chat model profile: ${args.selectedProfile.name}`,
    "",
    "[Rules]",
    "1. Read template.schema.json and templates.json before writing changes.",
    "2. Unless the user explicitly asks otherwise, only change the selected template.",
    "3. Keep template ids and member ids stable unless the user explicitly asks to rename or create them.",
    "4. Every skill object must include id, name, description, and command.",
    "5. Keep templates.json valid JSON and compatible with the schema.",
    "6. Do not edit config.json unless the user explicitly asks to change global model configuration.",
    "7. When finished, reply with a short summary of what changed and which template ids were affected.",
    "",
    "[Interpretation]",
    "1. Treat short user requests as patch instructions for the selected team template.",
    "2. Match existing members by name, handle, or obvious role labels when the intent is unambiguous.",
    "3. For new members or new team templates, infer omitted required fields from the closest existing template/member and keep model profile/provider defaults stable unless the user asks to change them.",
    "4. Prefer the smallest edit that satisfies the request. Do not rewrite unrelated templates or unrelated members.",
    "5. If a request is slightly ambiguous, make the most reasonable minimal edit and briefly state what you inferred.",
    "",
    "[Examples]",
    'User: "把 checker 改成 QA reviewer"',
    "Meaning: update the selected member in the selected team template without changing unrelated ids or global model config.",
    'User: "加一个 scribe 负责总结"',
    "Meaning: add a member to the selected team template and infer any omitted schema-required fields from nearby defaults.",
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

export interface TemplateStudioChatServiceLike {
  chat(input: TemplateStudioChatRequest): Promise<TemplateStudioChatResult>;
  dispose(): Promise<void>;
}

export class TemplateStudioChatService implements TemplateStudioChatServiceLike {
  async chat(input: TemplateStudioChatRequest): Promise<TemplateStudioChatResult> {
    const selectedProfile =
      findProviderModelProfile(input.globalConfig.modelProfiles, input.modelProfileId)
      ?? findProviderModelProfile(input.globalConfig.modelProfiles, input.globalConfig.templateChatModelProfileId)
      ?? input.globalConfig.modelProfiles[0];

    if (!selectedProfile) {
      throw new Error("Template Studio requires at least one configured model profile.");
    }

    const messages = normalizeChatMessages(input.messages);
    if (messages.length === 0) {
      throw new Error("Template Studio chat requires at least one message.");
    }

    const provider = createACPProvider({
      command: selectedProfile.binding.command,
      args: selectedProfile.binding.args,
      env: selectedProfile.binding.env,
      session: {
        cwd: selectedProfile.binding.workingDirectory ?? input.configDirectory,
        mcpServers: [],
      },
    });
    const model = provider.languageModel();

    try {
      const modelMessages = await convertToModelMessages(
        messages.map((message) => ({
          role: message.role,
          parts: [
            {
              type: "text" as const,
              text: message.content,
            },
          ],
        })),
        {
          ignoreIncompleteToolCalls: true,
        },
      );
      const result = await generateText({
        model,
        system: buildTemplateStudioSystemPrompt({
          configDirectory: input.configDirectory,
          templateId: input.templateId,
          templates: input.templates,
          selectedProfile,
        }),
        messages: modelMessages,
      });

      return {
        assistantMessage: result.text.trim(),
        modelProfileId: selectedProfile.id,
      };
    } finally {
      provider.cleanup();
    }
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
