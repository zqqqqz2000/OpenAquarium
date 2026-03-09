import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CODEX_ACP_DEFAULT_MODE, CODEX_ACP_MODE_ENV_KEY } from "@/lib/acp";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { WorkspacePersistence } from "@/server/persistence";

describe("WorkspacePersistence", () => {
  it("migrates legacy codex-acp commands to npx @zed-industries/codex-acp on load", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-persistence-"));
    const stateFilePath = path.join(workspaceRoot, ".openaquarium", "state.json");
    const snapshot = createSeedWorkspace();
    const template = snapshot.templates["template-product-pod"];
    template.members[0] = {
      ...template.members[0],
      provider: {
        ...template.members[0].provider,
        kind: "codex-acp",
        command: "codex-acp",
        args: [],
      },
    };
    const memberId = snapshot.rooms[snapshot.selection.roomId!].memberIds[0];
    snapshot.members[memberId] = {
      ...snapshot.members[memberId],
      provider: {
        ...snapshot.members[memberId].provider,
        kind: "codex-acp",
        command: "codex-acp",
        args: ["--mode", "code"],
      },
    };

    await mkdir(path.dirname(stateFilePath), { recursive: true });
    await writeFile(
      stateFilePath,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          snapshot,
        },
        null,
        2,
      ),
      "utf8",
    );

    const persistence = new WorkspacePersistence(stateFilePath);
    const loaded = await persistence.load();

    expect(loaded?.templates["template-product-pod"].members[0]?.provider.command).toBe("npx");
    expect(loaded?.templates["template-product-pod"].members[0]?.provider.args[0]).toBe("@zed-industries/codex-acp");
    expect(loaded?.templates["template-product-pod"].members[0]?.provider.env[CODEX_ACP_MODE_ENV_KEY]).toBe(CODEX_ACP_DEFAULT_MODE);
    expect(loaded?.members[memberId]?.provider.command).toBe("npx");
    expect(loaded?.members[memberId]?.provider.args).toEqual(["@zed-industries/codex-acp"]);
    expect(loaded?.members[memberId]?.provider.env[CODEX_ACP_MODE_ENV_KEY]).toBe(CODEX_ACP_DEFAULT_MODE);
  });
});
