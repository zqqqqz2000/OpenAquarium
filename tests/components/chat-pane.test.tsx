import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPane } from "@/components/chat/chat-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage } from "@/domain/workspace";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatPane", () => {
  it("shows highlighted mentions, member actions, and shell toggles for room messages", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onToggleLeftSidebar = vi.fn();
    const onToggleRightSidebar = vi.fn();

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          template={template}
          members={members}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={onToggleLeftSidebar}
          onToggleRightSidebar={onToggleRightSidebar}
        />
      </TooltipProvider>,
    );

    expect(screen.getAllByText("做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品").length).toBeGreaterThan(0);
    expect(screen.getAllByText("@lead").length).toBeGreaterThan(0);
    expect(screen.queryByText("Handled by")).not.toBeInTheDocument();
    expect(screen.queryByText("To")).not.toBeInTheDocument();
    expect(screen.queryByText("Room transcript")).not.toBeInTheDocument();
    expect(screen.queryByText("团队通常不大，右侧保留更多状态，便于快速切换到具体 member session。")).not.toBeInTheDocument();
    expect(screen.queryByText("成员内部推理只显示为处理状态；只有显式发送到 room 或 direct 的消息才会出现在消息流里。")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Direct" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Chat" }).length).toBeGreaterThan(0);
    const userMessage = screen
      .getAllByText("做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品")
      .find((element) => element.closest("[data-message-kind='user']"));
    const compactMemberMessages = document.querySelectorAll("[data-message-kind='member'][data-message-surface='compact']");

    expect(userMessage?.closest("[data-message-kind='user']")).toHaveAttribute("data-message-surface", "compact");
    expect(compactMemberMessages.length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Hide projects sidebar" }));
    await user.click(screen.getByRole("button", { name: "Hide members sidebar" }));

    expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);
    expect(onToggleRightSidebar).toHaveBeenCalledTimes(1);
  });

  it("lets the user target a member for direct messaging from the members sidebar", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          template={template}
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

    const [, researchDirectButton] = screen.getAllByRole("button", { name: "Direct" });
    if (!researchDirectButton) {
      throw new Error("Expected a direct button for the research member");
    }

    await user.click(researchDirectButton);

    expect(screen.getByText("DM @research")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("emphasizes member roles over display names in the sidebar", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          template={template}
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

    expect(screen.getAllByText("@lead").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Lead Koi").length).toBeGreaterThan(0);
  });

  it("makes running members more prominent in the right sidebar", () => {
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "请继续处理 sidebar 的运行状态改动",
      },
      createRuntimeContext(600, "2026-03-09T09:30:00.000Z"),
    );
    const nextRoom = snapshot.rooms[room.id];
    const template = snapshot.templates[nextRoom.templateId];
    const members = nextRoom.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={nextRoom}
          template={template}
          members={members}
          selectedMemberId={nextRoom.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getAllByText(/live now/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/live/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
  });

  it("shows a richer empty state before any room is selected", () => {
    const snapshot = createSeedWorkspace();

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={true}
          snapshot={{
            ...snapshot,
            selection: {},
          }}
          room={undefined}
          template={undefined}
          members={[]}
          selectedMemberId={undefined}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("Project path supported")).toBeInTheDocument();
    expect(screen.getByText("新建 project")).toBeInTheDocument();
    expect(screen.getByText("Ready State")).toBeInTheDocument();
  });

  it("scrolls the transcript to the newest message", () => {
    const scrollCalls: Array<ScrollToOptions | [number, number]> = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: (options: ScrollToOptions | number, top?: number) => {
        scrollCalls.push(typeof options === "number" ? [options, top ?? 0] : options);
      },
    });

    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          template={template}
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

    const firstCall = scrollCalls[0];

    expect(firstCall).toBeDefined();
    expect(Array.isArray(firstCall)).toBe(false);
    if (!firstCall || Array.isArray(firstCall)) {
      throw new Error("Expected transcript scrollTo to receive ScrollToOptions");
    }
    expect(firstCall.behavior).toBe("auto");
    expect(typeof firstCall.top).toBe("number");
  });
});
