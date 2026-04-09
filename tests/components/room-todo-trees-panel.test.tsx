import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomTodoTreesPanel } from "@/components/todo/room-todo-trees-panel";
import type { Room } from "@/domain/model";
import { getRoomTodoTreesPanelStorageKey } from "@/lib/room-todo-trees-panel-state";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

function createTodoTreeResponse(
  room: Pick<Room, "id" | "name" | "projectId">,
  files: Array<{
    absolutePath: string;
    content: string;
    fileName: string;
    modifiedAt: string;
  }>,
): Response {
  return new Response(
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
      files,
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );
}

function createTreeFile(params: {
  fileName: string;
  modifiedAt: string;
  room: Pick<Room, "id" | "name">;
  title: string;
  nodes: string[];
}): {
  absolutePath: string;
  content: string;
  fileName: string;
  modifiedAt: string;
} {
  const { fileName, modifiedAt, nodes, room, title } = params;

  return {
    absolutePath: `/tmp/openaquarium-project/.openaquarium/interactive/rooms/room-1/interactive/${fileName}`,
    content: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      `<aqtree version="1" roomId="${room.id}" roomName="${room.name}" title="${title}">`,
      ...nodes,
      "</aqtree>",
    ].join("\n"),
    fileName,
    modifiedAt,
  };
}

function renderPanel(room: Room) {
  return render(
    <div className="h-[720px] w-[960px]">
      <RoomTodoTreesPanel
        room={room}
        runtimeClient={new WorkspaceRuntimeClient()}
      />
    </div>,
  );
}

describe("RoomTodoTreesPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("renders the outline-only todo workspace with inspector, filters, and file switching", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          createTodoTreeResponse(room, [
            createTreeFile({
              fileName: "main.aqtree.xml",
              modifiedAt: "2026-03-20T10:00:00.000Z",
              room,
              title: "Main plan",
              nodes: [
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
              ],
            }),
            createTreeFile({
              fileName: "secondary.aqtree.xml",
              modifiedAt: "2026-03-20T11:00:00.000Z",
              room,
              title: "Secondary plan",
              nodes: [
                '  <node id="secondary-root" title="Secondary plan" status="in_progress">',
                '    <node id="qa" title="QA sweep" status="done">',
                "      <note>Verify the refreshed UI.</note>",
                "    </node>",
                "  </node>",
              ],
            }),
          ]),
        ),
      ),
    );

    renderPanel(room);

    expect(await screen.findByText("Workspace Controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "split" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "graph" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "outline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compact/i })).not.toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(screen.getByText("Inspector")).toBeInTheDocument();
    const outlineHeader = screen.getByText("Outline").closest("div");
    const outlineSection = screen.getByText("Outline").closest("section");
    const inspectorHeader = screen.getByText("Inspector").closest("div");
    const inspectorPane = screen.getByText("Inspector").closest("aside");
    expect(outlineSection).toHaveClass("flex", "min-h-[14rem]", "overflow-hidden");
    expect(outlineHeader?.nextElementSibling).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(inspectorPane).toHaveClass("flex", "min-h-[14rem]", "overflow-hidden");
    expect(inspectorHeader?.nextElementSibling).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(screen.getByRole("button", { name: /main\.aqtree\.xml/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /secondary\.aqtree\.xml/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh todo trees/i })).toBeInTheDocument();
    expect(screen.getAllByText("Product track").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ops track").length).toBeGreaterThan(0);
    expect(screen.getByText(/Tree list with filter controls wired above\./i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /done/i }));

    await waitFor(() => {
      expect(screen.getAllByText("UI polish").length).toBeGreaterThan(0);
      expect(screen.queryByText("Copy review")).not.toBeInTheDocument();
      expect(screen.queryByText("Room handoff")).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /secondary\.aqtree\.xml/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Secondary plan").length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: /secondary\.aqtree\.xml/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("QA sweep")).toBeInTheDocument();
  });

  it("renders the todo workspace shell without an outer rounded corner", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          createTodoTreeResponse(room, [
            createTreeFile({
              fileName: "main.aqtree.xml",
              modifiedAt: "2026-04-08T09:00:00.000Z",
              room,
              title: "Main plan",
              nodes: [
                '  <node id="root" title="Main plan" status="in_progress">',
                '    <node id="ship-ui" title="Ship UI" status="done" />',
                "  </node>",
              ],
            }),
          ]),
        ),
      ),
    );

    const { container } = renderPanel(room);

    expect(await screen.findByText("Workspace Controls")).toBeInTheDocument();

    const panelShell = container.firstElementChild?.firstElementChild;
    expect(panelShell).toBeInstanceOf(HTMLDivElement);
    expect(panelShell).toHaveClass("rounded-none");
    expect(panelShell).not.toHaveClass("rounded-[1.75rem]");
  });

  it("keeps a completed tree visible in the outline workspace instead of collapsing into an empty panel", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];

    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          createTodoTreeResponse(room, [
            createTreeFile({
              fileName: "main.aqtree.xml",
              modifiedAt: "2026-04-06T16:00:00.000Z",
              room,
              title: "Completed plan",
              nodes: [
                '  <node id="root" title="Completed plan" status="done">',
                '    <node id="ship-ui" title="Ship UI" status="done" />',
                '    <node id="ship-runtime" title="Ship runtime" status="done" />',
                "  </node>",
              ],
            }),
          ]),
        ),
      ),
    );

    renderPanel(room);

    expect(await screen.findByText("All items complete")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 items done")).toBeInTheDocument();
    expect(screen.getByText(/There are no unfinished items right now/i)).toBeInTheDocument();
    expect(screen.getByText("Outline")).toBeInTheDocument();
    expect(screen.getByText("Inspector")).toBeInTheDocument();
    expect(screen.getAllByText("Completed plan").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ship UI").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ship runtime").length).toBeGreaterThan(0);
  });

  it("persists the selected todo workspace controls across remounts", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const user = userEvent.setup();
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        createTodoTreeResponse(room, [
          createTreeFile({
            fileName: "main.aqtree.xml",
            modifiedAt: "2026-03-20T10:00:00.000Z",
            room,
            title: "Main plan",
            nodes: [
              '  <node id="root" title="Main plan" status="in_progress">',
              '    <node id="product" title="Product track" status="in_progress">',
              '      <node id="ux" title="UI polish" status="done" />',
              '      <node id="copy" title="Copy review" status="todo" />',
              "    </node>",
              "  </node>",
            ],
          }),
          createTreeFile({
            fileName: "secondary.aqtree.xml",
            modifiedAt: "2026-03-20T11:00:00.000Z",
            room,
            title: "Secondary plan",
            nodes: [
              '  <node id="secondary-root" title="Secondary plan" status="done">',
              '    <node id="qa" title="QA sweep" status="done" />',
              "  </node>",
            ],
          }),
        ]),
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const { unmount } = renderPanel(room);

    expect(await screen.findByText("Workspace Controls")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /done/i }));
    await user.click(screen.getByRole("button", { name: /secondary\.aqtree\.xml/i }));

    const storageKey = getRoomTodoTreesPanelStorageKey(room.id);

    await waitFor(() => {
      expect(window.localStorage.getItem(storageKey)).toContain('"statusFilter":"done"');
      expect(window.localStorage.getItem(storageKey)).toContain("secondary.aqtree.xml");
    });

    unmount();
    renderPanel(room);

    expect(await screen.findByText("Workspace Controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /secondary\.aqtree\.xml/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "split" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "graph" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "outline" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /compact/i })).not.toBeInTheDocument();
    expect(screen.getAllByText("Secondary plan").length).toBeGreaterThan(0);
    expect(screen.getByText("QA sweep")).toBeInTheDocument();
  });

  it("reloads the current tree when the room updates so the outline workspace refreshes with new data", async () => {
    const snapshot = createSeedWorkspace();
    const room = snapshot.rooms[snapshot.selection.roomId!];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        createTodoTreeResponse(room, [
          createTreeFile({
            fileName: "main.aqtree.xml",
            modifiedAt: "2026-04-06T16:00:00.000Z",
            room,
            title: "Initial plan",
            nodes: [
              '  <node id="root" title="Initial plan" status="in_progress">',
              '    <node id="a" title="First branch" status="todo" />',
              "  </node>",
            ],
          }),
        ]),
      )
      .mockResolvedValueOnce(
        createTodoTreeResponse(room, [
          createTreeFile({
            fileName: "main.aqtree.xml",
            modifiedAt: "2026-04-06T16:05:00.000Z",
            room,
            title: "Completed plan",
            nodes: [
              '  <node id="root" title="Completed plan" status="done">',
              '    <node id="ship-ui" title="Ship UI" status="done" />',
              '    <node id="ship-runtime" title="Ship runtime" status="done" />',
              "  </node>",
            ],
          }),
        ]),
      );

    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderPanel(room);

    await waitFor(() => {
      expect(screen.getAllByText("Initial plan").length).toBeGreaterThan(0);
    });

    rerender(
      <div className="h-[720px] w-[960px]">
        <RoomTodoTreesPanel
          room={{ ...room, updatedAt: "2026-04-06T16:05:00.000Z" }}
          runtimeClient={new WorkspaceRuntimeClient()}
        />
      </div>,
    );

    expect(await screen.findByText("All items complete")).toBeInTheDocument();
    expect(screen.getAllByText("Completed plan").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
