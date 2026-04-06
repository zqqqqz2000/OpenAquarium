import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import "../helpers/mock-streamdown-plugins";
import { MessageMarkdown } from "@/components/chat/message-markdown";

describe("MessageMarkdown", () => {
  it("renders math formulas while preserving cjk emphasis", async () => {
    const { container, getByText } = render(
      <MessageMarkdown
        content={[
          "Inline: $E=mc^2$",
          "",
          "$$",
          "a^2 + b^2 = c^2",
          "$$",
          "",
          "这是**重点**。",
        ].join("\n")}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".katex")).toBeInTheDocument();
    });
    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
    expect(getByText("重点", { selector: '[data-streamdown="strong"]' })).toBeInTheDocument();
  });

  it("highlights role/employee assignment syntax using the resolved employee handle", () => {
    const { getByText } = render(
      <MessageMarkdown
        content="@>builder/builder-4 跟进实现"
        mentionHandles={new Set(["builder-4"])}
      />,
    );

    expect(getByText("@>builder/builder-4")).toHaveAttribute("data-message-mention-kind", "assignment");
  });

  it("renders blockquoted code snippets and opens image previews with room asset urls", async () => {
    const user = userEvent.setup();

    render(
      <MessageMarkdown
        roomId="room-rich"
        content={[
          "> 代码证据",
          ">",
          "> ```ts",
          '> console.log("quoted");',
          "> ```",
          "",
          "![流程图](./artifacts/plan.png)",
        ].join("\n")}
      />,
    );

    const blockquote = screen
      .getAllByText((_, element) => element?.textContent === 'console.log("quoted");')[0]
      ?.closest('[data-streamdown="blockquote"]');

    expect(blockquote).toBeInTheDocument();

    const inlineImage = screen.getByRole("img", { name: "流程图" });
    expect(inlineImage.getAttribute("src")).toContain(
      "http://127.0.0.1:4301/api/rooms/room-rich/assets?path=",
    );
    expect(decodeURIComponent(inlineImage.getAttribute("src") ?? "")).toContain(
      "./artifacts/plan.png",
    );

    await user.click(screen.getByRole("button", { name: "Open image preview: 流程图" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("/artifacts/plan.png")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("img", { name: "流程图" }).length).toBeGreaterThanOrEqual(1);
  });
});
