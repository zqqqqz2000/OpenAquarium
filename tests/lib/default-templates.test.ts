import { describe, expect, it } from "vitest";

import { defaultTemplates } from "@/lib/sample-data/templates";

describe("default templates", () => {
  it("asks built-in members to send progress updates instead of staying silent", () => {
    const prompts = defaultTemplates.flatMap((template) => template.members.map((member) => member.prompt));

    expect(prompts.every((prompt) => prompt.includes("先发一条简短进度"))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes("避免让用户长时间等待"))).toBe(true);
    expect(prompts.every((prompt) => prompt.includes("默认不允许使用岗位员工工具"))).toBe(true);
  });
});
