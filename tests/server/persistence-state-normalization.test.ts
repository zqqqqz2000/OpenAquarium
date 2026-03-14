import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { WorkspaceSnapshot } from "@/domain/model";
import { CODEX_ACP_DEFAULT_MODE, CODEX_ACP_MODE_ENV_KEY, CODEX_ACP_NPX_ARGS, CODEX_ACP_NPX_COMMAND } from "@/lib/acp";
import { WorkspacePersistence } from "@/server/persistence";

describe("workspace persistence state normalization", () => {
  it("filters room message order and watcher pointers that reference messages from another room", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-persistence-normalize-"));
    const filePath = path.join(directory, "state.json");

    const snapshot = {
      projects: {},
      projectOrder: [],
      rooms: {
        room_a: {
          id: "room_a",
          projectId: "project_a",
          name: "A",
          topic: "topic a",
          templateId: "template_a",
          memberIds: [],
          watcherIds: ["watcher_a"],
          entryMemberId: "member_a",
          createdAt: "2026-03-10T10:00:00.000Z",
        },
        room_b: {
          id: "room_b",
          projectId: "project_a",
          name: "B",
          topic: "topic b",
          templateId: "template_a",
          memberIds: [],
          watcherIds: [],
          entryMemberId: "member_b",
          createdAt: "2026-03-10T10:00:01.000Z",
        },
      },
      roomOrderByProject: {},
      templates: {},
      templateOrder: [],
      members: {},
      messages: {
        message_a: {
          id: "message_a",
          roomId: "room_a",
          author: { kind: "user", id: "user", label: "You" },
          content: "hello",
          createdAt: "2026-03-10T10:00:02.000Z",
          transport: "group",
          status: "sent",
          mentionedMemberIds: [],
          recipientMemberIds: [],
        },
        message_b: {
          id: "message_b",
          roomId: "room_b",
          author: { kind: "user", id: "user", label: "You" },
          content: "world",
          createdAt: "2026-03-10T10:00:03.000Z",
          transport: "group",
          status: "sent",
          mentionedMemberIds: [],
          recipientMemberIds: [],
        },
      },
      messageOrderByRoom: {
        room_a: ["message_a", "message_b", "message_a"],
        room_b: ["message_b"],
      },
      tasks: {
        task_watch: {
          id: "task_watch",
          roomId: "room_a",
          memberId: "member_a",
          sourceMessageId: "message_watch",
          title: "Review watcher digest",
          status: "running",
          startedAt: "2026-03-10T10:00:02.000Z",
          updatedAt: "2026-03-10T10:00:02.000Z",
        },
      },
      taskTraces: {},
      taskTraceOrderByTask: {},
      watchers: {
        watcher_a: {
          id: "watcher_a",
          roomId: "room_a",
          memberId: "member_a",
          enabled: true,
          intervalMinutes: 10,
          lastConsumedMessageId: "message_b",
        },
      },
      selection: {},
      currentUserName: "You",
    } satisfies WorkspaceSnapshot;

    await writeFile(filePath, JSON.stringify({ savedAt: "2026-03-10T10:00:04.000Z", snapshot }, null, 2), "utf8");

    const persistence = new WorkspacePersistence(filePath);
    const loaded = await persistence.load();

    expect(loaded?.messageOrderByRoom.room_a).toEqual(["message_a"]);
    expect(loaded?.watchers.watcher_a.lastConsumedMessageId).toBe("message_a");
    const fileContents = await readFile(filePath, "utf8");
    expect(fileContents).toContain("message_b");
  });

  it("migrates legacy placeholder ACP commands to codex ACP on load", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-persistence-provider-normalize-"));
    const filePath = path.join(directory, "state.json");

    const snapshot = {
      projects: {},
      projectOrder: [],
      rooms: {
        room_a: {
          id: "room_a",
          projectId: "project_a",
          name: "A",
          topic: "topic a",
          templateId: "template_a",
          memberIds: ["member_a"],
          watcherIds: [],
          entryMemberId: "member_a",
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      },
      roomOrderByProject: {},
      templates: {
        template_a: {
          id: "template_a",
          name: "Template A",
          description: "desc",
          accentTone: "paper",
          members: [
            {
              id: "blueprint_a",
              name: "Member A",
              handle: "member-a",
              summary: "summary",
              prompt: "prompt",
              accentTone: "paper",
              skills: [],
              provider: {
                kind: "generic-acp",
                label: "Clerk ACP",
                command: "clerk-acp",
                args: ["--stdio"],
                env: {
                  OA_TEST: "1",
                },
                capabilities: ["prompt"],
              },
            },
          ],
        },
      },
      templateOrder: ["template_a"],
      members: {
        member_a: {
          id: "member_a",
          roomId: "room_a",
          blueprintId: "blueprint_a",
          roleId: "blueprint_a",
          roleName: "member-a",
          name: "Member A",
          handle: "member-a",
          summary: "summary",
          prompt: "prompt",
          accentTone: "paper",
          skills: [],
          provider: {
            kind: "generic-acp",
            label: "Research ACP",
            command: "research-acp",
            args: ["--stdio"],
            env: {
              OA_TEST: "2",
            },
            capabilities: ["prompt"],
          },
          acceptsDirectMessages: true,
          isEntryMember: true,
          status: "running",
          activeTaskId: "task_watch",
        },
      },
      messages: {},
      messageOrderByRoom: {
        room_a: [],
      },
      tasks: {},
      taskTraces: {},
      taskTraceOrderByTask: {},
      watchers: {},
      selection: {
        roomId: "room_a",
      },
      currentUserName: "You",
    } satisfies WorkspaceSnapshot;

    await writeFile(filePath, JSON.stringify({ savedAt: "2026-03-10T10:00:04.000Z", snapshot }, null, 2), "utf8");

    const persistence = new WorkspacePersistence(filePath);
    const loaded = await persistence.load();

    expect(loaded?.templates.template_a.members[0]?.provider.command).toBe(CODEX_ACP_NPX_COMMAND);
    expect(loaded?.templates.template_a.members[0]?.provider.args).toEqual(CODEX_ACP_NPX_ARGS);
    expect(loaded?.templates.template_a.members[0]?.provider.label).toBe("Codex ACP");
    expect(loaded?.templates.template_a.members[0]?.provider.env).toEqual({
      [CODEX_ACP_MODE_ENV_KEY]: CODEX_ACP_DEFAULT_MODE,
      OA_TEST: "1",
    });
    expect(loaded?.members.member_a.provider.command).toBe(CODEX_ACP_NPX_COMMAND);
    expect(loaded?.members.member_a.provider.args).toEqual(CODEX_ACP_NPX_ARGS);
    expect(loaded?.members.member_a.provider.label).toBe("Codex ACP");
    expect(loaded?.members.member_a.provider.env).toEqual({
      [CODEX_ACP_MODE_ENV_KEY]: CODEX_ACP_DEFAULT_MODE,
      OA_TEST: "2",
    });
  });

  it("hides legacy public watcher digests on load", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "oa-persistence-watch-visibility-"));
    const filePath = path.join(directory, "state.json");

    const snapshot = {
      projects: {},
      projectOrder: [],
      rooms: {
        room_a: {
          id: "room_a",
          projectId: "project_a",
          name: "A",
          topic: "topic a",
          templateId: "template_a",
          memberIds: ["member_a"],
          watcherIds: ["watcher_a"],
          entryMemberId: "member_a",
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      },
      roomOrderByProject: {},
      templates: {},
      templateOrder: [],
      members: {
        member_a: {
          id: "member_a",
          roomId: "room_a",
          blueprintId: "blueprint_a",
          roleId: "blueprint_a",
          roleName: "member-a",
          name: "Member A",
          handle: "member-a",
          summary: "summary",
          prompt: "prompt",
          accentTone: "paper",
          skills: [],
          provider: {
            kind: "codex-acp",
            label: "Codex ACP",
            command: CODEX_ACP_NPX_COMMAND,
            args: CODEX_ACP_NPX_ARGS,
            env: {
              [CODEX_ACP_MODE_ENV_KEY]: CODEX_ACP_DEFAULT_MODE,
            },
            capabilities: ["prompt"],
          },
          acceptsDirectMessages: true,
          isEntryMember: true,
          status: "idle",
        },
      },
      messages: {
        message_watch: {
          id: "message_watch",
          roomId: "room_a",
          author: { kind: "system", id: "system", label: "Watcher" },
          content: "Legacy watcher digest",
          createdAt: "2026-03-10T10:00:01.000Z",
          transport: "watch-digest",
          status: "sent",
          visibility: "public",
          mentionedMemberIds: [],
          recipientMemberIds: ["member_a"],
        },
      },
      messageOrderByRoom: {
        room_a: ["message_watch"],
      },
      tasks: {},
      taskTraces: {},
      taskTraceOrderByTask: {},
      watchers: {
        watcher_a: {
          id: "watcher_a",
          roomId: "room_a",
          memberId: "member_a",
          enabled: true,
          intervalMinutes: 10,
          lastConsumedMessageId: "message_watch",
        },
      },
      selection: {
        roomId: "room_a",
      },
      currentUserName: "You",
    } satisfies WorkspaceSnapshot;

    await writeFile(filePath, JSON.stringify({ savedAt: "2026-03-10T10:00:04.000Z", snapshot }, null, 2), "utf8");

    const persistence = new WorkspacePersistence(filePath);
    const loaded = await persistence.load();

    expect(loaded?.messages.message_watch).toBeUndefined();
    expect(loaded?.messageOrderByRoom.room_a ?? []).not.toContain("message_watch");
  });
});
