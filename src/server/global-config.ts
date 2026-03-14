import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as z from "zod";

import type { GlobalWorkspaceConfig, ProviderModelProfile, TeamTemplate } from "@/domain/model";
import { createDefaultProviderModelProfiles, DEFAULT_CODEX_MODEL_PROFILE_ID } from "@/lib/provider-model-profiles";
import { defaultTemplates } from "@/lib/sample-data/templates";
import { getErrorCode, type RuntimeError } from "@/server/error-utils";

const accentToneSchema = z.enum(["paper", "postit", "blueprint", "correction"]);

const persistedSkillSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
});

const skillSchema = persistedSkillSchema.extend({
  id: z.string().min(1),
});

const providerBindingSchema = z.object({
  kind: z.enum(["codex-acp", "generic-acp"]),
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string().min(1)).default([]),
  env: z.record(z.string(), z.string()).default({}),
  workingDirectory: z.string().optional(),
  capabilities: z.array(z.string().min(1)).default(["prompt", "cancel"]),
});

const codexThinkingDepthSchema = z.enum(["low", "mid", "high", "extra-high"]);

const persistedTeamMemberBlueprintSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  handle: z.string().min(1),
  summary: z.string().min(1),
  prompt: z.string().min(1),
  accentTone: accentToneSchema,
  modelProfileId: z.string().min(1).optional(),
  provider: providerBindingSchema,
  isEntryMember: z.boolean().optional(),
  observeAllRoomMessages: z.boolean().optional(),
  acceptsDirectMessages: z.boolean().optional(),
  codexThinkingDepth: codexThinkingDepthSchema.optional(),
  skills: z.array(persistedSkillSchema),
  watch: z
    .object({
      intervalMinutes: z.number().int().positive(),
      enabledByDefault: z.boolean(),
      persistent: z.boolean().optional(),
    })
    .optional(),
});

const teamMemberBlueprintSchema = persistedTeamMemberBlueprintSchema.extend({
  skills: z.array(skillSchema),
});

const persistedTeamTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  accentTone: accentToneSchema,
  defaultRoomMemberMessageFilter: z.enum(["all", "only-members", "hide-members"]).optional(),
  defaultVisibleMemberBlueprintIds: z.array(z.string().min(1)).optional(),
  members: z.array(persistedTeamMemberBlueprintSchema).min(1),
});

const teamTemplateSchema = persistedTeamTemplateSchema.extend({
  members: z.array(teamMemberBlueprintSchema).min(1),
});

const providerModelProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  providerType: z.literal("acp"),
  binding: providerBindingSchema,
});

const configFileSchema = z.object({
  version: z.literal(1),
  modelProfiles: z.array(providerModelProfileSchema),
  templateChatModelProfileId: z.string().min(1).optional(),
});

const persistedTemplatesFileSchema = z.array(persistedTeamTemplateSchema);
const templatesFileSchema = z.array(teamTemplateSchema);

interface PersistedConfigFile {
  version: 1;
  modelProfiles: ProviderModelProfile[];
  templateChatModelProfileId?: string;
}

const TEMPLATE_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "OpenAquarium Team Template",
  type: "array",
  items: {
    type: "object",
    required: ["id", "name", "description", "accentTone", "members"],
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      accentTone: { enum: ["paper", "postit", "blueprint", "correction"] },
      defaultVisibleMemberBlueprintIds: { type: "array", items: { type: "string" } },
      members: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: [
            "id",
            "name",
            "handle",
            "summary",
            "prompt",
            "accentTone",
            "provider",
            "skills",
          ],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            handle: { type: "string" },
            summary: { type: "string" },
            prompt: { type: "string" },
            accentTone: { enum: ["paper", "postit", "blueprint", "correction"] },
            modelProfileId: { type: "string" },
            isEntryMember: { type: "boolean" },
            acceptsDirectMessages: { type: "boolean" },
            codexThinkingDepth: { enum: ["low", "mid", "high", "extra-high"] },
            provider: {
              type: "object",
              required: ["kind", "label", "command", "args", "env", "capabilities"],
              properties: {
                kind: { enum: ["codex-acp", "generic-acp"] },
                label: { type: "string" },
                command: { type: "string" },
                args: { type: "array", items: { type: "string" } },
                env: {
                  type: "object",
                  additionalProperties: { type: "string" },
                },
                workingDirectory: { type: "string" },
                capabilities: { type: "array", items: { type: "string" } },
              },
            },
            skills: {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name", "description", "command"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  description: { type: "string" },
                  command: { type: "string" },
                },
              },
            },
            watch: {
              type: "object",
              required: ["intervalMinutes", "enabledByDefault"],
              properties: {
                intervalMinutes: { type: "integer", minimum: 1 },
                enabledByDefault: { type: "boolean" },
                persistent: { type: "boolean" },
              },
            },
          },
        },
      },
    },
  },
} as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function normalizeSkills(
  skills: z.infer<typeof persistedSkillSchema>[],
): z.infer<typeof skillSchema>[] {
  const usedIds = new Set<string>();
  return skills.map((skill, index) => {
    const baseId = slugify(skill.id ?? "") || slugify(skill.name) || `skill-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    usedIds.add(id);

    return {
      id,
      name: skill.name.trim(),
      description: skill.description.trim(),
      command: skill.command.trim(),
    };
  });
}

function normalizePersistedTemplates(
  templates: z.infer<typeof persistedTemplatesFileSchema>,
): TeamTemplate[] {
  return templates.map((template) => ({
    ...template,
    id: template.id.trim(),
    name: template.name.trim(),
    description: template.description.trim(),
    defaultVisibleMemberBlueprintIds: (() => {
      const allMemberIds = template.members.map((member) => member.id.trim());
      if (template.defaultVisibleMemberBlueprintIds) {
        const allowedIds = new Set(allMemberIds);
        return [...new Set(template.defaultVisibleMemberBlueprintIds.map((id) => id.trim()).filter((id) => allowedIds.has(id)))];
      }

      if (template.defaultRoomMemberMessageFilter === "hide-members") {
        return [];
      }

      return allMemberIds;
    })(),
    members: template.members.map((member) => ({
      id: member.id.trim(),
      name: member.name.trim(),
      handle: member.handle.trim(),
      summary: member.summary.trim(),
      prompt: member.prompt.trim(),
      accentTone: member.accentTone,
      modelProfileId: member.modelProfileId?.trim() || undefined,
      isEntryMember: member.isEntryMember,
      acceptsDirectMessages: member.acceptsDirectMessages,
      codexThinkingDepth: member.codexThinkingDepth,
      skills: normalizeSkills(member.skills),
      provider: {
        ...member.provider,
        label: member.provider.label.trim(),
        command: member.provider.command.trim(),
        args: member.provider.args.map((arg) => arg.trim()).filter(Boolean),
        env: Object.fromEntries(
          Object.entries(member.provider.env).map(([key, value]) => [key.trim(), value]),
        ),
        workingDirectory: member.provider.workingDirectory?.trim() || undefined,
        capabilities: member.provider.capabilities.map((capability) => capability.trim()).filter(Boolean),
      },
      watch: member.watch
        ? {
            intervalMinutes: member.watch.intervalMinutes,
            enabledByDefault: member.watch.enabledByDefault,
            persistent: member.watch.persistent,
          }
        : undefined,
    })),
  }));
}

function dedupeProfiles(profiles: ProviderModelProfile[]): ProviderModelProfile[] {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.id)) {
      return false;
    }
    seen.add(profile.id);
    return true;
  });
}

export interface GlobalConfigLoadResult {
  templates: TeamTemplate[];
  config: GlobalWorkspaceConfig;
}

export function resolveOpenAquariumConfigDir(directoryOverride?: string): string {
  return directoryOverride ?? path.join(os.homedir(), ".config", "openaquarium");
}

export class OpenAquariumGlobalConfigManager {
  readonly directory: string;
  readonly configFilePath: string;
  readonly templatesFilePath: string;
  readonly templateSchemaFilePath: string;

  constructor(directory = resolveOpenAquariumConfigDir(process.env.OA_CONFIG_DIR)) {
    this.directory = directory;
    this.configFilePath = path.join(directory, "config.json");
    this.templatesFilePath = path.join(directory, "templates.json");
    this.templateSchemaFilePath = path.join(directory, "template.schema.json");
  }

  async load(): Promise<GlobalConfigLoadResult> {
    await mkdir(this.directory, { recursive: true });

    const [config, templates] = await Promise.all([
      this.loadConfigFile(),
      this.loadTemplatesFile(),
    ]);

    await this.ensureSchemaFile();

    return {
      templates,
      config: {
        directory: this.directory,
        modelProfiles: config.modelProfiles,
        templateChatModelProfileId: config.templateChatModelProfileId,
      },
    };
  }

  async saveTemplates(templates: TeamTemplate[]): Promise<void> {
    const normalizedTemplates = templatesFileSchema.parse(templates);
    const payload = JSON.stringify(normalizedTemplates, null, 2);
    await this.atomicWrite(this.templatesFilePath, payload);
    await this.ensureSchemaFile();
  }

  async saveConfig(input: { modelProfiles: ProviderModelProfile[]; templateChatModelProfileId?: string }): Promise<GlobalWorkspaceConfig> {
    const dedupedProfiles = dedupeProfiles(input.modelProfiles);
    const fallbackModelId = dedupedProfiles[0]?.id ?? DEFAULT_CODEX_MODEL_PROFILE_ID;
    const persisted = configFileSchema.parse({
      version: 1,
      modelProfiles: dedupedProfiles,
      templateChatModelProfileId: input.templateChatModelProfileId ?? fallbackModelId,
    } satisfies PersistedConfigFile);
    const payload = JSON.stringify(persisted, null, 2);
    await this.atomicWrite(this.configFilePath, payload);
    await this.ensureSchemaFile();

    return {
      directory: this.directory,
      modelProfiles: dedupedProfiles,
      templateChatModelProfileId: persisted.templateChatModelProfileId,
    };
  }

  private async loadConfigFile(): Promise<PersistedConfigFile> {
    try {
      const raw = await readFile(this.configFilePath, "utf8");
      return configFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      const errorCode = getErrorCode(error as RuntimeError);
      if (errorCode !== "ENOENT") {
        throw error;
      }
      const defaultProfiles = createDefaultProviderModelProfiles();
      const persisted = {
        version: 1,
        modelProfiles: defaultProfiles,
        templateChatModelProfileId: defaultProfiles[0]?.id ?? DEFAULT_CODEX_MODEL_PROFILE_ID,
      } satisfies PersistedConfigFile;
      await this.atomicWrite(this.configFilePath, JSON.stringify(persisted, null, 2));
      return persisted;
    }
  }

  private async loadTemplatesFile(): Promise<TeamTemplate[]> {
    try {
      const raw = await readFile(this.templatesFilePath, "utf8");
      const parsed = persistedTemplatesFileSchema.parse(JSON.parse(raw));
      const normalizedTemplates = templatesFileSchema.parse(normalizePersistedTemplates(parsed));
      const normalizedPayload = JSON.stringify(normalizedTemplates, null, 2);
      if (normalizedPayload !== JSON.stringify(parsed, null, 2)) {
        await this.atomicWrite(this.templatesFilePath, normalizedPayload);
      }
      return normalizedTemplates;
    } catch (error) {
      const errorCode = getErrorCode(error as RuntimeError);
      if (errorCode !== "ENOENT") {
        throw error;
      }
      await this.atomicWrite(this.templatesFilePath, JSON.stringify(defaultTemplates, null, 2));
      return defaultTemplates;
    }
  }

  private async ensureSchemaFile(): Promise<void> {
    await this.atomicWrite(this.templateSchemaFilePath, JSON.stringify(TEMPLATE_JSON_SCHEMA, null, 2));
  }

  private async atomicWrite(filePath: string, content: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.tmp`;
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, filePath);
  }
}
