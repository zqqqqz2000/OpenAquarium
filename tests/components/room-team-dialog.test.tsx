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
      />,
    );

    expect(screen.getByRole("dialog")).toHaveClass("w-[min(96vw,88rem)]");
    expect(screen.getByRole("dialog")).toHaveClass("sm:max-w-[88rem]");

    expect(screen.getByText("这里改的是当前 room 里的团队结构和成员实例配置，不会同步回 team template。")).toBeInTheDocument();

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
    expect(screen.getByText("这个员工继承岗位模板的 prompt、skills、provider 和 watcher 配置；本阶段只开放名字和备注。")).toBeInTheDocument();
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
      />,
    );

    expect(screen.getByRole("textbox", { name: "Handle" })).toHaveDisplayValue(/role-\d+/);

    await user.click(screen.getAllByRole("button", { name: /Add employee/i }).at(-1)!);

    expect(screen.getByRole("textbox", { name: "Name" })).toHaveDisplayValue(/Member \d+/);
    expect(screen.queryByRole("textbox", { name: "Handle" })).not.toBeInTheDocument();
  });
});
