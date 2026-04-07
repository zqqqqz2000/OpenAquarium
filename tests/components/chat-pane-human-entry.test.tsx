import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/chat/workspace-flex-layout", async () => {
  const React = await import("react");
  type WorkspacePanelId = "projects" | "chat" | "members" | "todo" | "dashboard";

  return {
    WorkspaceFlexLayout(props: {
      leftCollapsed?: boolean;
      panels: Record<WorkspacePanelId, { content: ReactNode; title: string }>;
    }) {
      const { leftCollapsed, panels } = props;
      const [activePanelId, setActivePanelId] = React.useState<WorkspacePanelId>("members");
      const activePanel = panels[activePanelId] ?? panels.members;

      if (leftCollapsed) {
        return <div data-testid="workspace-flex-layout-mock-collapsed">{panels.chat.content}</div>;
      }

      return (
        <div data-testid="workspace-flex-layout-mock" className="flex min-h-0 flex-1 gap-3 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{panels.chat.content}</div>
          <div className="flex min-h-0 w-[372px] shrink-0 flex-col overflow-hidden">
            <div role="tablist" aria-label="Workspace panels" className="flex gap-2">
              {(["chat", "members", "todo", "dashboard"] as WorkspacePanelId[]).map((panelId) => (
                <div
                  key={panelId}
                  role="tab"
                  aria-selected={activePanelId === panelId}
                  tabIndex={0}
                  onClick={() => setActivePanelId(panelId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActivePanelId(panelId);
                    }
                  }}
                >
                  {panels[panelId].title}
                </div>
              ))}
            </div>
            <div role="tabpanel" aria-label={activePanel.title} className="min-h-0 flex-1 overflow-hidden">
              {activePanel.content}
            </div>
          </div>
        </div>
      );
    },
  };
});

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey?: (index: number) => string | number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      index,
      key: getItemKey ? getItemKey(index) : index,
      start: index * 220,
      end: (index + 1) * 220,
      size: 220,
    })),
    getTotalSize: () => count * 220,
    measureElement: () => undefined,
    scrollToIndex: () => undefined,
  }),
}));

import { ChatPane } from "@/components/chat/chat-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage, upsertWorkspaceAccount } from "@/domain/workspace";
import { resolveRoomTeamSummary } from "@/lib/room-team";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatPane multi-human entry", () => {
  it("routes add/switch active human actions through room-scoped callbacks", async () => {
    const user = userEvent.setup();
    let snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;
    const room = snapshot.rooms[roomId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onCreateWorkspaceAccount = vi.fn();
    const onSetActiveAccount = vi.fn();

    const view = render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={resolveRoomTeamSummary(snapshot, room)}
          members={members}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onCreateWorkspaceAccount={onCreateWorkspaceAccount}
          onSetActiveAccount={onSetActiveAccount}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: /Add human/i }));
    await user.type(screen.getByPlaceholderText("Display name"), "Alice");
    await user.type(screen.getByPlaceholderText("handle"), "alice");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onCreateWorkspaceAccount).toHaveBeenCalledWith({
      displayName: "Alice",
      handle: "alice",
      roomId,
      activate: true,
    });

    snapshot = upsertWorkspaceAccount(
      snapshot,
      {
        displayName: "Alice",
        handle: "alice",
        roomId,
      },
      createRuntimeContext(9_000, "2026-03-11T13:00:00.000Z"),
    );

    const nextRoom = snapshot.rooms[roomId];
    view.rerender(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={nextRoom}
          roomTeam={resolveRoomTeamSummary(snapshot, nextRoom)}
          members={members}
          selectedMemberId={nextRoom.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onCreateWorkspaceAccount={onCreateWorkspaceAccount}
          onSetActiveAccount={onSetActiveAccount}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "Alice @alice" }));

    expect(onSetActiveAccount).toHaveBeenCalledWith("account_alice", roomId);
  });

  it("renders human-authored room messages with the human badge and handle", () => {
    const context = createRuntimeContext(9_100, "2026-03-11T13:05:00.000Z");
    let snapshot = createSeedWorkspace();
    const roomId = snapshot.selection.roomId!;

    snapshot = upsertWorkspaceAccount(
      snapshot,
      {
        displayName: "Alice",
        handle: "alice",
        roomId,
        activate: true,
      },
      context,
    );
    snapshot = postUserMessage(
      snapshot,
      {
        roomId,
        content: "@alice 我已经切换成 Alice 身份发言了。",
      },
      context,
    );

    const room = snapshot.rooms[roomId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={resolveRoomTeamSummary(snapshot, room)}
          members={members}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getAllByText("@alice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Human").length).toBeGreaterThan(0);
    expect(screen.getByText("@alice 我已经切换成 Alice 身份发言了。")).toBeInTheDocument();
  });
});
