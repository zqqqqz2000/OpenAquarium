import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatComposer } from "@/components/chat/chat-composer";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatComposer", () => {
  it("sends a direct message to the selected member and clears the composer", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onSend = vi.fn();

    render(<ChatComposer connected error={undefined} members={members} onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: /Lead Koi/i }));
    expect(screen.getByText("DM @lead")).toBeInTheDocument();

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "先回复用户，再拉 builder。");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith("先回复用户，再拉 builder。", members.find((member) => member.handle === "lead")?.id);
    expect(textbox).toHaveValue("");
    expect(screen.getByText("Group message")).toBeInTheDocument();
  });

  it("keeps the draft and shows an error when sending fails", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onSend = vi.fn(() => Promise.reject(new Error("Failed to fetch")));

    render(<ChatComposer connected error={undefined} members={members} onSend={onSend} />);

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "这条消息不该在失败后消失。");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(textbox).toHaveValue("这条消息不该在失败后消失。");
    expect(screen.getByText("Failed to fetch")).toBeInTheDocument();
  });

  it("keeps the composer enabled while other member streams are still active", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onSend = vi.fn();

    render(<ChatComposer connected error={undefined} members={members} onSend={onSend} sending />);

    const textbox = screen.getByRole("textbox");
    const button = screen.getByRole("button", { name: /Send anyway/i });

    expect(textbox).toBeEnabled();
    expect(button).toBeDisabled();

    await user.type(textbox, "继续发给别的 member。");

    expect(button).toBeEnabled();
  });
});
