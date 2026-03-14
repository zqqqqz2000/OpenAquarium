import path from "node:path";

import { describe, expect, it } from "vitest";

import { isCommandAvailable, resolveCommandPath } from "@/server/acp-session";

describe("resolveCommandPath", () => {
  it("resolves commands from PATH to an executable path", () => {
    const resolved = resolveCommandPath("pwd", process.cwd(), process.env);

    expect(resolved).toBeDefined();
    expect(path.isAbsolute(resolved!)).toBe(true);
    expect(path.basename(resolved!)).toBe("pwd");
  });

  it("resolves relative commands from the working directory", () => {
    const cwd = "/Users/jpx/Documents/OpenAquarium";
    const resolved = resolveCommandPath("./bin/oa-room-state", cwd, process.env);

    expect(resolved).toBe(path.join(cwd, "bin", "oa-room-state"));
  });
});

describe("isCommandAvailable", () => {
  it("reports PATH-resolved commands as available", () => {
    expect(isCommandAvailable("pwd", process.cwd(), process.env)).toBe(true);
  });

  it("rejects missing commands", () => {
    expect(isCommandAvailable("definitely-not-a-real-command", process.cwd(), process.env)).toBe(false);
  });
});
