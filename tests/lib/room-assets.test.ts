import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureRoomAssetSessionCookie, normalizeRoomAssetPath, resolveRoomAssetUrl } from "@/lib/room-assets";

describe("room asset paths", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("dedupes concurrent bootstrap requests for the same session token", async () => {
    const storage = new Map<string, string>([["oa.sessionToken", "session-token"]]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(new Response("", { status: 200 })), 0);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost:5173/") as unknown as Location);

    const [first, second] = await Promise.all([
      ensureRoomAssetSessionCookie(),
      ensureRoomAssetSessionCookie(),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4301/api/auth/session",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    );
  });

  it("reissues bootstrap after a previous successful request instead of treating 200 as durable cookie state", async () => {
    const storage = new Map<string, string>([["oa.sessionToken", "session-token"]]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", new URL("http://localhost:5173/") as unknown as Location);

    await ensureRoomAssetSessionCookie();
    await ensureRoomAssetSessionCookie();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
