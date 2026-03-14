import { render, waitFor } from "@testing-library/react";
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
});
