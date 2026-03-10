import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import type { UpdateMemberConfigInput } from "@/domain/model";
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

    await user.click(screen.getByRole("tab", { name: "Behavior" }));
    await user.clear(screen.getByRole("textbox", { name: /Summary/i }));
    await user.type(screen.getByRole("textbox", { name: /Summary/i }), "Builder summary v2");
    await user.clear(screen.getByRole("textbox", { name: /Prompt/i }));
    await user.type(screen.getByRole("textbox", { name: /Prompt/i }), "新的 builder prompt");
    await user.click(screen.getByRole("tab", { name: "ACP" }));
    await user.clear(screen.getByRole("textbox", { name: /Command/i }));
    await user.type(screen.getByRole("textbox", { name: /Command/i }), "claude-code");
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
    });
    expect(savedConfig?.provider.command).toBe("claude-code");
    expect(onSetEntryMember).toHaveBeenCalledWith(builder.id);
    expect(onSaveWatcher).toHaveBeenCalledWith({
      memberId: builder.id,
      enabled: false,
      intervalMinutes: 6,
    });
    expect(onRunWatcher).not.toHaveBeenCalled();
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
      content: "先整理需求边界，然后 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。",
      createdAt: "2026-03-09T07:30:02.000Z",
    };
    snapshot.taskTraceOrderByTask[leadTask.id] = ["trace_0001", "trace_0002"];

    render(
      <MemberStudioDialog
        snapshot={snapshot}
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
    expect(screen.getByText("先整理需求边界，然后 @builder 准备代码骨架，@research 收集现有 ACP 兼容层做法。")).toBeInTheDocument();
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
});
