import { afterEach, describe, expect, it, vi } from "vitest";

import { createSystemClockContext } from "@/domain/identity";

describe("identity helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses wall-clock timestamps while staying monotonic", () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(Date.parse("2026-03-13T01:00:00.000Z"))
      .mockReturnValueOnce(Date.parse("2026-03-13T01:00:00.000Z"))
      .mockReturnValueOnce(Date.parse("2026-03-13T00:59:59.999Z"))
      .mockReturnValueOnce(Date.parse("2026-03-13T01:00:02.000Z"));

    const context = createSystemClockContext(0, "2026-03-13T00:59:59.998Z");

    expect(context.now()).toBe("2026-03-13T01:00:00.000Z");
    expect(context.now()).toBe("2026-03-13T01:00:00.001Z");
    expect(context.now()).toBe("2026-03-13T01:00:00.002Z");
    expect(context.now()).toBe("2026-03-13T01:00:02.000Z");
  });
});
