import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import { createRuntimeContext } from "@/domain/identity";
import { postUserMessage } from "@/domain/workspace";
import type { UpdateMemberConfigInput } from "@/domain/model";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("MemberStudioDialog", () => {
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

    render(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={builder}
        onClose={vi.fn()}
        onToggleMonitor={vi.fn()}
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
    await user.click(screen.getByRole("button", { name: /Save member config/i }));
    await user.click(screen.getByRole("button", { name: /Make entry member/i }));
    await user.click(screen.getByRole("tab", { name: "Watcher" }));
    await user.clear(screen.getByRole("textbox", { name: /Interval minutes/i }));
    await user.type(screen.getByRole("textbox", { name: /Interval minutes/i }), "6");
    await user.click(screen.getByRole("button", { name: /Save watcher/i }));

    const savedConfig = onSaveConfig.mock.calls[0]?.[0] as UpdateMemberConfigInput | undefined;
    expect(onSaveConfig).toHaveBeenCalledTimes(1);
    expect(savedConfig).toMatchObject({
      memberId: builder.id,
      summary: "Builder summary v2",
      prompt: "新的 builder prompt",
      modelProfileId: "model-codex-acp-default",
    });
    expect(savedConfig?.provider.command).toBe(builder.provider.command);
    expect(onSetEntryMember).toHaveBeenCalledWith(builder.id);
    expect(onSaveWatcher).toHaveBeenCalledWith({
      memberId: builder.id,
      enabled: false,
      intervalMinutes: 6,
    });
    expect(onRunWatcher).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Config" }));
    expect(screen.getByText("这里改的是当前 room 下这个 member 的实例配置，不会同步回 team template。")).toBeInTheDocument();
    expect(screen.getByText(/Provider command\/env now live in Template Studio > Models/i)).toBeInTheDocument();
  });

  it("shows member-specific processing history", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = members.find((member) => member.handle === "lead")!;
    const leadTask = Object.values(snapshot.tasks).find((task) => task.memberId === lead.id)!;
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

    render(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onToggleMonitor={vi.fn()}
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
    expect(
      screen.getAllByText((_, element) =>
        element?.textContent?.includes("@builder @research 先整理需求边界，然后由 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。") ?? false,
      ).length,
    ).toBeGreaterThan(0);
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

    render(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onToggleMonitor={vi.fn()}
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
    const snapshot = createSeedWorkspace();
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
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0100"];

    render(
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        room={room}
        member={lead}
        onClose={vi.fn()}
        onToggleMonitor={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
        onSendDirectMessage={onSendDirectMessage}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Session" }));

    expect(screen.getByText("Member session")).toBeInTheDocument();
    expect(screen.getByText("Task prompt")).toBeInTheDocument();
    expect(screen.getByText(/原始上下文消息/)).toBeInTheDocument();
    expect(screen.getByText("DM @lead")).toBeInTheDocument();

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
        onToggleMonitor={vi.fn()}
        onSaveConfig={vi.fn()}
        onSetEntryMember={vi.fn()}
        onSaveWatcher={vi.fn()}
        onRunWatcher={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: /Save member config/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Config" }));
    expect(screen.getByRole("button", { name: /Save member config/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.queryByRole("button", { name: /Save member config/i })).not.toBeInTheDocument();
  });
});
