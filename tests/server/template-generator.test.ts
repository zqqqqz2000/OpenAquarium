import { afterEach, describe, expect, it, vi } from "vitest";

import { CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND } from "@/lib/acp";
import { generateTemplateFromBrief, type TemplateGenerationTransport } from "@/server/template-generator";

class StaticTransport implements TemplateGenerationTransport {
  private readonly response: string;

  constructor(response: string) {
    this.response = response;
  }

  generate(): Promise<string> {
    return Promise.resolve(this.response);
  }
}

class NeverTransport implements TemplateGenerationTransport {
  generate(): Promise<string> {
    return new Promise<string>(() => undefined);
  }
}

describe("template generator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sanitizes ACP JSON output into a valid team template", async () => {
    const template = await generateTemplateFromBrief("做一个偏 coding 的协作 pod", {
      workspaceRoot: process.cwd(),
      transport: new StaticTransport(
        JSON.stringify({
          name: "Coding Pod",
          description: "用于 coding 协作",
          accentTone: "postit",
          members: [
            {
              id: "entry",
              name: "Lead",
              handle: "lead",
              summary: "入口成员",
              prompt: "负责拆解问题",
              accentTone: "postit",
              provider: {
                kind: "codex-acp",
                label: "Codex ACP",
                command: CODEX_ACP_NPX_COMMAND,
                args: CODEX_ACP_NPX_ARGS,
                env: {},
                capabilities: ["prompt", "cancel", "loadSession"],
              },
              isEntryMember: true,
              observeAllRoomMessages: true,
              acceptsDirectMessages: true,
              skills: [
                {
                  id: "send",
                  name: "发送消息",
                  description: "发群消息",
                  command: "./bin/oa-room-send --scope group",
                },
              ],
            },
            {
              id: "builder",
              name: "Builder",
              handle: "lead",
              summary: "实现成员",
              prompt: "负责实现",
              accentTone: "paper",
              provider: {
                kind: "generic-acp",
                label: "Claude Code",
                command: "claude-code",
                args: ["--stdio"],
                env: {},
                capabilities: ["prompt", "cancel"],
              },
              isEntryMember: true,
              observeAllRoomMessages: false,
              acceptsDirectMessages: true,
              skills: [
                {
                  id: "inspect",
                  name: "检查状态",
                  description: "查看房间消息",
                  command: "./bin/oa-room-state --room \"$ROOM\"",
                },
              ],
            },
          ],
        }),
      ),
    });

    expect(template.id).toBe("template-coding-pod");
    expect(template.members).toHaveLength(2);
    expect(template.members.filter((member) => member.isEntryMember)).toHaveLength(1);
    expect(template.members[1]?.handle).toBe("lead-2");
    expect(template.members[1]?.provider.command).toBe("claude-code");
  });

  it("falls back to heuristic generation when ACP output is invalid", async () => {
    const template = await generateTemplateFromBrief("incident 调试 pod", {
      workspaceRoot: process.cwd(),
      transport: {
        generate() {
          return Promise.resolve("not json");
        },
      },
    });

    expect(template.name).toContain("Incident");
    expect(template.members.some((member) => member.isEntryMember)).toBe(true);
  });

  it("falls back to heuristic generation when transport exceeds timeout", async () => {
    vi.useFakeTimers();

    const promise = generateTemplateFromBrief("research pod", {
      workspaceRoot: process.cwd(),
      transport: new NeverTransport(),
      env: {
        OA_TEMPLATE_ACP_TIMEOUT_MS: "5",
      },
    });

    await vi.advanceTimersByTimeAsync(5);
    const template = await promise;

    expect(template.name).toContain("Generated");
    expect(template.members.some((member) => member.isEntryMember)).toBe(true);
  });
});
