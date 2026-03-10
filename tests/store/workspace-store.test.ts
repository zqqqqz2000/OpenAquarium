import { describe, expect, it } from "vitest";

import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { createWorkspaceStore } from "@/store/workspace-store";

describe("workspace store", () => {
  it("creates a direct-message task without leaking internal drafts into the room transcript", () => {
    const store = createWorkspaceStore(createSeedWorkspace());
    const before = store.getState().snapshot;
    const builder = Object.values(before.members).find((member) => member.handle === "builder")!;

    store.getState().sendUserMessage("先把 IM UI 骨架搭出来。", builder.id);

    const after = store.getState().snapshot;
    const roomMessages = (after.messageOrderByRoom[after.selection.roomId!] ?? []).map((messageId) => after.messages[messageId]);
    const lastMessage = roomMessages.at(-1)!;

    expect(after.members[builder.id].activeTaskId).toBeDefined();
    expect(after.tasks[after.members[builder.id].activeTaskId!].title).toBe("Respond to direct message");
    expect(lastMessage.author.kind).toBe("user");
  });

  it("advances a running member by publishing a public reply and completing the task", () => {
    const store = createWorkspaceStore(createSeedWorkspace());
    store.getState().createProject({
      projectName: "Advance Check",
      templateId: "template-product-pod",
    });
    store.getState().sendUserMessage("先由入口成员回应一下");

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
    expect(after.messages[completedTask.draftMessageId!].author.id).toBe(lead.id);
  });

  it("creates a project and returns its selected route identifiers", () => {
    const store = createWorkspaceStore(createSeedWorkspace());

    const next = store.getState().createProject({
      projectName: "Second Tank",
      templateId: "template-incident-pod",
    });

    const snapshot = store.getState().snapshot;
    const room = snapshot.rooms[next.roomId];

    expect(snapshot.projects[next.projectId].name).toBe("Second Tank");
    expect(room.templateId).toBe("template-incident-pod");
    expect(snapshot.selection.projectId).toBe(next.projectId);
    expect(snapshot.selection.roomId).toBe(next.roomId);
  });

  it("creates a virtual room without a first prompt and names it from the first message", () => {
    const store = createWorkspaceStore(createSeedWorkspace());
    const next = store.getState().createProject({
      projectName: "Third Tank",
      templateId: "template-product-pod",
    });

    let snapshot = store.getState().snapshot;
    expect(snapshot.rooms[next.roomId].name).toBe("New room");
    expect(snapshot.rooms[next.roomId].topic).toBe("");

    store.getState().sendUserMessage("实现一个可中断的 agent team");

    snapshot = store.getState().snapshot;
    expect(snapshot.rooms[next.roomId].name).toBe("实现一个可中断的 Agent Team");
    expect(snapshot.rooms[next.roomId].topic).toBe("实现一个可中断的 agent team");
    expect(snapshot.members[snapshot.rooms[next.roomId].entryMemberId].activeTaskId).toBeDefined();
  });
});
