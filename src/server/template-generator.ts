import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import { generateText } from "ai";

import { z } from "zod";

import type { SkillDefinition, TeamMemberBlueprint, TeamTemplate } from "../domain/model";
import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND, createCodexAcpProvider, createGenericAcpProvider } from "../lib/acp";
import { defaultTemplates } from "../lib/sample-data/templates";
import { isCommandAvailable } from "./acp-session";
import { getErrorMessage } from "./error-utils";

const accentToneSchema = z.enum(["paper", "postit", "blueprint", "correction"]);

const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  command: z.string().min(1),
});

const providerSchema = z.object({
  kind: z.enum(["codex-acp", "generic-acp"]),
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string().min(1)).default([]),
  env: z.record(z.string(), z.string()).default({}),
  workingDirectory: z.string().optional(),
  capabilities: z.array(z.string().min(1)).default(["prompt", "cancel"]),
});

const memberBlueprintSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  handle: z.string().min(1),
  summary: z.string().min(1),
  prompt: z.string().min(1),
  accentTone: accentToneSchema,
  provider: providerSchema,
  isEntryMember: z.boolean().default(false),
  observeAllRoomMessages: z.boolean().default(false),
  acceptsDirectMessages: z.boolean().default(true),
  skills: z.array(skillSchema).min(1).max(8),
  watch: z
    .object({
      intervalMinutes: z.number().int().positive().max(24 * 60),
      enabledByDefault: z.boolean().default(true),
    })
    .optional(),
});

const templateDraftSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  accentTone: accentToneSchema,
  members: z.array(memberBlueprintSchema).min(2).max(6),
});

type TemplateDraft = z.infer<typeof templateDraftSchema>;

export interface TemplateGenerationTransport {
  generate(prompt: string): Promise<string>;
}

export interface GenerateTemplateOptions {
  workspaceRoot: string;
  transport?: TemplateGenerationTransport;
  references?: TeamTemplate[];
  env?: Record<string, string | undefined>;
}

const DEFAULT_TEMPLATE_ACP_TIMEOUT_MS = 30_000;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function summarizeReferenceTemplates(templates: TeamTemplate[]): string {
  return JSON.stringify(
    templates.map((template) => ({
      name: template.name,
      description: template.description,
      accentTone: template.accentTone,
      members: template.members.map((member) => ({
        handle: member.handle,
        summary: member.summary,
        isEntryMember: member.isEntryMember ?? false,
        observeAllRoomMessages: member.observeAllRoomMessages ?? false,
        hasWatcher: Boolean(member.watch),
        providerKind: member.provider.kind,
        providerCommand: member.provider.command,
        skills: member.skills.map((skill) => ({
          name: skill.name,
          command: skill.command,
        })),
      })),
    })),
    null,
    2,
  );
}

function buildTemplateGenerationPrompt(brief: string, references: TeamTemplate[]): string {
  return [
    "[OA_TEMPLATE_GENERATION]",
    "You are generating a team template for OpenAquarium.",
    "Return exactly one JSON object and nothing else.",
    "",
    "[Goal]",
    "Produce a configurable agent-team template for an IM-style multi-member workspace.",
    "Member responsibility must come from prompt + skills + provider, not from a hard-coded role system.",
    "",
    "[Hard Constraints]",
    "1. Output valid JSON only. No markdown fences.",
    "2. The root shape must be: { name, description, accentTone, members }.",
    "3. Members count must be between 2 and 6.",
    "4. Exactly one member must have isEntryMember=true.",
    "5. Each handle must be unique, lowercase, and suitable for @mentions.",
    "6. Skills must be concrete shell commands the member can run.",
    "7. Use ACP providers only: kind must be codex-acp or generic-acp.",
    "8. Prefer codex-acp for coding-oriented members. Use generic-acp for other ACP agents such as claude-code, clerk-acp, research-acp.",
    "9. Only add watch when a member should periodically consume room deltas.",
    "10. observeAllRoomMessages means the member can inspect the whole room history; it is not itself a separate role.",
    "",
    "[Useful Command References]",
    '- Group message: "./bin/oa-room-send --scope group --text \\"status update\\""',
    '- Direct message: "./bin/oa-room-send --scope direct --target @handle --text \\"private note\\""',
    '- Watcher digest: "./bin/oa-room-watch"',
    '- Room state: "./bin/oa-room-state --room \\"$ROOM\\""',
    "",
    "[Guidance]",
    "- Keep prompts specific and operational.",
    "- Use a mix of entry, implementation, research, QA, recorder, incident, or data roles as appropriate to the brief.",
    "- Make skills complementary; do not duplicate every member.",
    "- Prefer 3 to 5 members unless the brief is clearly small or clearly broad.",
    "",
    "[Reference Templates]",
    summarizeReferenceTemplates(references),
    "",
    "[Brief]",
    brief.trim() || "custom collaboration pod",
  ].join("\n");
}

function extractJsonPayload(response: string): string {
  const trimmed = response.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]+?)```/u);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("ACP template response did not contain a JSON object");
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeSkill(skill: z.infer<typeof skillSchema>, index: number): SkillDefinition {
  const slug = slugify(skill.id) || slugify(skill.name) || `skill-${index + 1}`;
  return {
    id: slug,
    name: skill.name.trim(),
    description: skill.description.trim(),
    command: skill.command.trim(),
  };
}

function normalizeMember(
  member: z.infer<typeof memberBlueprintSchema>,
  index: number,
  usedHandles: Set<string>,
): TeamMemberBlueprint {
  const baseHandle = slugify(member.handle) || `member-${index + 1}`;
  let handle = baseHandle;
  let suffix = 2;
  while (usedHandles.has(handle)) {
    handle = `${baseHandle}-${suffix}`;
    suffix += 1;
  }
  usedHandles.add(handle);

  const provider =
    member.provider.kind === "codex-acp"
      ? {
          ...createCodexAcpProvider({
            command: member.provider.command.trim() || CODEX_ACP_NPX_COMMAND,
            args: dedupeStrings(member.provider.args).length > 0 ? dedupeStrings(member.provider.args) : CODEX_ACP_NPX_ARGS,
            env: member.provider.env,
            workingDirectory: member.provider.workingDirectory?.trim() || undefined,
          }),
          label: member.provider.label.trim() || "Codex ACP",
          capabilities: dedupeStrings(member.provider.capabilities).length > 0
            ? dedupeStrings(member.provider.capabilities)
            : ["prompt", "cancel", "loadSession"],
        }
      : createGenericAcpProvider({
          label: member.provider.label.trim(),
          command: member.provider.command.trim(),
          args: dedupeStrings(member.provider.args),
          env: member.provider.env,
          workingDirectory: member.provider.workingDirectory?.trim() || undefined,
          capabilities: dedupeStrings(member.provider.capabilities).length > 0
            ? dedupeStrings(member.provider.capabilities)
            : ["prompt", "cancel"],
        });

  return {
    id: slugify(member.id) || handle,
    name: member.name.trim(),
    handle,
    summary: member.summary.trim(),
    prompt: member.prompt.trim(),
    accentTone: member.accentTone,
    provider,
    isEntryMember: member.isEntryMember,
    observeAllRoomMessages: member.observeAllRoomMessages,
    acceptsDirectMessages: member.acceptsDirectMessages,
    skills: member.skills.map(normalizeSkill),
    watch: member.watch
      ? {
          intervalMinutes: Math.max(1, Math.round(member.watch.intervalMinutes)),
          enabledByDefault: member.watch.enabledByDefault,
        }
      : undefined,
  };
}

function sanitizeDraft(draft: TemplateDraft, brief: string): TeamTemplate {
  const usedHandles = new Set<string>();
  const members = draft.members.map((member, index) => normalizeMember(member, index, usedHandles));
  const entryIndex = members.findIndex((member) => member.isEntryMember);
  const normalizedMembers = members.map((member, index) => ({
    ...member,
    isEntryMember: entryIndex === -1 ? index === 0 : index === entryIndex,
    observeAllRoomMessages: index === entryIndex ? true : member.observeAllRoomMessages,
  }));
  const seed = slugify(draft.name) || slugify(brief) || "generated-pod";

  return {
    id: `template-${seed}`,
    name: draft.name.trim(),
    description: draft.description.trim(),
    accentTone: draft.accentTone,
    members: normalizedMembers,
  };
}

function parseArgsConfig(env: Record<string, string | undefined>): string[] {
  const json = env.OA_TEMPLATE_ACP_ARGS_JSON?.trim();
  if (json) {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
    throw new Error("OA_TEMPLATE_ACP_ARGS_JSON must be a JSON string array");
  }

  const plain = env.OA_TEMPLATE_ACP_ARGS?.trim();
  return plain ? plain.split(/\s+/u).filter(Boolean) : [];
}

function parseTemplateTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env.OA_TEMPLATE_ACP_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_TEMPLATE_ACP_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("OA_TEMPLATE_ACP_TIMEOUT_MS must be a positive integer");
  }

  return parsed;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(getErrorMessage(error)));
      },
    );
  });
}

function resolveTemplateAcpCommand(env: Record<string, string | undefined>): { command: string; args: string[] } {
  const command = env.OA_TEMPLATE_ACP_COMMAND?.trim() || CODEX_ACP_NPX_COMMAND;
  const args = parseArgsConfig(env);

  if (args.length > 0) {
    return { command, args };
  }

  return command === CODEX_ACP_NPX_COMMAND
    ? { command, args: CODEX_ACP_NPX_ARGS }
    : { command, args: [] };
}

function parseEnvJson(env: Record<string, string | undefined>): Record<string, string> {
  const json = env.OA_TEMPLATE_ACP_ENV_JSON?.trim();
  if (!json) {
    return {};
  }

  const parsed = JSON.parse(json) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OA_TEMPLATE_ACP_ENV_JSON must be a JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

class AcpTemplateGenerationTransport implements TemplateGenerationTransport {
  private readonly workspaceRoot: string;
  private readonly env: Record<string, string | undefined>;

  constructor(args: { workspaceRoot: string; env: Record<string, string | undefined> }) {
    this.workspaceRoot = args.workspaceRoot;
    this.env = args.env;
  }

  async generate(prompt: string): Promise<string> {
    const templateAcp = resolveTemplateAcpCommand(this.env);
    const primaryCwd = this.env.OA_TEMPLATE_ACP_WORKDIR?.trim() || this.workspaceRoot;
    const primaryEnv = {
      ...process.env,
      ...parseEnvJson(this.env),
    };
    const timeoutMs = parseTemplateTimeoutMs(this.env);

    if (!isCommandAvailable(templateAcp.command, primaryCwd, primaryEnv)) {
      throw new Error(`Template ACP provider is unavailable: ${templateAcp.command} ${templateAcp.args.join(" ")}`.trim());
    }

    const provider = createACPProvider({
      command: templateAcp.command,
      args: templateAcp.args,
      env: parseEnvJson(this.env),
      session: {
        cwd: primaryCwd,
        mcpServers: [],
      },
    });

    try {
      const result = await withTimeout(
        generateText({
          model: provider.languageModel(),
          prompt,
          tools: provider.tools,
        }),
        timeoutMs,
        "ACP template generation",
      );
      return result.text.trim();
    } finally {
      provider.cleanup();
    }
  }
}

export async function generateTemplateFromBrief(
  brief: string,
  options: GenerateTemplateOptions,
): Promise<TeamTemplate> {
  const normalizedBrief = brief.trim() || "custom collaboration pod";
  const references = options.references ?? defaultTemplates;
  const env = options.env ?? process.env;
  const transport =
    options.transport ??
    new AcpTemplateGenerationTransport({
      workspaceRoot: options.workspaceRoot,
      env,
    });

  const raw = await withTimeout(
    transport.generate(buildTemplateGenerationPrompt(normalizedBrief, references)),
    parseTemplateTimeoutMs(env),
    "Template generation",
  );
  const parsed = templateDraftSchema.parse(JSON.parse(extractJsonPayload(raw)));
  return sanitizeDraft(parsed, normalizedBrief);
}
