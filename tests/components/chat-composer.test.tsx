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

    render(<ChatComposer members={members} onSend={onSend} />);

    await user.click(screen.getByRole("button", { name: /Lead Koi/i }));
    expect(screen.getByText("DM @lead")).toBeInTheDocument();

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "先回复用户，再拉 builder。");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith("先回复用户，再拉 builder。", members.find((member) => member.handle === "lead")?.id);
    expect(textbox).toHaveValue("");
    expect(screen.getByText("Group message")).toBeInTheDocument();
  });
});

