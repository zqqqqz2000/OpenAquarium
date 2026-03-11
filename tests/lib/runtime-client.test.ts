// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceRuntimeClient } from "@/lib/runtime-client";

describe("WorkspaceRuntimeClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the server's error field instead of raw JSON text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: "You've hit your usage limit. Try again later." }), {
            status: 500,
            headers: {
              "content-type": "application/json",
            },
          }),
        ),
      ),
    );

    const client = new WorkspaceRuntimeClient();

    await expect(
      client.sendTemplateStudioChat({
        templateId: "template-product-pod",
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("You've hit your usage limit. Try again later.");
  });
});
