import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomTodoTreesPanel } from "@/components/todo/room-todo-trees-panel";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";

describe("RoomTodoTreesPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and renders aqtree files as a room mindmap", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              roomId: room.id,
              projectId: room.projectId,
              projectInteractiveDirectory:
                "/tmp/openaquarium-project/.openaquarium/interactive",
              roomContextDirectory:
                "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1",
              roomInteractiveDirectory:
                "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive",
              providerAssociationNotice:
                "Provider bindings are intentionally not exported into the room context directory. If this project is reopened elsewhere and a provider is missing, re-associate the project from the room UI.",
              files: [
                {
                  absolutePath:
                    "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive/main.aqtree.xml",
                  fileName: "main.aqtree.xml",
                  modifiedAt: "2026-03-20T10:00:00.000Z",
                  content: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    `<aqtree version="1" roomId="${room.id}" roomName="${room.name}" title="Main plan">`,
                    '  <node id="root" title="Main plan" status="in_progress" member="@lead">',
                    "    <note>Track the delivery plan.</note>",
                    '    <node id="backlog" title="Backlog" status="todo">',
                    "      <note>Pending items.</note>",
                    "    </node>",
                    '    <node id="done" title="Done" status="done">',
                    "      <note>Completed items.</note>",
                    "    </node>",
                    "  </node>",
                    "</aqtree>",
                  ].join("\n"),
                },
                {
                  absolutePath:
                    "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive/secondary.aqtree.xml",
                  fileName: "secondary.aqtree.xml",
                  modifiedAt: "2026-03-20T11:00:00.000Z",
                  content: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    `<aqtree version="1" roomId="${room.id}" roomName="${room.name}" title="Secondary plan">`,
                    '  <node id="secondary-root" title="Secondary plan" status="todo">',
                    '    <node id="qa" title="QA sweep" status="in_progress">',
                    "      <note>Verify the refreshed UI.</note>",
                    "    </node>",
                    "  </node>",
                    "</aqtree>",
                  ].join("\n"),
                },
              ],
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            },
          ),
        ),
      ),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );

    render(
      <div className="h-[720px] w-[960px]">
        <RoomTodoTreesPanel
          room={room}
          runtimeClient={new WorkspaceRuntimeClient()}
        />
      </div>,
    );

    expect(await screen.findByText("AqTree")).toBeInTheDocument();
    expect(await screen.findByText("2 graphs")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /main\.aqtree\.xml/i })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /secondary\.aqtree\.xml/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Backlog")).toBeInTheDocument();
    expect(await screen.findByText("Done")).toBeInTheDocument();

    expect(
      screen.getByText(/Provider bindings are intentionally not exported/i),
    ).not.toBeVisible();

    await user.click(screen.getByText("Workspace info"));

    expect(
      await screen.findByText(/Provider bindings are intentionally not exported/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /secondary\.aqtree\.xml/i }));

    expect(await screen.findByText("QA sweep")).toBeInTheDocument();
  });
});
