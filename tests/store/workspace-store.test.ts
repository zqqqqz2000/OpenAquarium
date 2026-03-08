import { describe, expect, it } from "vitest";

import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { createWorkspaceStore } from "@/store/workspace-store";

describe("workspace store", () => {
  it("primes new direct-message tasks with a visible streaming draft", () => {
    const store = createWorkspaceStore(createSeedWorkspace());
    const before = store.getState().snapshot;
    const builder = Object.values(before.members).find((member) => member.handle === "builder")!;

    store.getState().sendUserMessage("先把 IM UI 骨架搭出来。", builder.id);

    const after = store.getState().snapshot;
    const roomMessages = (after.messageOrderByRoom[after.selection.roomId!] ?? []).map((messageId) => after.messages[messageId]);
    const lastMessage = roomMessages.at(-1)!;

    expect(after.members[builder.id].activeTaskId).toBeDefined();
    expect(after.tasks[after.members[builder.id].activeTaskId!].title).toBe("Respond to direct message");
    expect(lastMessage.author.id).toBe(builder.id);
    expect(lastMessage.status).toBe("streaming");
  });

  it("advances a running member from draft to completed reply", () => {
    const store = createWorkspaceStore(createSeedWorkspace());
    store.getState().createProject({
      projectName: "Advance Check",
      firstPrompt: "先由入口成员回应一下",
      templateId: "template-product-pod",
    });

    const snapshot = store.getState().snapshot;
    const roomId = snapshot.selection.roomId!;
    const lead = snapshot.rooms[roomId].memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.isEntryMember)!;
    const currentTaskId = lead.activeTaskId!;

    store.getState().advanceMember(lead.id);

    const after = store.getState().snapshot;
    const completedTask = after.tasks[currentTaskId];

    expect(completedTask.status).toBe("completed");
    expect(after.members[lead.id].status).toBe("idle");
    expect(completedTask.draftMessageId).toBeDefined();
    expect(after.messages[completedTask.draftMessageId!].status).toBe("completed");
  });

  it("creates a project and returns its selected route identifiers", () => {
    const store = createWorkspaceStore(createSeedWorkspace());

    const next = store.getState().createProject({
      projectName: "Second Tank",
      firstPrompt: "给我一个 incident 调试专用的 team",
      templateId: "template-incident-pod",
    });

    const snapshot = store.getState().snapshot;
    const room = snapshot.rooms[next.roomId];

    expect(snapshot.projects[next.projectId].name).toBe("Second Tank");
    expect(room.templateId).toBe("template-incident-pod");
    expect(snapshot.selection.projectId).toBe(next.projectId);
    expect(snapshot.selection.roomId).toBe(next.roomId);
  });
});
