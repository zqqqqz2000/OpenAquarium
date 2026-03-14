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
              acceptsDirectMessages: true,
              allowedSkillIds: [
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
              acceptsDirectMessages: true,
              allowedSkillIds: [
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
    expect(template.members[0]?.allowedSkillIds).toEqual(["send"]);
    expect(template.members[1]?.allowedSkillIds).toEqual(["inspect"]);
  });

  it("accepts legacy skills arrays when allowedSkillIds is omitted", async () => {
    const template = await generateTemplateFromBrief("legacy pod", {
      workspaceRoot: process.cwd(),
      transport: new StaticTransport(
        JSON.stringify({
          name: "Legacy Pod",
          description: "兼容旧 skill 格式",
          accentTone: "paper",
          members: [
            {
              id: "lead",
              name: "Lead",
              handle: "lead",
              summary: "summary",
              prompt: "prompt",
              accentTone: "paper",
              provider: {
                kind: "codex-acp",
                label: "Codex ACP",
                command: CODEX_ACP_NPX_COMMAND,
                args: CODEX_ACP_NPX_ARGS,
                env: {},
                capabilities: ["prompt", "cancel", "loadSession"],
              },
              isEntryMember: true,
              skills: [
                {
                  id: "room-state",
                  name: "Room State",
                  description: "Inspect room state",
                  command: "./bin/oa-room-state --room \"$ROOM\"",
                },
              ],
            },
            {
              id: "builder",
              name: "Builder",
              handle: "builder",
              summary: "summary",
              prompt: "prompt",
              accentTone: "postit",
              provider: {
                kind: "generic-acp",
                label: "Claude Code",
                command: "claude-code",
                args: ["--stdio"],
                env: {},
                capabilities: ["prompt", "cancel"],
              },
              skills: [],
            },
          ],
        }),
      ),
    });

    expect(template.members[0]?.allowedSkillIds).toEqual(["room-state"]);
    expect(template.members[1]?.allowedSkillIds).toEqual([]);
  });

  it("fails when ACP output is invalid", async () => {
    await expect(
      generateTemplateFromBrief("incident 调试 pod", {
        workspaceRoot: process.cwd(),
        transport: {
          generate() {
            return Promise.resolve("not json");
          },
        },
      }),
    ).rejects.toThrow("ACP template response did not contain a JSON object");
  });

  it("fails when transport exceeds timeout", async () => {
    vi.useFakeTimers();

    const promise = generateTemplateFromBrief("research pod", {
      workspaceRoot: process.cwd(),
      transport: new NeverTransport(),
      env: {
        OA_TEMPLATE_ACP_TIMEOUT_MS: "5",
      },
    });

    const rejection = expect(promise).rejects.toThrow("Template generation timed out after 5ms");
    await vi.advanceTimersByTimeAsync(5);
    await rejection;
  });
});
