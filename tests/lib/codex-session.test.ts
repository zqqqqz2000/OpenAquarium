import { describe, expect, it, vi } from "vitest";

import {
  CODEX_ACP_DEFAULT_MODE,
  CODEX_ACP_MODE_ENV_KEY,
  ensureCodexAcpSessionMode,
  mergeCodexAcpEnv,
  resolveCodexAcpMode,
} from "@/lib/acp";

describe("codex session defaults", () => {
  it("applies full-access by default when the session starts in a sandboxed mode", async () => {
    const initSession = vi.fn().mockResolvedValue({
      sessionId: "session_1",
      modes: {
        currentModeId: "read-only",
        availableModes: [{ id: "read-only", name: "Read Only" }, { id: "full-access", name: "Full Access" }],
      },
    });
    const setMode = vi.fn().mockResolvedValue(undefined);

    await ensureCodexAcpSessionMode({ initSession, setMode });

    expect(initSession).toHaveBeenCalledTimes(1);
    expect(setMode).toHaveBeenCalledWith(CODEX_ACP_DEFAULT_MODE);
  });

  it("skips mode changes when the desired mode is already active", async () => {
    const initSession = vi.fn().mockResolvedValue({
      sessionId: "session_1",
      modes: {
        currentModeId: "full-access",
        availableModes: [{ id: "full-access", name: "Full Access" }],
      },
    });
    const setMode = vi.fn().mockResolvedValue(undefined);

    await ensureCodexAcpSessionMode({ initSession, setMode }, { mode: "full-access" });

    expect(setMode).not.toHaveBeenCalled();
  });

  it("rejects unsupported mode values and falls back to the codex default", () => {
    expect(resolveCodexAcpMode("not-a-mode")).toBe(CODEX_ACP_DEFAULT_MODE);
    expect(mergeCodexAcpEnv({ TEST: "1" })).toEqual({
      [CODEX_ACP_MODE_ENV_KEY]: CODEX_ACP_DEFAULT_MODE,
      TEST: "1",
    });
  });
});
