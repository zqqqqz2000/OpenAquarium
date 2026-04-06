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

  it("posts manual project path inspection requests to the web endpoint", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({
          path: "/tmp/manual-project",
          projectName: "Manual Project",
          projectInteractiveDirectory: "/tmp/manual-project/.openaquarium/interactive",
          hasOpenAquariumDirectory: false,
          canImport: false,
          roomCount: 0,
          rooms: [],
        }), {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new WorkspaceRuntimeClient();

    await expect(client.inspectProjectPath({ path: "/tmp/manual-project" })).resolves.toMatchObject({
      path: "/tmp/manual-project",
      projectName: "Manual Project",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${client.baseUrl}/api/system/project-path/inspect`,
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "/tmp/manual-project" }),
      }),
    );
  });
});
