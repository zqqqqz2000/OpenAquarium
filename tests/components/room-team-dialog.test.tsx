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
    await user.click(screen.getByRole("button", { name: /Add member/i }));
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
});
