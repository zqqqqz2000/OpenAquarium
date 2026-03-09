import { describe, expect, it } from "vitest";

import { mapRoomMessagesToUIMessages } from "@/lib/chat/workspace-ui-message";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

describe("workspace-ui-message mapping", () => {
  it("keeps handler summaries on user messages but hides internal handler state on member-authored messages", () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const messages = mapRoomMessagesToUIMessages(snapshot, room);

    const userMessage = messages.find((message) => message.metadata?.authorKind === "user");
    const memberMessages = messages.filter((message) => message.metadata?.authorKind === "member");

    expect(userMessage?.metadata?.handlerSummaries?.length ?? 0).toBeGreaterThan(0);
    expect(memberMessages.every((message) => (message.metadata?.handlerSummaries?.length ?? 0) === 0)).toBe(true);
  });
});
