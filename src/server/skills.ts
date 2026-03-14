import path from "node:path";
import { readdir } from "node:fs/promises";

import { getSkillDirectoryRelativePath, getSkillEntryRelativePath, normalizeAllowedSkillIds } from "../lib/skills";

export interface AvailableSkill {
  id: string;
  directoryPath: string;
  entryPath: string;
}

export interface SkillCatalogEntry extends AvailableSkill {
  hasEntry: boolean;
}

export function resolveAvailableSkills(workspaceRoot: string, allowedSkillIds: string[]): AvailableSkill[] {
  return normalizeAllowedSkillIds(allowedSkillIds).map((skillId) => ({
    id: skillId,
    directoryPath: path.join(workspaceRoot, getSkillDirectoryRelativePath(skillId)),
    entryPath: path.join(workspaceRoot, getSkillEntryRelativePath(skillId)),
  }));
}

export async function loadSkillCatalog(workspaceRoot: string): Promise<SkillCatalogEntry[]> {
  const skillsDirectory = path.join(workspaceRoot, "skills");
  const entries = await readdir(skillsDirectory, { withFileTypes: true }).catch(() => []);

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const id = entry.name.trim();
      return {
        id,
        directoryPath: path.join(workspaceRoot, getSkillDirectoryRelativePath(id)),
        entryPath: path.join(workspaceRoot, getSkillEntryRelativePath(id)),
        hasEntry: true,
      } satisfies SkillCatalogEntry;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}
