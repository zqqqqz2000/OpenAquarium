import { describe, expect, it } from "vitest";

import { isAppTheme, resolveInitialTheme } from "@/theme/theme";

describe("theme helpers", () => {
  it("validates supported themes", () => {
    expect(isAppTheme("light")).toBe(true);
    expect(isAppTheme("dark")).toBe(true);
    expect(isAppTheme("system")).toBe(false);
    expect(isAppTheme(null)).toBe(false);
  });

  it("prefers stored theme when valid", () => {
    expect(resolveInitialTheme("dark", false)).toBe("dark");
    expect(resolveInitialTheme("light", true)).toBe("light");
  });

  it("falls back to media preference when storage is empty or invalid", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme(undefined, false)).toBe("light");
    expect(resolveInitialTheme("invalid", true)).toBe("dark");
  });
});
