import { describe, expect, it } from "vitest";

import { getErrorMessage } from "@/server/error-utils";

describe("getErrorMessage", () => {
  it("prefers nested RPC data.message over a generic top-level message", () => {
    expect(
      getErrorMessage({
        code: -32603,
        message: "Internal error",
        data: {
          message: "You've hit your usage limit. Try again later.",
        },
      } as {
        code: number;
        message: string;
        data: { message: string };
      }),
    ).toBe("You've hit your usage limit. Try again later.");
  });
});
