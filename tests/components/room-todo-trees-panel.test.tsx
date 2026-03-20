import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomTodoTreesPanel } from "@/components/todo/room-todo-trees-panel";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";

describe("RoomTodoTreesPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads and renders aqtodo trees as a room mindmap", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];

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
                "/tmp/openaquarium-project/.openaquarium/interactive/rooms/project-1/room-1",
              providerAssociationNotice:
                "Provider bindings are intentionally not exported into the room context directory. If this project is reopened elsewhere and a provider is missing, re-associate the project from the room UI.",
              files: [
                {
                  absolutePath:
                    "/tmp/openaquarium-project/.openaquarium/interactive/rooms/project-1/room-1/main.aqtodo.xml",
                  fileName: "main.aqtodo.xml",
                  modifiedAt: "2026-03-20T10:00:00.000Z",
                  content: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    `<aqtodo version="1" roomId="${room.id}" roomName="${room.name}" title="Main plan">`,
                    '  <node id="root" title="Main plan" status="in_progress" member="@lead">',
                    "    <note>Track the delivery plan.</note>",
                    '    <node id="backlog" title="Backlog" status="todo">',
                    "      <note>Pending items.</note>",
                    "    </node>",
                    '    <node id="done" title="Done" status="done">',
                    "      <note>Completed items.</note>",
                    "    </node>",
                    "  </node>",
                    "</aqtodo>",
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

    expect(await screen.findByText("AqTodo Tree")).toBeInTheDocument();
    expect((await screen.findAllByText("main.aqtodo.xml")).length).toBeGreaterThan(
      0,
    );
    expect(await screen.findByText("Backlog")).toBeInTheDocument();
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(
      await screen.findByText(/Provider bindings are intentionally not exported/i),
    ).toBeInTheDocument();
  });
});
