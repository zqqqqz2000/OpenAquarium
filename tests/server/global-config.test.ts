import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { TeamTemplate } from "@/domain/model";
import { OpenAquariumGlobalConfigManager } from "@/server/global-config";

describe("OpenAquariumGlobalConfigManager", () => {
  it("normalizes legacy member skills into allowedSkillIds on load", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-global-config-"));
    const manager = new OpenAquariumGlobalConfigManager(directory);
    const templatesFilePath = path.join(directory, "templates.json");

    await writeFile(
      templatesFilePath,
      JSON.stringify(
        [
          {
            id: "template_a",
            name: "Template A",
            description: "desc",
            accentTone: "paper",
            members: [
              {
                id: "lead",
                name: "Lead",
                handle: "lead",
                summary: "summary",
                prompt: "prompt",
                accentTone: "paper",
                provider: {
                  kind: "generic-acp",
                  label: "Generic ACP",
                  command: "agent",
                  args: ["--stdio"],
                  env: {},
                  capabilities: ["prompt", "cancel"],
                },
                skills: [
                  {
                    id: "room-state",
                    name: "Room State",
                    description: "Inspect room state",
                    command: "./bin/oa-room-state --room \"$ROOM\"",
                  },
                ],
              },
            ],
          },
        ],
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await manager.load();

    expect(loaded.templates[0]?.members[0]?.allowedSkillIds).toEqual(["room-state"]);

    const normalizedPayload = JSON.parse(await readFile(templatesFilePath, "utf8")) as TeamTemplate[];
    expect(normalizedPayload[0]?.members[0]?.allowedSkillIds).toEqual(["room-state"]);
  });

  it("does not overwrite templates.json when save validation fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-global-config-save-"));
    const manager = new OpenAquariumGlobalConfigManager(directory);
    const loaded = await manager.load();
    const originalPayload = await readFile(manager.templatesFilePath, "utf8");

    const invalidTemplates = loaded.templates.map((template, templateIndex) =>
      templateIndex === 0
        ? {
            ...template,
            members: template.members.map((member, memberIndex) =>
              memberIndex === 0
                ? ({
                    ...member,
                    allowedSkillIds: undefined,
                  } as unknown as TeamTemplate["members"][number])
                : member,
            ),
          }
        : template,
    );

    await expect(manager.saveTemplates(invalidTemplates)).rejects.toThrow();
    await expect(readFile(manager.templatesFilePath, "utf8")).resolves.toBe(originalPayload);
  });

  it("preserves watcher prompt when saving and reloading templates", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-global-config-watch-prompt-"));
    const manager = new OpenAquariumGlobalConfigManager(directory);
    const loaded = await manager.load();
    const template = loaded.templates[0];

    if (!template) {
      throw new Error("Expected a template");
    }

    const watcherMember = template.members.find((member) => member.watch);
    if (!watcherMember?.watch) {
      throw new Error("Expected a watcher-enabled template member");
    }

    const watchPrompt = "Only summarize unseen blocker and owner changes.";
    const nextTemplates = loaded.templates.map((candidate) =>
      candidate.id === template.id
        ? {
            ...candidate,
            members: candidate.members.map((member) =>
              member.id === watcherMember.id && member.watch
                ? {
                    ...member,
                    watch: {
                      ...member.watch,
                      prompt: watchPrompt,
                    },
                  }
                : member),
          }
        : candidate,
    );

    await manager.saveTemplates(nextTemplates);

    const persistedPayload = JSON.parse(await readFile(manager.templatesFilePath, "utf8")) as TeamTemplate[];
    expect(
      persistedPayload[0]?.members.find((member) => member.id === watcherMember.id)?.watch?.prompt,
    ).toBe(watchPrompt);

    const reloaded = await manager.load();
    expect(
      reloaded.templates[0]?.members.find((member) => member.id === watcherMember.id)?.watch?.prompt,
    ).toBe(watchPrompt);
  });

  it("preserves role-owner state when saving and reloading templates", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-global-config-role-owner-"));
    const manager = new OpenAquariumGlobalConfigManager(directory);
    const loaded = await manager.load();
    const template = loaded.templates[0];

    if (!template) {
      throw new Error("Expected a template");
    }

    const targetMember = template.members.find((member) => member.isRole !== true) ?? template.members[0];
    if (!targetMember) {
      throw new Error("Expected a template member");
    }

    const nextTemplates = loaded.templates.map((candidate) =>
      candidate.id === template.id
        ? {
            ...candidate,
            members: candidate.members.map((member) =>
              member.id === targetMember.id
                ? {
                    ...member,
                    isRole: true,
                  }
                : member),
          }
        : candidate,
    );

    await manager.saveTemplates(nextTemplates);

    const persistedPayload = JSON.parse(await readFile(manager.templatesFilePath, "utf8")) as TeamTemplate[];
    expect(
      persistedPayload[0]?.members.find((member) => member.id === targetMember.id)?.isRole,
    ).toBe(true);

    const reloaded = await manager.load();
    expect(
      reloaded.templates[0]?.members.find((member) => member.id === targetMember.id)?.isRole,
    ).toBe(true);
  });

  it("saves and reloads openai-compatible provider profiles", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-global-config-openai-compatible-"));
    const manager = new OpenAquariumGlobalConfigManager(directory);
    const loaded = await manager.load();

    const nextConfig = await manager.saveConfig({
      modelProfiles: [
        ...loaded.config.modelProfiles,
        {
          id: "model-openai-compatible",
          name: "OpenAI-Compatible API",
          description: "HTTP API provider",
          providerType: "openai-compatible",
          binding: {
            kind: "openai-compatible",
            label: "OpenAI-Compatible API",
            baseURL: "https://example.test/v1",
            apiKeyEnvVar: "OPENAI_API_KEY",
            headersFormat: "kv",
            headers: {
              "X-Workspace": "OpenAquarium",
            },
            extraBodyFormat: "json",
            extraBody: {
              provider: {
                order: ["reasoning"],
              },
            },
            mcpServers: [
              {
                id: "local-files",
                transport: "stdio",
                command: "node",
                args: ["./mcp-server.js"],
                env: {
                  MCP_MODE: "test",
                },
                cwd: "./mcp",
              },
            ],
          },
        },
      ],
      templateChatModelProfileId: "model-openai-compatible",
    });

    expect(nextConfig.modelProfiles.find((profile) => profile.id === "model-openai-compatible")).toMatchObject({
      providerType: "openai-compatible",
      binding: {
        kind: "openai-compatible",
        baseURL: "https://example.test/v1",
        apiKeyEnvVar: "OPENAI_API_KEY",
        headersFormat: "kv",
        headers: {
          "X-Workspace": "OpenAquarium",
        },
        extraBodyFormat: "json",
        extraBody: {
          provider: {
            order: ["reasoning"],
          },
        },
        mcpServers: [
          {
            id: "local-files",
            transport: "stdio",
            command: "node",
          },
        ],
      },
    });

    const reloaded = await manager.load();
    expect(reloaded.config.templateChatModelProfileId).toBe("model-openai-compatible");
    expect(reloaded.config.modelProfiles.find((profile) => profile.id === "model-openai-compatible")).toMatchObject({
      providerType: "openai-compatible",
      binding: {
        kind: "openai-compatible",
        baseURL: "https://example.test/v1",
        headersFormat: "kv",
        extraBodyFormat: "json",
        mcpServers: [
          {
            id: "local-files",
            transport: "stdio",
            command: "node",
          },
        ],
      },
    });
  });
});
