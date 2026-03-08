import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatPane } from "@/components/chat/chat-pane";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatPane", () => {
  it("shows routed recipients and handlers for room messages", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <ChatPane
        snapshot={snapshot}
        room={room}
        template={template}
        members={members}
        selectedMemberId={room.entryMemberId}
        onOpenMember={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    expect(screen.getAllByText("做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Handled by").length).toBeGreaterThan(0);
    expect(screen.getAllByText("@lead").length).toBeGreaterThan(0);
    expect(screen.getAllByText("To").length).toBeGreaterThan(0);
  });
});
