export interface MemberRolePalette {
  background: string;
  foreground: string;
}

export function normalizeMemberRole(role: string): string {
  const normalized = role.trim().replace(/^@/u, "").toLowerCase();
  return normalized.length > 0 ? normalized : "member";
}

export function getMemberRoleLabel(role: string): string {
  return `@${normalizeMemberRole(role)}`;
}

export function getMemberRoleMonogram(role: string): string {
  const normalized = normalizeMemberRole(role);
  const segments = normalized.split(/[-_\s]+/u).filter((segment) => segment.length > 0);

  if (segments.length >= 2) {
    return segments
      .map((segment) => segment[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  return normalized.slice(0, 2).toUpperCase();
}

export function getMemberRolePalette(role: string): MemberRolePalette {
  const normalized = normalizeMemberRole(role);
  let hash = 0;

  for (const character of normalized) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  const hue = hash % 360;
  const saturation = 62 + (hash % 10);
  const lightness = 40 + (hash % 8);

  return {
    background: `hsl(${hue} ${saturation}% ${lightness}%)`,
    foreground: "hsl(0 0% 100%)",
  };
}
