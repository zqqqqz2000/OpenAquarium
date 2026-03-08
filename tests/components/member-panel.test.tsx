import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemberPanel } from "@/components/members/member-panel";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("MemberPanel", () => {
  it("keeps the sidebar focused on summary and opens deeper editing through studio", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const builder = members.find((member) => member.handle === "builder")!;
    const onOpenStudio = vi.fn();
    const onRunWatcher = vi.fn();

    render(
      <MemberPanel
        snapshot={snapshot}
        room={room}
        members={members}
        selectedMember={builder}
        onSelectMember={vi.fn()}
        onOpenStudio={onOpenStudio}
        onRunWatcher={onRunWatcher}
      />,
    );

    expect(screen.getByText("Open studio")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Prompt/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Command/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open studio/i }));

    expect(onOpenStudio).toHaveBeenCalledWith(builder.id);
    expect(screen.queryByRole("button", { name: /Run watcher/i })).not.toBeInTheDocument();
    expect(onRunWatcher).not.toHaveBeenCalled();
  });
});
