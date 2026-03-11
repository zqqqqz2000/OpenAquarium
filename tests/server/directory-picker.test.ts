// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

describe("selectProjectDirectory", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns the normalized directory path from osascript", async () => {
    execFileMock.mockImplementation(
      (_command: string, _args: string[], callback: (error: Error | null, stdout: string) => void) => {
        callback(null, "/tmp/demo-project/\n");
      },
    );

    const { selectProjectDirectory } = await import("@/server/directory-picker");

    await expect(selectProjectDirectory()).resolves.toBe("/tmp/demo-project/");
    expect(execFileMock).toHaveBeenCalledWith(
      "osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Select a project directory for OpenAquarium")'],
      expect.any(Function),
    );
  });

  it("turns the macOS cancel signal into a dedicated cancellation error", async () => {
    execFileMock.mockImplementation(
      (_command: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error("execution error: User canceled. (-128)"));
      },
    );

    const { DirectorySelectionCancelledError, selectProjectDirectory } = await import("@/server/directory-picker");

    await expect(selectProjectDirectory()).rejects.toBeInstanceOf(DirectorySelectionCancelledError);
  });
});
