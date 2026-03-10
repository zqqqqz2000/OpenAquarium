import { useEffect, type CSSProperties, type PointerEvent } from "react";

import { useNavigate } from "@tanstack/react-router";

import type { Room } from "@/domain/model";
import { ChatPane } from "@/components/chat/chat-pane";
import { clampLeftPanelWidth, getRoomGridColumns } from "@/lib/shell-panels";
import { Sidebar } from "@/components/layout/sidebar";
import { useShellPanels } from "@/components/layout/use-shell-panels";
import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function WorkspaceScreen(props: { projectId?: string; roomId?: string; memberId?: string }) {
  const { projectId, roomId, memberId } = props;
  const navigate = useNavigate();
  const snapshot = useWorkspaceStore((state) => state.snapshot);
  const loading = useWorkspaceStore((state) => state.loading);
  const connected = useWorkspaceStore((state) => state.connected);
  const error = useWorkspaceStore((state) => state.error);
  const selectRoom = useWorkspaceStore((state) => state.selectRoom);
  const selectMember = useWorkspaceStore((state) => state.selectMember);
  const toggleMemberMonitoring = useWorkspaceStore((state) => state.toggleMemberMonitoring);
  const runWatcher = useWorkspaceStore((state) => state.runWatcher);
  const updateMemberConfig = useWorkspaceStore((state) => state.updateMemberConfig);
  const setEntryMember = useWorkspaceStore((state) => state.setEntryMember);
  const upsertWatcher = useWorkspaceStore((state) => state.upsertWatcher);
  const sendUserMessage = useWorkspaceStore((state) => state.sendUserMessage);
  const {
    leftCollapsed,
    leftWidth,
    rightCollapsed,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    setLeftWidth,
  } = useShellPanels();

  useEffect(() => {
    if (projectId && roomId) {
      selectRoom(projectId, roomId);
    }
  }, [projectId, roomId, selectRoom]);

  useEffect(() => {
    if (memberId) {
      selectMember(memberId);
    }
  }, [memberId, selectMember]);

  const selectedProjectId = projectId ?? snapshot.selection.projectId ?? snapshot.projectOrder[0];
  const roomIds = selectedProjectId ? snapshot.roomOrderByProject[selectedProjectId] ?? [] : [];
  const selectedRoomId = roomId ?? snapshot.selection.roomId ?? roomIds[0];
  const room = selectedRoomId ? snapshot.rooms[selectedRoomId] : undefined;
  const template = room ? snapshot.templates[room.templateId] : undefined;
  const members = room ? room.memberIds.map((memberId) => snapshot.members[memberId]) : [];
  const routedMember = memberId ? members.find((candidate) => candidate.id === memberId) : undefined;
  const selectedMemberId = routedMember?.id ?? snapshot.selection.memberId;
  const projects = snapshot.projectOrder.map((candidate) => snapshot.projects[candidate]);
  const roomsByProject = Object.fromEntries(
    snapshot.projectOrder.map((candidate) => [
      candidate,
      (snapshot.roomOrderByProject[candidate] ?? []).map((candidateRoomId) => snapshot.rooms[candidateRoomId]),
    ]),
  ) as Record<string, Room[]>;
  const openMemberStudio = (targetMemberId: string): void => {
    selectMember(targetMemberId);
    if (!selectedProjectId || !selectedRoomId) {
      return;
    }

    void navigate({
      to: "/projects/$projectId/rooms/$roomId/members/$memberId",
      params: {
        projectId: selectedProjectId,
        roomId: selectedRoomId,
        memberId: targetMemberId,
      },
    });
  };

  const closeMemberStudio = (): void => {
    if (!selectedProjectId || !selectedRoomId) {
      return;
    }

    void navigate({
      to: "/projects/$projectId/rooms/$roomId",
      params: {
        projectId: selectedProjectId,
        roomId: selectedRoomId,
      },
    });
  };

  const startSidebarResize = (event: PointerEvent<HTMLDivElement>): void => {
    const startX = event.clientX;
    const startWidth = leftWidth;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent): void => {
      const nextWidth = clampLeftPanelWidth(startWidth + moveEvent.clientX - startX);
      setLeftWidth(nextWidth);
    };

    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const gridColumns = getRoomGridColumns({
    leftCollapsed,
    leftWidth,
    rightCollapsed,
  });
  const gridStyle = {
    "--oa-left-panel": gridColumns.leftPanel,
  } as CSSProperties;

  return (
    <>
      <div className="room-grid" style={gridStyle}>
        {!leftCollapsed ? (
          <button
            aria-label="Close projects sidebar"
            className="absolute inset-y-0 right-0 z-10 hidden bg-background/48 backdrop-blur-sm max-[860px]:block left-[min(21rem,82vw)]"
            type="button"
            onClick={toggleLeftCollapsed}
          />
        ) : null}
        <Sidebar
          collapsed={leftCollapsed}
          projects={projects}
          roomsByProject={roomsByProject}
          activeProjectId={selectedProjectId}
          activeRoomId={selectedRoomId}
          templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
          connected={connected}
          error={error}
          loading={loading}
          onResizeStart={startSidebarResize}
        />
        <ChatPane
          leftSidebarCollapsed={leftCollapsed}
          rightSidebarCollapsed={rightCollapsed}
          snapshot={snapshot}
          room={room}
          template={template}
          members={members}
          selectedMemberId={selectedMemberId}
          connected={connected}
          error={error}
          onOpenMember={openMemberStudio}
          onToggleLeftSidebar={toggleLeftCollapsed}
          onToggleRightSidebar={toggleRightCollapsed}
        />
      </div>
      <MemberStudioDialog
        snapshot={snapshot}
        room={room}
        member={routedMember}
        connected={connected}
        error={error}
        onClose={closeMemberStudio}
        onToggleMonitor={(targetMemberId) => void toggleMemberMonitoring(targetMemberId)}
        onSaveConfig={(input) => void updateMemberConfig(input)}
        onSetEntryMember={(targetMemberId) => void setEntryMember(targetMemberId)}
        onSaveWatcher={(input) => void upsertWatcher(input)}
        onRunWatcher={(watcherId) => void runWatcher(watcherId)}
        onSendDirectMessage={(content, directMemberId) => void sendUserMessage(content, directMemberId)}
      />
    </>
  );
}
