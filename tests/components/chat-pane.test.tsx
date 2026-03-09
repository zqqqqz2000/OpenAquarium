import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatPane } from "@/components/chat/chat-pane";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("ChatPane", () => {
  it("shows routed recipients, handlers, and shell toggles for room messages", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);
    const onToggleLeftSidebar = vi.fn();

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          template={template}
          members={members}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={onToggleLeftSidebar}
        />
      </TooltipProvider>,
    );

    expect(screen.getAllByText("做一个支持 codex-acp 和可配置 team member 的 TypeScript agent-team 产品").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Handled by").length).toBeGreaterThan(0);
    expect(screen.getAllByText("@lead").length).toBeGreaterThan(0);
    expect(screen.getAllByText("To").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Hide projects sidebar" }));

    expect(onToggleLeftSidebar).toHaveBeenCalledTimes(1);
  });

  it("scrolls the transcript to the newest message", () => {
    const scrollCalls: Array<ScrollToOptions | [number, number]> = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: (options: ScrollToOptions | number, top?: number) => {
        scrollCalls.push(typeof options === "number" ? [options, top ?? 0] : options);
      },
    });

    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const template = snapshot.templates[room.templateId];
    const members = room.memberIds.map((memberId) => snapshot.members[memberId]);

    render(
      <TooltipProvider>
        <ChatPane
          leftSidebarCollapsed={false}
          snapshot={snapshot}
          room={room}
          template={template}
          members={members}
          selectedMemberId={room.entryMemberId}
          connected
          onOpenMember={vi.fn()}
          error={undefined}
          onToggleLeftSidebar={vi.fn()}
        />
      </TooltipProvider>,
    );

    const firstCall = scrollCalls[0];

    expect(firstCall).toBeDefined();
    expect(Array.isArray(firstCall)).toBe(false);
    if (!firstCall || Array.isArray(firstCall)) {
      throw new Error("Expected transcript scrollTo to receive ScrollToOptions");
    }
    expect(firstCall.behavior).toBe("auto");
    expect(typeof firstCall.top).toBe("number");
  });
});
