import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import "../helpers/mock-streamdown-plugins";
import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createRuntimeContext } from "@/domain/identity";
import { postMemberMessage, postUserMessage } from "@/domain/workspace";
import type { UpdateMemberConfigInput } from "@/domain/model";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import type { WatcherRunResult } from "@/lib/runtime-client";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("MemberStudioDialog", () => {
  function renderDialog(node: ReactElement) {
    return render(<TooltipProvider>{node}</TooltipProvider>);
  }

  it("saves member configuration, supports entry-member promotion, and exposes watcher actions", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const builder = members.find((member) => member.handle === "builder")!;
    const onSaveConfig = vi.fn();
    const onSetEntryMember = vi.fn();
    const onSaveWatcher = vi.fn();
    const onRunWatcher = vi.fn();

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={builder}
        onClose={vi.fn()}
        onSaveConfig={onSaveConfig}
        onSetEntryMember={onSetEntryMember}
        onSaveWatcher={onSaveWatcher}
        onRunWatcher={onRunWatcher}
      />,
    );

    expect(screen.queryByText("深配置收进这里。主聊天页只保留概览和入口动作。")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Config" }));
    await user.clear(screen.getByRole("textbox", { name: /Summary/i }));
    await user.type(screen.getByRole("textbox", { name: /Summary/i }), "Builder summary v2");
    await user.clear(screen.getByRole("textbox", { name: /Prompt/i }));
    await user.type(screen.getByRole("textbox", { name: /Prompt/i }), "新的 builder prompt");
    await user.click(screen.getByRole("switch", { name: "Role" }));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));
    await user.click(screen.getByRole("button", { name: /Make entry member/i }));
    await user.click(screen.getByRole("tab", { name: "Watcher" }));
    await user.clear(screen.getByRole("textbox", { name: /Interval minutes/i }));
    await user.type(screen.getByRole("textbox", { name: /Interval minutes/i }), "6");

    const savedConfig = onSaveConfig.mock.calls[0]?.[0] as UpdateMemberConfigInput | undefined;
    expect(onSaveConfig).toHaveBeenCalledTimes(1);
    expect(savedConfig).toMatchObject({
      memberId: builder.id,
      isRole: true,
      summary: "Builder summary v2",
      prompt: "新的 builder prompt",
      modelProfileId: "model-codex-acp-default",
    });
    expect(savedConfig?.provider.command).toBe(builder.provider.command);
    expect(toast.success).toHaveBeenCalledWith("Saved", {
      description: `${builder.name} updated.`,
    });
    expect(onSetEntryMember).toHaveBeenCalledWith(builder.id);
    expect(screen.getByRole("switch", { name: "Watch" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "Persistent watch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save watcher/i })).toBeDisabled();
    expect(onSaveWatcher).not.toHaveBeenCalled();
    expect(onRunWatcher).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Config" }));
    expect(screen.getByText("这里改的是当前 room 下这个 member 的实例配置，不会同步回 team template。")).toBeInTheDocument();
  });

  it("shows member-specific processing history", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = members.find((member) => member.handle === "lead")!;
    const firstMessageId = snapshot.messageOrderByRoom[room.id]?.[0];
    const leadTask = Object.values(snapshot.tasks).find((task) => task.memberId === lead.id)!;

    if (!firstMessageId) {
      throw new Error("Expected an initial room message");
    }

    snapshot.messages[firstMessageId] = {
      ...snapshot.messages[firstMessageId],
      content: "**需求范围**\n\n- 先定义 transcript 结构",
    };
    snapshot.taskTraces.trace_0001 = {
      id: "trace_0001",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "task-prompt",
      title: "Task prompt",
      content: "[Recent Room Transcript]\n[07:30] You (group/sent): 做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品",
      createdAt: "2026-03-09T07:30:01.000Z",
    };
    snapshot.taskTraces.trace_0002 = {
      id: "trace_0002",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "completed",
      title: "Task completed (end_turn)",
      content: "@builder @research 先整理需求边界，然后由 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。",
      createdAt: "2026-03-09T07:30:02.000Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0001", "trace_0002"];

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByText("Processing history")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Reply")).toBeInTheDocument();
    expect(screen.getByText("需求范围", { selector: '[data-streamdown="strong"]' })).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) =>
        element?.textContent?.includes("@builder @research 先整理需求边界，然后由 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。") ?? false,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("saves watcher prompt with watcher configuration", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((member) => member.handle === "builder")!;
    const onSaveWatcher = vi.fn();

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={builder}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={onSaveWatcher}
        onRunWatcher={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Watcher" }));
    await user.clear(screen.getByRole("textbox", { name: /Watcher prompt/i }));
    await user.type(screen.getByRole("textbox", { name: /Watcher prompt/i }), "Only summarize unseen blocker changes.");
    await user.click(screen.getByRole("button", { name: /Save watcher/i }));

    expect(onSaveWatcher).toHaveBeenCalledWith({
      memberId: builder.id,
      enabled: false,
      intervalMinutes: 15,
      persistent: false,
      prompt: "Only summarize unseen blocker changes.",
    });
    expect(toast.success).toHaveBeenCalledWith("Saved", {
      description: `${builder.name} watcher updated.`,
    });
  });

  it("shows a toast when saving member config fails", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const builder = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "builder")!;
    const onSaveConfig = vi.fn(async () => {
      throw new Error("Config save failed.");
    });

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={builder}
        onClose={vi.fn()}
        onSaveConfig={onSaveConfig}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Config" }));
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    expect(toast.error).toHaveBeenCalledWith("Save failed", {
      description: "Config save failed.",
    });
    expect(screen.getByText("Config save failed.")).toBeInTheDocument();
  });

  it("runs watcher now with feedback and keeps it as a secondary action", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const scribe = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "scribe")!;
    const watcherId = room.watcherIds.find((candidate) => snapshot.watchers[candidate]?.memberId === scribe.id);
    const onRunWatcher = vi.fn();

    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={scribe}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={onRunWatcher}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Watcher" }));
    const saveWatcherButton = screen.getByRole("button", { name: /Save watcher/i });
    const runNowButton = screen.getByRole("button", { name: /Run now/i });

    expect(saveWatcherButton).toHaveAttribute("data-variant", "default");
    expect(runNowButton).toHaveAttribute("data-variant", "secondary");

    await user.click(runNowButton);

    expect(onRunWatcher).toHaveBeenCalledWith(watcherId);
    expect(toast.success).toHaveBeenCalledWith("Watcher started", {
      description: `${scribe.name} watcher is running now.`,
    });
  });

  it("shows a deferred toast when the watched member is busy", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const scribe = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "scribe")!;
    const onRunWatcher = vi.fn<() => Promise<WatcherRunResult>>(async () => ({
      snapshot,
      outcome: "busy",
    }));

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={scribe}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={onRunWatcher}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Watcher" }));
    await user.click(screen.getByRole("button", { name: /Run now/i }));

    expect(toast.success).toHaveBeenCalledWith("Watcher deferred", {
      description: `${scribe.name} is busy. This run will wait until that member becomes idle.`,
    });
  });

  it("shows room-level hold and watcher-level pause as separate watcher states", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const scribe = room.memberIds.map((memberId) => snapshot.members[memberId]).find((candidate) => candidate.handle === "scribe")!;
    const watcherId = room.watcherIds.find((candidate) => snapshot.watchers[candidate]?.memberId === scribe.id);

    if (!watcherId) {
      throw new Error("Expected watcher id");
    }

    snapshot.rooms[room.id] = {
      ...room,
      watchersSuspended: true,
    };
    snapshot.watchers[watcherId] = {
      ...snapshot.watchers[watcherId],
      persistent: true,
      pausedUntilActivity: true,
    };

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={snapshot.rooms[room.id]}
        member={scribe}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
      />,
    );

    expect(screen.getByText("Room watch hold")).toBeInTheDocument();
    expect(screen.getByText("Paused until activity")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Watcher" }));

    expect(screen.getByText("Runtime status")).toBeInTheDocument();
    expect(screen.getByText(/Room watch hold comes from the sidebar button/)).toBeInTheDocument();
    expect(screen.getByText(/Paused until activity is watcher-level state/)).toBeInTheDocument();
  });

  it("caps the current task card height and scrolls long source messages", () => {
    const context = createRuntimeContext(900, "2026-03-10T08:30:00.000Z");
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    snapshot = postUserMessage(
      snapshot,
      {
        roomId: room.id,
        content: "lead 再接一条长上下文任务",
      },
      context,
    );
    const lead = snapshot.members[room.entryMemberId];
    const leadTask = lead.activeTaskId ? snapshot.tasks[lead.activeTaskId] : undefined;
    if (!leadTask) {
      throw new Error("Expected an active task for the lead member");
    }
    const sourceMessage = snapshot.messages[leadTask.sourceMessageId];

    snapshot.messages[leadTask.sourceMessageId] = {
      ...sourceMessage,
      content: `${sourceMessage.content}\n${"补充上下文 ".repeat(120)}`,
    };

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
      />,
    );

    expect(screen.getByTestId("current-task-card")).toHaveClass("max-h-[min(20rem,38vh)]");
    expect(screen.getByTestId("current-task-source-message")).toHaveClass("overflow-y-auto");
  });

  it("shows the member session timeline and lets the user send a direct message", async () => {
    const user = userEvent.setup();
    let snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = members.find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find((task) => task.memberId === lead.id)!;
    const onSendDirectMessage = vi.fn();
    snapshot.taskTraces.trace_0100 = {
      id: "trace_0100",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "task-prompt",
      title: "Task prompt",
      content: "[Recent Room Transcript]\n[07:30] You (group/sent): 原始上下文消息",
      createdAt: "2026-03-09T07:30:01.000Z",
    };
    snapshot.taskTraces.trace_0101 = {
      id: "trace_0101",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: "我先查代码和文档里这些开关对应的字段与行为，确认它们在当前实现里的真实作用。",
      createdAt: "2026-03-09T07:30:01.200Z",
    };
    snapshot.taskTraces.trace_0102 = {
      id: "trace_0102",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: "我先查代码和文档里这些开关对应的字段与行为，确认它们在当前实现里的真实作用。我已经定位到用户问的是成员配置/房间行为相关的开关。",
      createdAt: "2026-03-09T07:30:01.300Z",
    };
    snapshot.taskTraces.trace_0103 = {
      id: "trace_0103",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool call",
      content: "Read message-feed.ts (called)",
      createdAt: "2026-03-09T07:30:01.400Z",
    };
    snapshot.taskTraces.trace_0104 = {
      id: "trace_0104",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "draft",
      title: "Internal draft",
      content: "我先查代码和文档里这些开关对应的字段与行为，确认它们在当前实现里的真实作用。我已经定位到用户问的是成员配置/房间行为相关的开关。接下来直接查这些字段在代码里的定义和触发逻辑。",
      createdAt: "2026-03-09T07:30:01.600Z",
    };
    snapshot.taskTraces.trace_0105 = {
      id: "trace_0105",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "status",
      title: "Tool completed",
      content: "Read message-feed.ts (completed)",
      createdAt: "2026-03-09T07:30:01.700Z",
    };
    snapshot.taskTraces.trace_0106 = {
      id: "trace_0106",
      taskId: leadTask.id,
      roomId: room.id,
      memberId: lead.id,
      kind: "completed",
      title: "Task completed (end_turn)",
      content: "@builder @research 先整理需求边界，然后由 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。",
      createdAt: "2026-03-09T07:30:01.800Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = [
      "trace_0100",
      "trace_0101",
      "trace_0102",
      "trace_0103",
      "trace_0104",
      "trace_0105",
      "trace_0106",
    ];
    snapshot = postMemberMessage(
      snapshot,
      {
        roomId: room.id,
        memberId: lead.id,
        content: "**私聊更新**\n\n`done`",
        directToUser: true,
      },
      createRuntimeContext(901, "2026-03-09T07:31:00.000Z"),
    );

    renderDialog(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
        onSendDirectMessage={onSendDirectMessage}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Session" }));

    expect(screen.getByText("Member session")).toBeInTheDocument();
    expect(screen.getByText("私聊更新", { selector: '[data-streamdown="strong"]' })).toBeInTheDocument();
    expect(screen.getByText("done", { selector: "code" })).toBeInTheDocument();
    expect(screen.queryByText("Task prompt")).not.toBeInTheDocument();
    const activity = screen.getByTestId("member-session-activity");
    expect(within(activity).getByText("我先查代码和文档里这些开关对应的字段与行为，确认它们在当前实现里的真实作用。我已经定位到用户问的是成员配置/房间行为相关的开关。")).toBeInTheDocument();
    const toolEvents = within(activity).getAllByTestId("member-session-tool-event");
    expect(toolEvents).toHaveLength(1);
    expect(within(toolEvents[0]!).getByText("completed")).toBeInTheDocument();
    expect(within(toolEvents[0]!).getByText("Read message-feed.ts")).toBeInTheDocument();
    expect(within(activity).getByText("接下来直接查这些字段在代码里的定义和触发逻辑。")).toBeInTheDocument();
    expect(
      within(activity).queryByText(
        "我先查代码和文档里这些开关对应的字段与行为，确认它们在当前实现里的真实作用。我已经定位到用户问的是成员配置/房间行为相关的开关。接下来直接查这些字段在代码里的定义和触发逻辑。",
      ),
    ).not.toBeInTheDocument();
    expect(within(activity).getByRole("button", { name: "Show room reply" })).toBeInTheDocument();
    expect(screen.getByText("DM @lead")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show room reply" }));
    expect(screen.getByText(/先整理需求边界/)).toBeInTheDocument();

    await user.click(screen.getByTestId("member-session-prompt-toggle"));
    expect(screen.getByText("Task prompt")).toBeInTheDocument();
    expect(screen.getByText(/原始上下文消息/)).toBeInTheDocument();

    await user.type(screen.getByRole("textbox"), "先同步一个当前进度。");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSendDirectMessage).toHaveBeenCalledWith("先同步一个当前进度。", lead.id);
  });

  it("shows the save button only on the config tab", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = members.find((member) => member.handle === "lead")!;

    render(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Save$/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Config" }));
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.queryByRole("button", { name: /^Save$/i })).not.toBeInTheDocument();
  });
});
