import { StrictMode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomAssetImage } from "@/components/media/room-asset-image";

describe("RoomAssetImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("finishes room-asset bootstrap and renders the image under StrictMode", async () => {
    const storage = new Map<string, string>([["oa.sessionToken", "session-token"]]);
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        storage.delete(key);
      }),
    });
    const fetchMock = vi.fn(() => Promise.resolve(new Response("", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <StrictMode>
        <RoomAssetImage
          roomId="room_1"
          src="./artifacts/plan.png"
          alt="流程图"
        />
      </StrictMode>,
    );

    expect(screen.getByText("Loading image...")).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "http://localhost:4301/api/auth/session",
        expect.objectContaining({
          method: "GET",
          credentials: "include",
        }),
      );
    });

    await waitFor(() => {
      const image = screen.getByRole("img", { name: "流程图" });
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute(
        "src",
        expect.stringContaining("http://localhost:4301/api/rooms/room_1/assets?path="),
      );
    });
  });
});
