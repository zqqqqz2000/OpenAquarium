import { describe, expect, it } from "vitest";

import { formatTime } from "@/lib/time";

describe("time helpers", () => {
  it("formats clock time in 24-hour mode for the requested timezone", () => {
    const timestamp = "2026-03-13T08:00:00.000Z";

    expect(formatTime(timestamp, { timeZone: "UTC" })).toBe("08:00");
    expect(formatTime(timestamp, { timeZone: "Asia/Shanghai" })).toBe("16:00");
  });
});
