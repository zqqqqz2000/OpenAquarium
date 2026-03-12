import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../helpers/mock-streamdown-plugins";
import { ActiveRoomStatusBadge, ChatPane } from "@/components/chat/chat-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRuntimeContext } from "@/domain/identity";
import { postMemberMessage, postUserMessage } from "@/domain/workspace";
import { resolveRoomTeamSummary } from "@/lib/room-team";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatPane", () => {
  it("shows highlighted mentions, member actions, and shell toggles for room messages", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
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
          roomTeam={roomTeam}
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

  it("renders room messages as markdown while keeping @ and @> highlights", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = members.find((member) => member.handle === "lead");
    const builder = members.find((member) => member.handle === "builder");
    const firstMessageId = snapshot.messageOrderByRoom[room.id]?.[0];

    if (!lead || !builder || !firstMessageId) {
      throw new Error("Expected lead, builder, and an initial room message");
    }

    const firstMessage = snapshot.messages[firstMessageId];
    snapshot.messages[firstMessageId] = {
      ...firstMessage,
      content: "## 进度\n\n- 已对齐 `workspace`\n- @lead 复核\n- @>builder 开始实现",
      mentionedMemberIds: [builder.id],
      quotedMemberIds: [lead.id],
    };

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
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

    const markdownHeading = screen.getByRole("heading", { level: 2, name: "进度" });
    const markdownBubble = markdownHeading.closest("[data-message-kind]");

    if (!(markdownBubble instanceof HTMLElement)) {
      throw new Error("Expected markdown heading to render inside a message bubble");
    }

    expect(within(markdownBubble).getByText("workspace", { selector: "code" })).toBeInTheDocument();
    await waitFor(() => {
      expect(markdownBubble.querySelector('[data-message-mention-kind="reference"]')?.textContent).toBe("@lead");
      expect(markdownBubble.querySelector('[data-message-mention-kind="assignment"]')?.textContent).toBe("@>builder");
    });
  });

  it("lets the user target a member for direct messaging from the members sidebar", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
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
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
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
    const roomTeam = resolveRoomTeamSummary(snapshot, nextRoom);
    const members = nextRoom.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={nextRoom}
          roomTeam={roomTeam}
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

  it("shows static green dots on running member avatars in the transcript and sidebar only", () => {
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder");
    if (!builder) {
      throw new Error("Expected builder member in seeded room");
    }
    const context = createRuntimeContext(610, "2026-03-09T09:40:00.000Z");

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>builder 继续处理 running avatar dot",
        mentionedMemberIds: [builder.id],
      },
      context,
    );

    const runningBuilder = snapshot.members[builder.id];
    if (!runningBuilder?.activeTaskId) {
      throw new Error("Expected builder to have a running task after the follow-up user message");
    }

    const builderMessageContent = "聊天区 bubble 头像也补上 running 绿点。";
    snapshot = postMemberMessage(
      snapshot,
      {
        roomId: room.id,
        memberId: runningBuilder.id,
        taskId: runningBuilder.activeTaskId,
        content: builderMessageContent,
      },
      context,
    );

    const builderMessages = snapshot.messageOrderByRoom[room.id]
      ?.map((messageId) => snapshot.messages[messageId])
      .filter((message) => message.author.kind === "member" && message.author.id === runningBuilder.id);

    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    const { container } = render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
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

    const runningDots = container.querySelectorAll("[data-slot='avatar-badge']");
    const bubble = screen.getByText(builderMessageContent).closest("[data-message-kind='member']");
    if (!(bubble instanceof HTMLElement)) {
      throw new Error("Expected builder message to render inside a member bubble");
    }

    expect(bubble.querySelector("[data-slot='avatar-badge']")).toBeTruthy();
    expect(runningDots).toHaveLength((builderMessages?.length ?? 0) + 1);
    runningDots.forEach((dot) => {
      expect(dot).toHaveClass("bg-emerald-500");
      expect(dot).not.toHaveClass("animate-oa-breathe");
    });
  });

  it("keeps the room header badge running when only a non-lead member is running", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder");
    if (!builder) {
      throw new Error("Expected builder member in seeded room");
    }
    snapshot.members[builder.id] = {
      ...builder,
      status: "running",
    };
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
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

    const trigger = screen.getByRole("button", { name: "Show running members" });

    expect(within(trigger).getByText("Running")).toBeInTheDocument();

    await user.hover(trigger);

    expect(await screen.findByText("Running members")).toBeInTheDocument();
  });

  it("shows running members in a hover tooltip for the room status badge", async () => {
    const user = userEvent.setup();

    render(
      <ActiveRoomStatusBadge
        runningMembers={[
          {
            memberId: "member_1",
            memberName: "Forge Crab",
            memberHandle: "builder",
            summary: "正在补 room 顶部状态 tooltip 的 hover 列表。",
          },
        ]}
      />,
    );

    await user.hover(screen.getByRole("button", { name: "Show running members" }));

    expect(await screen.findByText("Running members")).toBeInTheDocument();
    expect(screen.getByText("@builder")).toBeInTheDocument();
    expect(screen.getByText("Forge Crab")).toBeInTheDocument();
    expect(screen.getByText("正在补 room 顶部状态 tooltip 的 hover 列表。")).toBeInTheDocument();
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
          roomTeam={undefined}
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
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
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
