import { describe, expect, it } from "vitest";

import {
  CODEX_ACP_NPX_ARGS,
  CODEX_ACP_NPX_COMMAND,
  createCodexAcpProvider,
  createGenericAcpProvider,
  normalizeAcpUpdate,
} from "@/lib/acp";

describe("acp providers", () => {
  it("builds a codex provider with sensible defaults", () => {
    const provider = createCodexAcpProvider();

    expect(provider.kind).toBe("codex-acp");
    expect(provider.command).toBe(CODEX_ACP_NPX_COMMAND);
    expect(provider.args).toEqual(CODEX_ACP_NPX_ARGS);
    expect(provider.supportsInterrupt).toBe(true);
  });

  it("supports generic ACP providers for future backends", () => {
    const provider = createGenericAcpProvider({
      label: "Claude Code ACP",
      command: "claude-code-acp",
      args: ["--stdio"],
      capabilities: ["prompt", "cancel", "session.resume"],
    });

    expect(provider.kind).toBe("generic-acp");
    expect(provider.command).toBe("claude-code-acp");
    expect(provider.capabilities).toContain("session.resume");
  });

  it("normalizes ACP tool updates for the UI layer", () => {
    const event = normalizeAcpUpdate({
      sessionId: "session_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "call_1",
        title: "Run command",
        kind: "execute",
        status: "pending",
      },
    });

    expect(event.kind).toBe("tool");
    expect(event.summary).toContain("Run command");
  });
});
