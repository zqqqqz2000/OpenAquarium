import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RoomTeamDialog } from "@/components/rooms/room-team-dialog";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("RoomTeamDialog", () => {
  it("saves room-local team metadata and members", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const onSave = vi.fn();

    render(
      <RoomTeamDialog
        open
        snapshot={snapshot}
        room={room}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={onSave}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toHaveClass("w-[min(96vw,88rem)]");
    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[88rem]");

    expect(screen.getByText("这里改的是当前 room 里的团队结构和成员实例配置；只有显式保存为默认 template，才会同步回软件默认模板源。")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Team name" }));
    await user.type(screen.getByRole("textbox", { name: "Team name" }), "Room Tiger Team");
    await user.click(screen.getByRole("button", { name: /Add role/i }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Signal Heron");
    await user.clear(screen.getByRole("textbox", { name: "Handle" }));
    await user.type(screen.getByRole("textbox", { name: "Handle" }), "qa");
    await user.click(screen.getAllByRole("button", { name: /Save room team/i })[0]!);

    const payload = onSave.mock.calls[0]?.[0];
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(payload.teamName).toBe("Room Tiger Team");
    expect(payload.members.some((member: { handle: string }) => member.handle === "qa")).toBe(true);
  });

  it("saves the current room team back into the default template source", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const onSaveDefaultTemplate = vi.fn();

    render(
      <RoomTeamDialog
        open
        snapshot={snapshot}
        room={room}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={onSaveDefaultTemplate}
      />,
    );

    await user.clear(screen.getByRole("textbox", { name: "Team name" }));
    await user.type(screen.getByRole("textbox", { name: "Team name" }), "Default Product Pod");
    await user.click(screen.getAllByRole("button", { name: /Save as default template/i })[0]!);

    expect(onSaveDefaultTemplate).toHaveBeenCalledTimes(1);
    expect(onSaveDefaultTemplate.mock.calls[0]?.[0]).toMatchObject({
      templateId: room.templateId,
      name: "Default Product Pod",
      description: snapshot.templates[room.templateId]?.description,
    });
  });

  it("opens a draft editor immediately after adding a role or an employee", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const initialMemberCount = room.memberIds.length;

    render(
      <RoomTeamDialog
        open
        snapshot={snapshot}
        room={room}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add role/i }));

    expect(screen.getByRole("textbox", { name: "Role" })).toHaveDisplayValue(/Role \d+/);
    expect(screen.getByRole("textbox", { name: "Handle" })).toHaveDisplayValue(/role-\d+/);
    expect(screen.getAllByText(`${initialMemberCount + 1} members`).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: /Add employee/i }).at(-1)!);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveDisplayValue(/Member \d+/);
    expect(screen.getByRole("textbox", { name: "Role" })).toHaveDisplayValue(/Role \d+/);
    expect(screen.queryByRole("textbox", { name: "Handle" })).not.toBeInTheDocument();
    expect(screen.getAllByText(`${initialMemberCount + 2} members`).length).toBeGreaterThan(0);
    expect(screen.getByText("这个员工继承岗位模板的 prompt、allowedSkillIds、provider 和 watcher 配置；本阶段只开放名字和备注。")).toBeInTheDocument();
  });

  it("keeps new role and employee drafts visible while the backing snapshot changes", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const { rerender } = render(
      <RoomTeamDialog
        open
        snapshot={snapshot}
        room={room}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add role/i }));
    expect(screen.getByRole("textbox", { name: "Handle" })).toHaveDisplayValue(/role-\d+/);

    const nextSnapshot = createSeedWorkspace();
    const nextRoom = nextSnapshot.rooms[nextSnapshot.selection.roomId!];
    const leadId = nextRoom.memberIds[0];
    nextSnapshot.members[leadId] = {
      ...nextSnapshot.members[leadId],
      status: "running",
    };

    rerender(
      <RoomTeamDialog
        open
        snapshot={nextSnapshot}
        room={nextRoom}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Handle" })).toHaveDisplayValue(/role-\d+/);

    await user.click(screen.getAllByRole("button", { name: /Add employee/i }).at(-1)!);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveDisplayValue(/Member \d+/);
    expect(screen.queryByRole("textbox", { name: "Handle" })).not.toBeInTheDocument();
  });

  it("lets room role templates toggle role-owner state and disables watcher controls when enabled", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];

    render(
      <RoomTeamDialog
        open
        snapshot={snapshot}
        room={room}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Add role/i }));

    const roleSwitch = screen.getByRole("switch", { name: "Room team role owner" });
    expect(roleSwitch).toBeChecked();
    expect(screen.getByText("Role owner 可以挂员工并接收 `oa_role_*` 扩编操作；同时不能配置 Watch。若要关闭它，必须先移除这个岗位下的员工。")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Room team watcher configured" })).toBeDisabled();

    await user.click(roleSwitch);

    expect(roleSwitch).not.toBeChecked();
    expect(screen.getByText("关闭后，这个成员会变成普通成员，不再作为岗位 owner 接收扩编。若这个岗位下还有员工，保存时会被阻止。")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Room team watcher configured" })).not.toBeDisabled();
  });

  it("refreshes watcher prompt fields after saving the same room", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const watcherId = room.watcherIds[0];

    if (!watcherId) {
      throw new Error("Expected a room watcher");
    }

    const watcher = snapshot.watchers[watcherId];
    const watcherMember = snapshot.members[watcher.memberId];
    const nextSnapshot = createSeedWorkspace();
    const nextRoom = nextSnapshot.rooms[nextSnapshot.selection.roomId!];
    const nextWatcherId = nextRoom.watcherIds.find((candidate) => nextSnapshot.watchers[candidate]?.memberId === watcher.memberId);

    if (!watcherMember || !nextWatcherId) {
      throw new Error("Expected watcher member");
    }

    nextSnapshot.watchers[nextWatcherId] = {
      ...nextSnapshot.watchers[nextWatcherId],
      prompt: "Only summarize owner changes after save.",
    };

    const { rerender } = render(
      <RoomTeamDialog
        open
        snapshot={snapshot}
        room={room}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    const watcherMemberButton = screen.getByText(watcherMember.name).closest("button");
    if (!watcherMemberButton) {
      throw new Error("Expected watcher member button");
    }

    await user.click(watcherMemberButton);

    expect(screen.getByRole("textbox", { name: /Watcher prompt/i })).toHaveValue(watcher.prompt ?? "");

    rerender(
      <RoomTeamDialog
        open
        snapshot={nextSnapshot}
        room={nextRoom}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onSaveDefaultTemplate={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: /Watcher prompt/i })).toHaveValue("Only summarize owner changes after save.");
  });
});
