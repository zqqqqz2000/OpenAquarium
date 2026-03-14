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
});
