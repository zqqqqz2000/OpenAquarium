import { fireEvent, render, screen } from "@testing-library/react";
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
    const lead = members.find((member) => member.handle === "lead");
    const onSend = vi.fn();

    if (!lead) {
      throw new Error("Expected a lead member");
    }

    render(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={onSend}
        preferredDirectMemberId={lead.id}
        focusSignal={1}
      />,
    );

    expect(await screen.findByText("DM @lead")).toBeInTheDocument();
    expect(screen.queryByText("Group message")).not.toBeInTheDocument();
    expect(screen.queryByText("Quick direct targets")).not.toBeInTheDocument();

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "先回复用户，再拉 builder。");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith("先回复用户，再拉 builder。", lead.id);
    expect(textbox).toHaveValue("");
    expect(screen.queryByText("DM @lead")).not.toBeInTheDocument();
  });

  it("locks the composer to a single direct target when fixedDirectMemberId is provided", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const lead = members.find((member) => member.handle === "lead");
    const onSend = vi.fn();

    if (!lead) {
      throw new Error("Expected a lead member");
    }

    render(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={onSend}
        fixedDirectMemberId={lead.id}
      />,
    );

    expect(screen.getByText("DM @lead")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear target/i })).not.toBeInTheDocument();

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "只发给当前 member。");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith("只发给当前 member。", lead.id);
  });

  it("includes the active human id when sending from a room with multiple humans", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onSend = vi.fn();

    render(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={onSend}
        humanOptions={[
          {
            accountId: "account_alice",
            humanId: "human_room_1_account_alice",
            label: "Alice",
            handle: "alice",
          },
        ]}
        activeHumanAccountId="account_alice"
      />,
    );

    await user.type(screen.getByRole("textbox"), "@alice 帮我看一下这段实现。?");
    await user.click(screen.getByRole("button", { name: /Send/i }));

    expect(onSend).toHaveBeenCalledWith("@alice 帮我看一下这段实现。?", {
      authorHumanId: "human_room_1_account_alice",
      directMemberId: undefined,
    });
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

  it("offers passive reference completion with @ without showing a static member list", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(<ChatComposer connected error={undefined} members={members} onSend={vi.fn()} />);

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "请 @re");

    expect(screen.getByText("Reference member")).toBeInTheDocument();
    expect(screen.getByText("@research")).toBeInTheDocument();
    expect(screen.queryByText("Quick direct targets")).not.toBeInTheDocument();
    expect(screen.getByText("Reference member").parentElement?.className).toContain("bottom-[calc(100%+0.5rem)]");

    await user.keyboard("{Enter}");

    expect(textbox).toHaveValue("请 @research ");
  });

  it("offers assignment completion with the @> trigger", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(<ChatComposer connected error={undefined} members={members} onSend={vi.fn()} />);

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "安排一下 @>re");

    expect(screen.getByText("Assign member")).toBeInTheDocument();
    expect(screen.getByText("@>research")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    expect(textbox).toHaveValue("安排一下 @>research ");
  });

  it("sends on Enter and keeps Shift+Enter for newlines", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onSend = vi.fn();

    render(<ChatComposer connected error={undefined} members={members} onSend={onSend} />);

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "第一行");
    await user.keyboard("{Shift>}{Enter}{/Shift}");

    expect(textbox).toHaveValue("第一行\n");

    await user.type(textbox, "第二行");
    await user.keyboard("{Enter}");

    expect(onSend).toHaveBeenCalledWith("第一行\n第二行", undefined);
    expect(textbox).toHaveValue("");
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

  it("uploads image files and appends room asset markdown into the composer", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onUploadFiles = vi.fn(async () => [
      {
        path: "./.openaquarium/interactive/rooms/room_1/assets/user-chat/uploaded-diagram.png",
        markdown: "![uploaded diagram](./.openaquarium/interactive/rooms/room_1/assets/user-chat/uploaded-diagram.png)",
      },
    ]);

    render(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={vi.fn()}
        onUploadFiles={onUploadFiles}
        roomId={room.id}
      />,
    );

    const uploadInput = screen.getByLabelText("Upload images");
    const file = new File(["png-image"], "uploaded diagram.png", { type: "image/png" });

    await user.upload(uploadInput, file);

    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    const uploadedFilesCall = onUploadFiles.mock.calls.at(0);
    expect(uploadedFilesCall?.at(0)).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveValue(
      "![uploaded diagram](./.openaquarium/interactive/rooms/room_1/assets/user-chat/uploaded-diagram.png)",
    );
    expect(await screen.findByText("Image preview")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "uploaded diagram" })).toHaveAttribute(
      "src",
      expect.stringContaining(`/api/rooms/${room.id}/assets?path=`),
    );
  });

  it("intercepts pasted images, uploads them, and inserts markdown into the composer", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onUploadFiles = vi.fn(async () => [
      {
        path: "./.openaquarium/interactive/rooms/room_1/assets/user-chat/pasted-image.png",
        markdown: "![pasted image](./.openaquarium/interactive/rooms/room_1/assets/user-chat/pasted-image.png)",
      },
    ]);

    render(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={vi.fn()}
        onUploadFiles={onUploadFiles}
        roomId={room.id}
      />,
    );

    const textbox = screen.getByRole("textbox");
    const file = new File(["png-image"], "pasted image.png", { type: "image/png" });

    fireEvent.paste(textbox, {
      clipboardData: {
        files: [file],
        items: [],
      },
    });

    expect(onUploadFiles).toHaveBeenCalledTimes(1);
    expect(await screen.findByDisplayValue(
      "![pasted image](./.openaquarium/interactive/rooms/room_1/assets/user-chat/pasted-image.png)",
    )).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "pasted image" })).toBeInTheDocument();
  });

  it("shows a clear degradation error for unsupported pasted files", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onUploadFiles = vi.fn();

    render(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={vi.fn()}
        onUploadFiles={onUploadFiles}
      />,
    );

    fireEvent.paste(screen.getByRole("textbox"), {
      clipboardData: {
        files: [new File(["plain text"], "note.txt", { type: "text/plain" })],
        items: [],
      },
    });

    expect(onUploadFiles).not.toHaveBeenCalled();
    expect(await screen.findByText("Only PNG, JPEG, GIF, and WebP images are supported.")).toBeInTheDocument();
  });

  it("can receive a preferred direct target and focus signal from the parent view", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const research = members.find((member) => member.handle === "research");
    const onSend = vi.fn();

    if (!research) {
      throw new Error("Expected a research member");
    }

    const { rerender } = render(<ChatComposer connected error={undefined} members={members} onSend={onSend} />);

    rerender(
      <ChatComposer
        connected
        error={undefined}
        members={members}
        onSend={onSend}
        preferredDirectMemberId={research.id}
        focusSignal={1}
      />,
    );

    expect(screen.getByText("DM @research")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });
});
