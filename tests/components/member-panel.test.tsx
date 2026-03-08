import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemberPanel } from "@/components/members/member-panel";
import { TooltipProvider } from "@/components/ui/tooltip";
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
      <TooltipProvider>
        <MemberPanel
          collapsed={false}
          snapshot={snapshot}
          room={room}
          members={members}
          selectedMember={builder}
          onSelectMember={vi.fn()}
          onOpenStudio={onOpenStudio}
          onRunWatcher={onRunWatcher}
          onToggleCollapsed={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Open studio")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Prompt/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /Command/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open studio/i }));

    expect(onOpenStudio).toHaveBeenCalledWith(builder.id);
    expect(screen.queryByRole("button", { name: /Run watcher/i })).not.toBeInTheDocument();
    expect(onRunWatcher).not.toHaveBeenCalled();
  });

  it("exposes a control to collapse the member sidebar", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onToggleCollapsed = vi.fn();

    render(
      <TooltipProvider>
        <MemberPanel
          collapsed={false}
          snapshot={snapshot}
          room={room}
          members={members}
          selectedMember={members[0]}
          onSelectMember={vi.fn()}
          onOpenStudio={vi.fn()}
          onRunWatcher={vi.fn()}
          onToggleCollapsed={onToggleCollapsed}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Hide member sidebar" }));

    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });
});
