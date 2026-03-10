import { describe, expect, it } from "vitest";

import {
  getMemberRoleLabel,
  getMemberRoleMonogram,
  getMemberRolePalette,
  normalizeMemberRole,
} from "@/lib/member-display";

describe("member display helpers", () => {
  it("normalizes roles and renders mention labels", () => {
    expect(normalizeMemberRole(" @Lead ")).toBe("lead");
    expect(getMemberRoleLabel("Research")).toBe("@research");
  });

  it("builds short role monograms", () => {
    expect(getMemberRoleMonogram("lead")).toBe("LE");
    expect(getMemberRoleMonogram("incident-commander")).toBe("IC");
  });

  it("returns deterministic palettes per role", () => {
    expect(getMemberRolePalette("lead")).toEqual(getMemberRolePalette("@lead"));
    expect(getMemberRolePalette("lead").background).not.toBe(getMemberRolePalette("research").background);
  });
});
