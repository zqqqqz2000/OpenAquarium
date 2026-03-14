export function normalizeAllowedSkillIds(skillIds: string[]): string[] {
  return [...new Set(skillIds.map((skillId) => skillId.trim()).filter(Boolean))];
}

export function getSkillDirectoryRelativePath(skillId: string): string {
  return `skills/${skillId}`;
}

export function getSkillEntryRelativePath(skillId: string): string {
  return `${getSkillDirectoryRelativePath(skillId)}/SKILL.md`;
}
