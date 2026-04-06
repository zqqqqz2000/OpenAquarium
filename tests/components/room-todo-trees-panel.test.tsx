import type { ReactNode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@xyflow/react", () => ({
    Background: () => <div data-testid="rf-background" />,
    Controls: () => <div data-testid="rf-controls" />,
    Handle: () => null,
    Position: {
      Left: "left",
      Right: "right",
    },
  ReactFlow: (props: {
    className?: string;
    children?: ReactNode;
    nodeTypes?: Record<string, (props: Record<string, unknown>) => ReactNode>;
    nodes?: Array<{
      data: Record<string, unknown>;
      id: string;
      position: { x: number; y: number };
      type: string;
    }>;
    onMove?: (event: unknown, viewport: { zoom: number }) => void;
  }) => {
      const { children, className, nodeTypes = {}, nodes = [], onMove } = props;

      return (
        <div data-testid="reactflow" className={className}>
          <button
            type="button"
            onClick={() => onMove?.(undefined, { zoom: 0.45 })}
          >
            Mock zoom out
          </button>
          <button
            type="button"
            onClick={() => onMove?.(undefined, { zoom: 1 })}
          >
            Mock zoom in
          </button>
          {children}
          {nodes.map((node) => {
            const NodeComponent = nodeTypes[node.type];
            return NodeComponent ? (
              <NodeComponent
                key={node.id}
                id={node.id}
                data={node.data}
                dragging={false}
                isConnectable={false}
                selected={false}
                type={node.type}
                xPos={node.position.x}
                yPos={node.position.y}
                zIndex={0}
              />
            ) : null;
          })}
        </div>
      );
  },
}));

import { RoomTodoTreesPanel } from "@/components/todo/room-todo-trees-panel";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";

describe("RoomTodoTreesPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a graph-first AqTree view with minimal graph switching and real collapse or zoom interactions", async () => {
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
                    '    <node id="product" title="Product track" status="in_progress">',
                    "      <note>User-facing tasks.</note>",
                    '      <node id="ux" title="UI polish" status="done" />',
                    '      <node id="copy" title="Copy review" status="todo" />',
                    "    </node>",
                    '    <node id="ops" title="Ops track" status="in_progress">',
                    "      <note>Operational follow-ups.</note>",
                    '      <node id="qa" title="QA sweep" status="done" />',
                    '      <node id="handoff" title="Room handoff" status="todo" />',
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
                    '  <node id="secondary-root" title="Secondary plan" status="in_progress">',
                    '    <node id="qa" title="QA sweep" status="done">',
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

    render(
      <div className="h-[720px] w-[960px]">
        <RoomTodoTreesPanel
          room={room}
          runtimeClient={new WorkspaceRuntimeClient()}
        />
      </div>,
    );

    expect(await screen.findByText("Product track")).toBeInTheDocument();
    expect(await screen.findByText("Ops track")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /main\.aqtree\.xml/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /secondary\.aqtree\.xml/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh todo trees/i })).toBeInTheDocument();

    expect(screen.queryByText("AqTree")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace info")).not.toBeInTheDocument();
    expect(screen.queryByText("Graph views")).not.toBeInTheDocument();
    expect(screen.queryByText("2 top groups")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Provider bindings are intentionally not exported/i),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /main\.aqtree\.xml/i })).not.toBeInTheDocument();

    expect(screen.getByText("User-facing tasks.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Collapse Product track/i }));

    await waitFor(() => {
      expect(screen.queryByText("UI polish")).not.toBeInTheDocument();
      expect(screen.queryByText("Copy review")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/2 branches hidden · 1 of 2 items done/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Expand Product track/i }));

    expect(await screen.findByText("UI polish")).toBeInTheDocument();
    expect(await screen.findByText("Copy review")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mock zoom out/i }));

    await waitFor(() => {
      expect(screen.queryByText("User-facing tasks.")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Mock zoom in/i }));
    expect(await screen.findByText("User-facing tasks.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /secondary\.aqtree\.xml/i }));

    expect(await screen.findByText("Secondary plan")).toBeInTheDocument();
    expect(await screen.findByText("QA sweep")).toBeInTheDocument();
    expect(screen.getAllByText("done").length).toBeGreaterThan(0);
  });

  it("keeps a completed tree visible instead of collapsing into an empty todo or graph panel", async () => {
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
                "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1",
              roomInteractiveDirectory:
                "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive",
              providerAssociationNotice: "notice",
              files: [
                {
                  absolutePath:
                    "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive/main.aqtree.xml",
                  fileName: "main.aqtree.xml",
                  modifiedAt: "2026-04-06T16:00:00.000Z",
                  content: [
                    '<?xml version="1.0" encoding="UTF-8"?>',
                    `<aqtree version="1" roomId="${room.id}" roomName="${room.name}" title="Completed plan">`,
                    '  <node id="root" title="Completed plan" status="done">',
                    '    <node id="ship-ui" title="Ship UI" status="done" />',
                    '    <node id="ship-runtime" title="Ship runtime" status="done" />',
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

    render(
      <div className="h-[720px] w-[960px]">
        <RoomTodoTreesPanel
          room={room}
          runtimeClient={new WorkspaceRuntimeClient()}
        />
      </div>,
    );

    expect(await screen.findByText("All items complete")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 items done")).toBeInTheDocument();
    expect(screen.getByText(/There are no unfinished items right now/i)).toBeInTheDocument();
    expect(screen.getByTestId("reactflow")).toBeInTheDocument();
    expect(screen.getByTestId("reactflow")).toHaveClass("h-full", "w-full");
    expect(screen.getByText("Completed plan")).toBeInTheDocument();
    expect(screen.getByText("Ship UI")).toBeInTheDocument();
    expect(screen.getByText("Ship runtime")).toBeInTheDocument();
  });

  it("reloads the current tree when the room updates so the graph does not stay stuck on an old blank viewport", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
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
            providerAssociationNotice: "notice",
            files: [
              {
                absolutePath:
                  "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive/main.aqtree.xml",
                fileName: "main.aqtree.xml",
                modifiedAt: "2026-04-06T16:00:00.000Z",
                content: [
                  '<?xml version="1.0" encoding="UTF-8"?>',
                  `<aqtree version="1" roomId="${room.id}" roomName="${room.name}" title="Initial plan">`,
                  '  <node id="root" title="Initial plan" status="in_progress">',
                  '    <node id="a" title="First branch" status="todo" />',
                  "  </node>",
                  "</aqtree>",
                ].join("\n"),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
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
            providerAssociationNotice: "notice",
            files: [
              {
                absolutePath:
                  "/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive/main.aqtree.xml",
                fileName: "main.aqtree.xml",
                modifiedAt: "2026-04-06T16:05:00.000Z",
                content: [
                  '<?xml version="1.0" encoding="UTF-8"?>',
                  `<aqtree version="1" roomId="${room.id}" roomName="${room.name}" title="Completed plan">`,
                  '  <node id="root" title="Completed plan" status="done">',
                  '    <node id="ship-ui" title="Ship UI" status="done" />',
                  '    <node id="ship-runtime" title="Ship runtime" status="done" />',
                  "  </node>",
                  "</aqtree>",
                ].join("\n"),
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <div className="h-[720px] w-[960px]">
        <RoomTodoTreesPanel
          room={room}
          runtimeClient={new WorkspaceRuntimeClient()}
        />
      </div>,
    );

    expect(await screen.findByText("Initial plan")).toBeInTheDocument();

    rerender(
      <div className="h-[720px] w-[960px]">
        <RoomTodoTreesPanel
          room={{ ...room, updatedAt: "2026-04-06T16:05:00.000Z" }}
          runtimeClient={new WorkspaceRuntimeClient()}
        />
      </div>,
    );

    expect(await screen.findByText("Completed plan")).toBeInTheDocument();
    expect(screen.getByText("All items complete")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
