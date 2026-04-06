import { describe, expect, it } from "vitest";

import { normalizeRoomAssetPath, resolveRoomAssetUrl } from "@/lib/room-assets";

describe("room asset paths", () => {
  it("normalizes root-relative workspace paths before routing through the room asset api", () => {
    expect(normalizeRoomAssetPath("/.openaquarium/interactive/rooms/room_1/assets/user-chat/image.png")).toBe(
      "./.openaquarium/interactive/rooms/room_1/assets/user-chat/image.png",
    );

    expect(
      decodeURIComponent(
        resolveRoomAssetUrl(
          "room_1",
          "/.openaquarium/interactive/rooms/room_1/assets/user-chat/image.png",
          "http://127.0.0.1:4301",
        ),
      ),
    ).toContain("path=./.openaquarium/interactive/rooms/room_1/assets/user-chat/image.png");
  });

  it("keeps explicit relative workspace paths stable", () => {
    expect(normalizeRoomAssetPath("./artifacts/plan.png")).toBe("./artifacts/plan.png");

    expect(
      decodeURIComponent(resolveRoomAssetUrl("room_1", "./artifacts/plan.png", "http://127.0.0.1:4301")),
    ).toContain("path=./artifacts/plan.png");
  });
});
