import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../helpers/mock-streamdown-plugins";
import { ActiveRoomStatusBadge, ChatPane } from "@/components/chat/chat-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRuntimeContext } from "@/domain/identity";
import { postMemberMessage, postUserMessage } from "@/domain/workspace";
import { resolveRoomVisibleMemberIds } from "@/lib/room-message-preferences";
import { resolveRoomTeamSummary } from "@/lib/room-team";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatPane", () => {
  it("shows highlighted mentions, member actions, and shell toggles for room messages", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
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

    expect(
      screen.getAllByText(
        "做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("@lead").length).toBeGreaterThan(0);
    expect(screen.queryByText("Handled by")).not.toBeInTheDocument();
    expect(screen.queryByText("To")).not.toBeInTheDocument();
    expect(screen.queryByText("Room transcript")).not.toBeInTheDocument();
    expect(screen.queryByText("Message filter")).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "团队通常不大，右侧保留更多状态，便于快速切换到具体 member session。",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        "成员内部推理只显示为处理状态；只有显式发送到 room 或 direct 的消息才会出现在消息流里。",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Open @.* session panel/ }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Direct" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Chat" }),
    ).not.toBeInTheDocument();
    const userMessage = screen
      .getAllByText(
        "做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品",
      )
      .find((element) => element.closest("[data-message-kind='user']"));
    const compactMemberMessages = document.querySelectorAll(
      "[data-message-kind='member'][data-message-surface='compact']",
    );

    expect(userMessage?.closest("[data-message-kind='user']")).toHaveAttribute(
      "data-message-surface",
      "compact",
    );
    expect(compactMemberMessages.length).toBeGreaterThan(0);

    await user.click(
      screen.getByRole("button", { name: "Hide projects sidebar" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Hide members sidebar" }),
    );

    expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);
    expect(onToggleRightSidebar).toHaveBeenCalledTimes(1);
  });

  it("renders room messages as markdown while keeping @ and @> highlights", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const lead = members.find((member) => member.handle === "lead");
    const builder = members.find((member) => member.handle === "builder");
    const firstMessageId = snapshot.messageOrderByRoom[room.id]?.[0];

    if (!lead || !builder || !firstMessageId) {
      throw new Error("Expected lead, builder, and an initial room message");
    }

    const firstMessage = snapshot.messages[firstMessageId];
    snapshot.messages[firstMessageId] = {
      ...firstMessage,
      content:
        "## 进度\n\n- 已对齐 `workspace`\n- @lead 复核\n- @>builder 开始实现",
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

    const markdownHeading = screen.getByRole("heading", {
      level: 2,
      name: "进度",
    });
    const markdownBubble = markdownHeading.closest("[data-message-kind]");

    if (!(markdownBubble instanceof HTMLElement)) {
      throw new Error(
        "Expected markdown heading to render inside a message bubble",
      );
    }

    expect(
      within(markdownBubble).getByText("workspace", { selector: "code" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        markdownBubble.querySelector('[data-message-mention-kind="reference"]')
          ?.textContent,
      ).toBe("@lead");
      expect(
        markdownBubble.querySelector('[data-message-mention-kind="assignment"]')
          ?.textContent,
      ).toBe("@>builder");
    });
  });

  it("opens the session panel when the user clicks a member card in the sidebar", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const research = members.find((member) => member.handle === "research");
    const onOpenMember = vi.fn();

    if (!research) {
      throw new Error("Expected research member in seeded room");
    }

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
          onOpenMember={onOpenMember}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Open @research session panel" }),
    );

    expect(onOpenMember).toHaveBeenCalledWith(research.id);
  });

  it("renders multi-staff roles as one stacked hover group while keeping single staff cards unchanged", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");

    if (!builder || !research) {
      throw new Error("Expected builder and research members in seeded room");
    }

    snapshot.members[research.id] = {
      ...research,
      roleId: builder.roleId,
      roleName: builder.roleName,
    };

    const nextMembers = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const roomTeam = resolveRoomTeamSummary(snapshot, room);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
          members={nextMembers}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Open @lead session panel" }),
    ).toBeInTheDocument();
    const roleGroup = screen.getByLabelText(`Role group ${builder.roleName}`);

    expect(within(roleGroup).getAllByText("Codex ACP").length).toBeGreaterThan(
      0,
    );

    await user.hover(roleGroup);

    const builderButton = await screen.findByRole("button", {
      name: "Open @builder session panel",
    });
    const researchButton = await screen.findByRole("button", {
      name: "Open @research session panel",
    });
    const hoverCardContent = builderButton.closest(
      "[data-slot='hover-card-content']",
    );

    expect(builderButton).toBeInTheDocument();
    expect(researchButton).toBeInTheDocument();
    expect(hoverCardContent).toBeTruthy();
    expect(hoverCardContent).toHaveClass("overflow-y-auto");
    expect(hoverCardContent?.className).toContain(
      "max-h-[min(70vh,calc(100vh-2rem))]",
    );
  });

  it("keeps stacked preview layers stable when a non-top member is selected", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");

    if (!builder || !research) {
      throw new Error("Expected builder and research members in seeded room");
    }

    snapshot.members[research.id] = {
      ...research,
      roleId: builder.roleId,
      roleName: builder.roleName,
    };

    const nextMembers = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const roomTeam = resolveRoomTeamSummary(snapshot, room);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
          members={nextMembers}
          selectedMemberId={research.id}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    const roleGroup = screen.getByLabelText(`Role group ${builder.roleName}`);
    const previewCards = roleGroup.querySelectorAll(
      "[data-role-group-preview-card]",
    );
    const topCardSurface = previewCards[0]?.firstElementChild;
    const nextCardSurface = previewCards[1]?.firstElementChild;

    expect(previewCards).toHaveLength(2);
    expect(topCardSurface).toHaveClass("border-ring");
    expect(nextCardSurface).not.toHaveClass("border-ring");
    expect(nextCardSurface).not.toHaveClass("bg-accent/10");
    expect(nextCardSurface).toHaveClass("bg-card");
  });

  it("does not collapse all sidebar members into one group when legacy role ids are empty", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");
    const lead = members.find((member) => member.handle === "lead");

    if (!builder || !research || !lead) {
      throw new Error(
        "Expected lead, builder, and research members in seeded room",
      );
    }

    snapshot.members[lead.id] = { ...lead, roleId: "" };
    snapshot.members[builder.id] = { ...builder, roleId: "" };
    snapshot.members[research.id] = { ...research, roleId: "" };

    const nextMembers = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const roomTeam = resolveRoomTeamSummary(snapshot, room);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
          members={nextMembers}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Open @lead session panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open @builder session panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open @research session panel" }),
    ).toBeInTheDocument();

    await user.hover(
      screen.getByRole("button", { name: "Open @lead session panel" }),
    );

    expect(
      screen.queryByLabelText(`Role group ${lead.roleName}`),
    ).not.toBeInTheDocument();
  });

  it("falls back to member ids and handles when legacy role fields are missing", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");

    if (!builder || !research) {
      throw new Error("Expected builder and research members in seeded room");
    }

    snapshot.members[builder.id] = {
      ...builder,
      roleId: undefined as never,
      roleName: undefined as never,
    };
    snapshot.members[research.id] = {
      ...research,
      roleId: undefined as never,
      roleName: undefined as never,
    };

    const nextMembers = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const roomTeam = resolveRoomTeamSummary(snapshot, room);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
          members={nextMembers}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Open @builder session panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open @research session panel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Role group builder"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Role group research"),
    ).not.toBeInTheDocument();
  });

  it("falls back safely when legacy role fields are non-strings", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const builder = members.find((member) => member.handle === "builder");
    const research = members.find((member) => member.handle === "research");

    if (!builder || !research) {
      throw new Error("Expected builder and research members in seeded room");
    }

    snapshot.members[builder.id] = {
      ...builder,
      roleId: 42 as never,
      roleName: { label: "builder" } as never,
    };
    snapshot.members[research.id] = {
      ...research,
      roleId: false as never,
      roleName: ["research"] as never,
    };

    const nextMembers = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const roomTeam = resolveRoomTeamSummary(snapshot, room);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          rightSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
          members={nextMembers}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Open @builder session panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open @research session panel" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Role group builder"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Role group research"),
    ).not.toBeInTheDocument();
  });

  it("emphasizes member roles over display names in the sidebar", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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

  it("keeps the latest member update inside the hover card instead of repeating it in the sidebar list", async () => {
    const user = userEvent.setup();
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const lead = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "lead");
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");
    if (!lead || !builder) {
      throw new Error("Expected lead and builder members in seeded room");
    }

    const context = createRuntimeContext(605, "2026-03-09T09:35:00.000Z");
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "@>builder 收一下 sidebar 卡片的实时状态摘要",
        mentionedMemberIds: [builder.id],
      },
      context,
    );
    const activeBuilder = snapshot.members[builder.id];
    if (!activeBuilder?.activeTaskId) {
      throw new Error("Expected builder to have an active task");
    }

    const liveUpdate =
      "这个字符串只该出现在中间消息区，不该在右侧 members card 重复。";
    snapshot = postMemberMessage(
      snapshot,
      {
        roomId: room.id,
        memberId: activeBuilder.id,
        taskId: activeBuilder.activeTaskId,
        content: liveUpdate,
      },
      context,
    );

    const nextRoom = snapshot.rooms[room.id];
    const roomTeam = resolveRoomTeamSummary(snapshot, nextRoom);
    const members = nextRoom.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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

    const leadCard = screen.getByRole("button", {
      name: "Open @lead session panel",
    });
    const builderCard = screen.getByRole("button", {
      name: "Open @builder session panel",
    });

    expect(within(leadCard).queryByText(/Ready/i)).not.toBeInTheDocument();
    expect(within(builderCard).queryByText(/Running/i)).not.toBeInTheDocument();
    expect(
      within(builderCard).queryByText(/Direct inbox/i),
    ).not.toBeInTheDocument();
    expect(within(builderCard).queryByText(liveUpdate)).not.toBeInTheDocument();
    expect(within(leadCard).getByText(lead.summary)).toBeInTheDocument();
    expect(within(leadCard).getByText("Entry")).toBeInTheDocument();
    expect(within(leadCard).getByText("Codex ACP")).toBeInTheDocument();
    expect(within(builderCard).getByText("Codex ACP")).toBeInTheDocument();
    expect(within(leadCard).queryByText("Monitor")).not.toBeInTheDocument();

    await user.hover(builderCard);

    const hoverCardLabel = await screen.findByText("Latest update");
    const hoverCardContent = hoverCardLabel.closest(
      "[data-slot='hover-card-content']",
    );

    if (!(hoverCardContent instanceof HTMLElement)) {
      throw new Error("Expected member hover card content");
    }

    expect(within(hoverCardContent).getByText(liveUpdate)).toBeInTheDocument();
    expect(
      within(hoverCardContent).queryByText(builder.summary),
    ).not.toBeInTheDocument();
    expect(
      within(hoverCardContent).queryByText("Codex ACP"),
    ).not.toBeInTheDocument();
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
    const members = nextRoom.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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

    expect(screen.getAllByText(/Running|live/i).length).toBeGreaterThan(0);
  });

  it("shows static green dots on running member avatars in the transcript and sidebar only", () => {
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");
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
      throw new Error(
        "Expected builder to have a running task after the follow-up user message",
      );
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
      .filter(
        (message) =>
          message.author.kind === "member" &&
          message.author.id === runningBuilder.id,
      );

    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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

    const runningDots = container.querySelectorAll(
      "[data-slot='avatar-badge']",
    );
    const bubble = screen
      .getAllByText(builderMessageContent)
      .find((element) => element.closest("[data-message-kind='member']"))
      ?.closest("[data-message-kind='member']");
    if (!(bubble instanceof HTMLElement)) {
      throw new Error(
        "Expected builder message to render inside a member bubble",
      );
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
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");
    if (!builder) {
      throw new Error("Expected builder member in seeded room");
    }
    snapshot.members[builder.id] = {
      ...builder,
      status: "running",
    };
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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

    const trigger = document.querySelector(
      '[aria-label="Show running members"]',
    );
    if (!(trigger instanceof HTMLElement)) {
      throw new Error("Expected running members trigger");
    }

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
            roomId: "room_1",
            memberName: "Forge Crab",
            memberHandle: "builder",
            latestContentPreview:
              "正在补 room 顶部状态 tooltip 的 hover 列表。",
          },
        ]}
        onOpenMember={vi.fn()}
      />,
    );

    const trigger = document.querySelector(
      '[aria-label="Show running members"]',
    );
    if (!(trigger instanceof HTMLElement)) {
      throw new Error("Expected running members trigger");
    }

    await user.hover(trigger);

    expect(await screen.findByText("Running members")).toBeInTheDocument();
    expect(screen.getByText("@builder")).toBeInTheDocument();
    expect(screen.getByText("Forge Crab")).toBeInTheDocument();
    expect(
      screen.getByText("正在补 room 顶部状态 tooltip 的 hover 列表。"),
    ).toBeInTheDocument();
  });

  it("uses a compact team edit badge instead of the full template name", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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
          onOpenRoomTeam={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    const teamTrigger = screen.getByRole("button", {
      name: new RegExp(`Edit ${roomTeam?.name ?? "Room team"}`),
    });

    expect(within(teamTrigger).getByText("Team")).toBeInTheDocument();
    expect(
      within(teamTrigger).queryByText(roomTeam?.name ?? ""),
    ).not.toBeInTheDocument();
  });

  it("lets the user toggle per-member room visibility from the header", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );
    const onUpdateRoomSettings = vi.fn();

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
          onUpdateRoomSettings={onUpdateRoomSettings}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Toggle @builder visibility" }),
    );

    expect(onUpdateRoomSettings).toHaveBeenCalledWith({
      roomId: room.id,
      visibleMemberIds: resolveRoomVisibleMemberIds(
        snapshot,
        room,
        snapshot.templates[room.templateId],
      ).filter((memberId) => snapshot.members[memberId]?.handle !== "builder"),
    });
  });

  it("shows flattened member chips with avatar and handle in the visibility filter", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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
          onUpdateRoomSettings={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    const builderChip = screen.getByRole("button", {
      name: "Toggle @builder visibility",
    });

    expect(builderChip).toHaveTextContent("builder");
    expect(builderChip.querySelector("[data-slot='avatar']")).toBeTruthy();
  });

  it("switches the right sidebar to dashboard metrics", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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
          onUpdateRoomSettings={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("tab", { name: /dashboard/i }));

    expect(screen.getByText("Execution Timeline")).toBeInTheDocument();
    expect(screen.getByText("Member Load")).toBeInTheDocument();
  });

  it("shows source actor labels and truncated task summaries in the execution timeline", async () => {
    const user = userEvent.setup();
    const context = createRuntimeContext(900, "2026-03-10T09:00:00.000Z");
    let snapshot = createSeedWorkspace();
    let room = snapshot.rooms[snapshot.selection.roomId!];

    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "继续推进 execution timeline 的文案展示",
      },
      context,
    );

    room = snapshot.rooms[snapshot.selection.roomId!];
    const lead = snapshot.members[room.entryMemberId];

    if (!lead?.activeTaskId) {
      throw new Error("Expected an active lead task");
    }

    snapshot = postMemberMessage(
      snapshot,
      {
        roomId: room.id,
        memberId: lead.id,
        taskId: lead.activeTaskId,
        content:
          "@>builder 先整理需求边界，然后补上特别长特别长的背景说明，确保 dashboard 上会被截成单行展示，避免挤占整个 timeline 的高度，还要继续补充更多上下文，说明每个边界条件和交互细节，确保这一行一定会被截断显示。\n第二行不应该被带进来。",
      },
      context,
    );

    room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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
          onUpdateRoomSettings={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("tab", { name: /dashboard/i }));

    expect(screen.getAllByText(/You @lead/).length).toBeGreaterThan(0);
    expect(screen.getByText(/lead @builder/)).toBeInTheDocument();

    const summaryLine = screen.getByText((content, element) => {
      return (
        element?.tagName === "P" &&
        content.includes("先整理需求边界") &&
        content.includes("...") &&
        !content.includes("第二行不应该被带进来")
      );
    });

    expect(summaryLine).toHaveClass("truncate");
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

  it("keeps room header badges compact", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds
      .map((memberId) => snapshot.members[memberId])
      .find((member) => member.handle === "builder");
    if (!builder) {
      throw new Error("Expected builder member in seeded room");
    }
    snapshot.members[builder.id] = {
      ...builder,
      status: "running",
    };
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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

    const membersBadge = screen
      .getAllByText("Members")
      .find((element) => element.closest("[data-slot='badge']"))
      ?.closest("[data-slot='badge']");
    const watchersBadge = screen
      .getByText("Watchers")
      .closest("[data-slot='badge']");

    expect(membersBadge).toHaveClass("h-6");
    expect(membersBadge).not.toHaveClass("h-8");
    expect(watchersBadge).toHaveClass("h-6");
    expect(watchersBadge).not.toHaveClass("h-8");

    const runningTrigger = document.querySelector(
      '[aria-label="Show running members"]',
    );
    if (!(runningTrigger instanceof HTMLElement)) {
      throw new Error("Expected running members trigger");
    }
    const runningBadge = within(runningTrigger)
      .getByText("Running")
      .closest("[data-slot='badge']");

    expect(runningBadge).toHaveClass("h-6");
    expect(runningBadge).not.toHaveClass("h-7");

    await user.hover(runningTrigger);
    expect(await screen.findByText("Running members")).toBeInTheDocument();
  });

  it("keeps the room title block and badge block as separate wrap groups", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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
          onOpenRoomTeam={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
          onToggleRightSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    const titleBlock = screen
      .getByText(room.name)
      .closest("div.min-w-\\[min\\(100\\%\\,24rem\\)\\]");
    const teamTrigger = screen.getByRole("button", {
      name: new RegExp(`Edit ${roomTeam?.name ?? "Room team"}`),
    });
    const badgeGroup = teamTrigger.closest(
      "div.flex.max-w-full.shrink-0.flex-nowrap.items-center.gap-1\\.5",
    );

    expect(titleBlock).toBeTruthy();
    expect(badgeGroup).toBeTruthy();
  });

  it("scrolls the transcript to the newest message", () => {
    const scrollCalls: Array<ScrollToOptions | [number, number]> = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: (options: ScrollToOptions | number, top?: number) => {
        scrollCalls.push(
          typeof options === "number" ? [options, top ?? 0] : options,
        );
      },
    });

    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const roomTeam = resolveRoomTeamSummary(snapshot, room);
    const members = room.memberIds.map(
      (memberId) => snapshot.members[memberId],
    );

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
      throw new Error(
        "Expected transcript scrollTo to receive ScrollToOptions",
      );
    }
    expect(firstCall.behavior).toBe("auto");
    expect(typeof firstCall.top).toBe("number");
  });
});
