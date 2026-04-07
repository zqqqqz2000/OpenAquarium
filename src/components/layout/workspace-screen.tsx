import { startTransition, useDeferredValue, useEffect, useMemo, useState, type CSSProperties, type PointerEvent } from "react";

import { useNavigate } from "@tanstack/react-router";
import { shallow } from "zustand/shallow";

import type { Room, WorkspaceSnapshot } from "@/domain/model";
import { ChatPane } from "@/components/chat/chat-pane";
import { clampLeftPanelWidth, clampRightPanelWidth, getRoomGridColumns } from "@/lib/shell-panels";
import { buildRoomWatcherPauseSummaryById, type RoomWatcherPauseSummary } from "@/lib/watcher-state";
import { buildProjectActivitySummaries } from "@/lib/workspace-activity";
import { Sidebar } from "@/components/layout/sidebar";
import { useShellPanels } from "@/components/layout/use-shell-panels";
import { getMemberActivitySummary } from "@/components/members/member-utils";
import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import { RoomTeamDialog } from "@/components/rooms/room-team-dialog";
import { TemplateStudioDialog } from "@/components/templates/template-studio-dialog";
import { resolveRoomTeamSummary } from "@/lib/room-team";
import { useWorkspaceStore } from "@/store/workspace-store-context";

function buildRunningMemberPreviewsForRoom(snapshot: WorkspaceSnapshot, room: Room) {
  return room.memberIds
    .map((memberId) => snapshot.members[memberId])
    .filter((member): member is NonNullable<typeof member> => Boolean(member) && member.status === "running")
    .map((member) => ({
      roomId: room.id,
      memberId: member.id,
      memberName: member.name,
      memberHandle: member.handle,
      latestContentPreview: getMemberActivitySummary(snapshot, member).latestContentPreview,
    }));
}

function currentRouteStillExists(args: {
  snapshot: WorkspaceSnapshot;
  projectId?: string;
  roomId?: string;
  memberId?: string;
}): boolean {
  const { snapshot, projectId, roomId, memberId } = args;

  if (!projectId && !roomId && !memberId) {
    return true;
  }

  if (!projectId || !roomId) {
    return false;
  }

  const room = snapshot.rooms[roomId];
  if (!room || room.projectId !== projectId) {
    return false;
  }

  if (!memberId) {
    return true;
  }

  const member = snapshot.members[memberId];
  return Boolean(member && member.roomId === roomId && room.memberIds.includes(memberId));
}

function resolveFallbackRoomRoute(snapshot: WorkspaceSnapshot): { projectId: string; roomId: string } | undefined {
  const preferredProjectId =
    snapshot.selection.projectId && snapshot.projects[snapshot.selection.projectId]
      ? snapshot.selection.projectId
      : undefined;
  const preferredRoomId =
    snapshot.selection.roomId && snapshot.rooms[snapshot.selection.roomId]
      ? snapshot.selection.roomId
      : undefined;

  if (preferredProjectId && preferredRoomId && snapshot.rooms[preferredRoomId]?.projectId === preferredProjectId) {
    return {
      projectId: preferredProjectId,
      roomId: preferredRoomId,
    };
  }

  const preferredProjectRooms = preferredProjectId ? snapshot.roomOrderByProject[preferredProjectId] ?? [] : [];
  if (preferredProjectId && preferredProjectRooms[0]) {
    return {
      projectId: preferredProjectId,
      roomId: preferredProjectRooms[0],
    };
  }

  for (const candidateProjectId of snapshot.projectOrder) {
    const candidateRoomId = snapshot.roomOrderByProject[candidateProjectId]?.[0];
    if (candidateRoomId) {
      return {
        projectId: candidateProjectId,
        roomId: candidateRoomId,
      };
    }
  }

  return undefined;
}

interface WorkspaceSidebarData {
  projects: ReturnType<typeof buildProjectActivitySummaries>[number]["project"][];
  roomsByProject: Record<string, Room[]>;
  projectActivityById: Record<string, ReturnType<typeof buildProjectActivitySummaries>[number]>;
  roomActivityById: ReturnType<typeof buildRoomActivityIndex>;
  roomWatcherPauseById: Record<string, RoomWatcherPauseSummary>;
  projectUnreadCountById: Record<string, number>;
  roomUnreadCountById: Record<string, number>;
  projectRunningMembersById: Record<string, ReturnType<typeof buildRunningMemberPreviewsForRoom>>;
  roomRunningMembersById: Record<string, ReturnType<typeof buildRunningMemberPreviewsForRoom>>;
}

function buildRoomActivityIndex(projectSummaries: ReturnType<typeof buildProjectActivitySummaries>) {
  return Object.fromEntries(
    projectSummaries.flatMap((summary) => summary.rooms.map((roomSummary) => [roomSummary.room.id, roomSummary])),
  ) as Record<string, ReturnType<typeof buildProjectActivitySummaries>[number]["rooms"][number]>;
}

function buildWorkspaceSidebarData(snapshot: WorkspaceSnapshot): WorkspaceSidebarData {
  const projectSummaries = buildProjectActivitySummaries(snapshot);
  const projects = projectSummaries.map((summary) => summary.project);
  const roomsByProject = Object.fromEntries(
    projectSummaries.map((summary) => [summary.project.id, summary.rooms.map((roomSummary) => roomSummary.room)]),
  ) as Record<string, Room[]>;
  const projectActivityById = Object.fromEntries(
    projectSummaries.map((summary) => [summary.project.id, summary]),
  ) as Record<string, ReturnType<typeof buildProjectActivitySummaries>[number]>;
  const roomActivityById = buildRoomActivityIndex(projectSummaries);
  const roomWatcherPauseById = buildRoomWatcherPauseSummaryById(snapshot);
  const roomUnreadCountById = Object.fromEntries(
    Object.values(snapshot.rooms).map((candidateRoom) => [candidateRoom.id, candidateRoom.unreadMemberMessageCount ?? 0]),
  ) as Record<string, number>;
  const projectUnreadCountById = Object.fromEntries(
    projects.map((projectEntry) => [
      projectEntry.id,
      (roomsByProject[projectEntry.id] ?? []).reduce(
        (count, candidateRoom) => count + (roomUnreadCountById[candidateRoom.id] ?? 0),
        0,
      ),
    ]),
  ) as Record<string, number>;
  const roomRunningMembersById = Object.fromEntries(
    Object.values(snapshot.rooms).map((candidateRoom) => [candidateRoom.id, buildRunningMemberPreviewsForRoom(snapshot, candidateRoom)]),
  ) as Record<string, ReturnType<typeof buildRunningMemberPreviewsForRoom>>;
  const projectRunningMembersById = Object.fromEntries(
    projects.map((projectEntry) => [
      projectEntry.id,
      (roomsByProject[projectEntry.id] ?? []).flatMap((candidateRoom) => roomRunningMembersById[candidateRoom.id] ?? []),
    ]),
  ) as Record<string, ReturnType<typeof buildRunningMemberPreviewsForRoom>>;

  return {
    projects,
    roomsByProject,
    projectActivityById,
    roomActivityById,
    roomWatcherPauseById,
    projectUnreadCountById,
    roomUnreadCountById,
    projectRunningMembersById,
    roomRunningMembersById,
  };
}

export function WorkspaceScreen(props: { projectId?: string; roomId?: string; memberId?: string }) {
  const { projectId, roomId, memberId } = props;
  const navigate = useNavigate();
  const snapshot = useWorkspaceStore((state) => state.snapshot);
  const {
    globalConfig,
    loading,
    connected,
    error,
    deleteProject,
    deleteRoom,
    deleteTemplate,
    selectRoom,
    selectMember,
    runWatcher,
    toggleRoomWatcherSuspension,
    updateMemberConfig,
    updateRoomSettings,
    updateRoomTeam,
    updateTemplate,
    updateGlobalConfig,
    replaceRemoteState,
    setEntryMember,
    upsertWatcher,
    sendUserMessage,
  } = useWorkspaceStore(
    (state) => ({
      globalConfig: state.globalConfig,
      loading: state.loading,
      connected: state.connected,
      error: state.error,
      deleteProject: state.deleteProject,
      deleteRoom: state.deleteRoom,
      deleteTemplate: state.deleteTemplate,
      selectRoom: state.selectRoom,
      selectMember: state.selectMember,
      runWatcher: state.runWatcher,
      toggleRoomWatcherSuspension: state.toggleRoomWatcherSuspension,
      updateMemberConfig: state.updateMemberConfig,
      updateRoomSettings: state.updateRoomSettings,
      updateRoomTeam: state.updateRoomTeam,
      updateTemplate: state.updateTemplate,
      updateGlobalConfig: state.updateGlobalConfig,
      replaceRemoteState: state.replaceRemoteState,
      setEntryMember: state.setEntryMember,
      upsertWatcher: state.upsertWatcher,
      sendUserMessage: state.sendUserMessage,
    }),
    shallow,
  );
  const [templateStudioOpen, setTemplateStudioOpen] = useState(false);
  const [roomTeamOpen, setRoomTeamOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [deletingProjectId, setDeletingProjectId] = useState<string | undefined>(undefined);
  const [deletingRoomId, setDeletingRoomId] = useState<string | undefined>(undefined);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | undefined>(undefined);
  const [togglingRoomWatcherSuspensionRoomId, setTogglingRoomWatcherSuspensionRoomId] = useState<string | undefined>(undefined);
  const {
    layoutMode,
    leftCollapsed,
    leftWidth,
    rightCollapsed,
    rightWidth,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    setLeftWidth,
    setRightWidth,
  } = useShellPanels();
  const deferredSnapshot = useDeferredValue(snapshot);

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
  const roomTeam = useMemo(
    () => (room ? resolveRoomTeamSummary(snapshot, room) : undefined),
    [room, snapshot.members, snapshot.templates],
  );
  const members = useMemo(
    () => (room ? room.memberIds.map((candidateMemberId) => snapshot.members[candidateMemberId]).filter(Boolean) : []),
    [room, snapshot.members],
  );
  const routedMember = memberId ? members.find((candidate) => candidate.id === memberId) : undefined;
  const selectedMemberId = routedMember?.id ?? snapshot.selection.memberId;
  const sidebarData = useMemo(
    () => buildWorkspaceSidebarData(deferredSnapshot),
    [
      deferredSnapshot.members,
      deferredSnapshot.projectOrder,
      deferredSnapshot.projects,
      deferredSnapshot.roomOrderByProject,
      deferredSnapshot.rooms,
      deferredSnapshot.taskTraces,
      deferredSnapshot.tasks,
    ],
  );
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

  const openRoomMemberFromSidebar = (targetProjectId: string, targetRoomId: string, targetMemberId: string): void => {
    selectRoom(targetProjectId, targetRoomId);
    selectMember(targetMemberId);
    void navigate({
      to: "/projects/$projectId/rooms/$roomId/members/$memberId",
      params: {
        projectId: targetProjectId,
        roomId: targetRoomId,
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

  const openTemplateStudio = (templateId: string): void => {
    if (snapshot.templates[templateId]) {
      setSelectedTemplateId(templateId);
    }
    setTemplateStudioOpen(true);
  };

  const closeTemplateStudio = (): void => {
    setTemplateStudioOpen(false);
  };

  const openRoomTeam = (): void => {
    if (!room) {
      return;
    }

    setRoomTeamOpen(true);
  };

  const closeRoomTeam = (): void => {
    setRoomTeamOpen(false);
  };

  const syncRouteAfterStructureChange = (nextSnapshot: WorkspaceSnapshot): void => {
    if (currentRouteStillExists({ snapshot: nextSnapshot, projectId, roomId, memberId })) {
      return;
    }

    const nextRoute = resolveFallbackRoomRoute(nextSnapshot);
    startTransition(() => {
      if (nextRoute) {
        void navigate({
          to: "/projects/$projectId/rooms/$roomId",
          params: nextRoute,
        });
        return;
      }

      void navigate({
        to: "/",
      });
    });
  };

  const handleDeleteProject = async (targetProjectId: string): Promise<void> => {
    try {
      setDeletingProjectId(targetProjectId);
      const nextSnapshot = await deleteProject(targetProjectId);
      syncRouteAfterStructureChange(nextSnapshot);
    } finally {
      setDeletingProjectId(undefined);
    }
  };

  const handleDeleteRoom = async (targetRoomId: string): Promise<void> => {
    try {
      setDeletingRoomId(targetRoomId);
      const nextSnapshot = await deleteRoom(targetRoomId);
      syncRouteAfterStructureChange(nextSnapshot);
    } finally {
      setDeletingRoomId(undefined);
    }
  };

  const handleDeleteTemplate = async (templateIdToDelete: string): Promise<void> => {
    try {
      setDeletingTemplateId(templateIdToDelete);
      await deleteTemplate(templateIdToDelete);
    } finally {
      setDeletingTemplateId(undefined);
    }
  };

  const handleToggleRoomWatcherSuspension = async (targetRoomId: string): Promise<void> => {
    try {
      setTogglingRoomWatcherSuspensionRoomId(targetRoomId);
      await toggleRoomWatcherSuspension(targetRoomId);
    } finally {
      setTogglingRoomWatcherSuspensionRoomId(undefined);
    }
  };

  const handleSaveRoomTeam = async (input: Parameters<typeof updateRoomTeam>[0]): Promise<void> => {
    const nextSnapshot = await updateRoomTeam(input);
    syncRouteAfterStructureChange(nextSnapshot);
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

  const startRightSidebarResize = (event: PointerEvent<HTMLDivElement>): void => {
    const startX = event.clientX;
    const startWidth = rightWidth;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent): void => {
      const nextWidth = clampRightPanelWidth(startWidth - (moveEvent.clientX - startX));
      setRightWidth(nextWidth);
    };

    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const isOverlayLayout = layoutMode === "overlay";
  const sidebarPanel = (
    <Sidebar
      collapsed={isOverlayLayout ? leftCollapsed : false}
      overlay={isOverlayLayout}
      onToggleCollapsed={toggleLeftCollapsed}
      projects={sidebarData.projects}
      roomsByProject={sidebarData.roomsByProject}
      projectActivityById={sidebarData.projectActivityById}
      roomActivityById={sidebarData.roomActivityById}
      roomWatcherPauseById={sidebarData.roomWatcherPauseById}
      projectUnreadCountById={sidebarData.projectUnreadCountById}
      roomUnreadCountById={sidebarData.roomUnreadCountById}
      projectRunningMembersById={sidebarData.projectRunningMembersById}
      roomRunningMembersById={sidebarData.roomRunningMembersById}
      activeProjectId={selectedProjectId}
      activeRoomId={selectedRoomId}
      templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
      activeTemplateId={selectedTemplateId}
      connected={connected}
      error={error}
      loading={loading}
      deletingProjectId={deletingProjectId}
      deletingRoomId={deletingRoomId}
      deletingTemplateId={deletingTemplateId}
      togglingRoomWatcherSuspensionRoomId={togglingRoomWatcherSuspensionRoomId}
      onResizeStart={startSidebarResize}
      onDeleteProject={(targetProjectId) => void handleDeleteProject(targetProjectId)}
      onDeleteRoom={(targetRoomId) => void handleDeleteRoom(targetRoomId)}
      onToggleRoomWatcherSuspension={(targetRoomId) => void handleToggleRoomWatcherSuspension(targetRoomId)}
      onDeleteTemplate={(templateIdToDelete) => void handleDeleteTemplate(templateIdToDelete)}
      onOpenMember={openRoomMemberFromSidebar}
      onOpenTemplate={openTemplateStudio}
      onOpenTemplateStudio={() => {
        setSelectedTemplateId((current) => current ?? template?.id ?? snapshot.templateOrder[0]);
        setTemplateStudioOpen(true);
      }}
    />
  );
  const gridColumns = isOverlayLayout
    ? getRoomGridColumns(
        {
          leftCollapsed,
          leftWidth,
          rightCollapsed,
          rightWidth,
        },
        layoutMode,
      )
    : { leftPanel: "0rem", templateColumns: "minmax(0, 1fr)" };
  const gridStyle = {
    "--oa-left-panel": gridColumns.leftPanel,
    "--oa-room-grid-columns": gridColumns.templateColumns,
  } as CSSProperties;

  return (
    <>
      <div className="room-grid" style={gridStyle} data-layout-mode={layoutMode}>
        {isOverlayLayout && !leftCollapsed ? (
          <button
            aria-label="Close projects sidebar"
            className="absolute inset-y-0 right-0 z-10 bg-background/48 backdrop-blur-sm left-[min(21rem,82vw)]"
            type="button"
            onClick={toggleLeftCollapsed}
          />
        ) : null}
        {isOverlayLayout ? sidebarPanel : null}
        <ChatPane
          leftSidebarCollapsed={leftCollapsed}
          leftSidebarWidth={leftWidth}
          projectsPanelContent={!isOverlayLayout ? sidebarPanel : undefined}
          rightSidebarCollapsed={rightCollapsed}
          rightSidebarWidth={rightWidth}
          snapshot={snapshot}
          room={room}
          roomTeam={roomTeam}
          members={members}
          selectedMemberId={selectedMemberId}
          connected={connected}
          error={error}
          onOpenMember={openMemberStudio}
          onOpenRoomTeam={room ? openRoomTeam : undefined}
          onUpdateRoomSettings={(input) => void updateRoomSettings(input)}
          onToggleLeftSidebar={toggleLeftCollapsed}
          onToggleRightSidebar={toggleRightCollapsed}
          onRightSidebarResizeStart={startRightSidebarResize}
        />
      </div>
      <MemberStudioDialog
        snapshot={snapshot}
        globalConfig={globalConfig}
        room={room}
        member={routedMember}
        connected={connected}
        error={error}
        onClose={closeMemberStudio}
        onSaveConfig={(input) => void updateMemberConfig(input)}
        onSetEntryMember={(targetMemberId) => void setEntryMember(targetMemberId)}
        onSaveWatcher={(input) => void upsertWatcher(input)}
        onRunWatcher={(watcherId) => runWatcher(watcherId)}
        onSendDirectMessage={(content, directMemberId) => void sendUserMessage(content, directMemberId)}
      />
      <TemplateStudioDialog
        open={templateStudioOpen}
        templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
        selectedTemplateId={selectedTemplateId}
        globalConfig={globalConfig}
        onClose={closeTemplateStudio}
        deletingTemplateId={deletingTemplateId}
        onDeleteTemplate={(templateIdToDelete) => handleDeleteTemplate(templateIdToDelete)}
        onSaveConfig={(input) => void updateTemplate(input)}
        onSaveGlobalConfig={(input) => void updateGlobalConfig(input)}
        onApplyChatSync={(payload) =>
          replaceRemoteState({
            snapshot: payload.snapshot,
            globalConfig: payload.globalConfig,
          })}
      />
      <RoomTeamDialog
        open={roomTeamOpen}
        snapshot={snapshot}
        room={room}
        globalConfig={globalConfig}
        onClose={closeRoomTeam}
        onSave={handleSaveRoomTeam}
        onSaveDefaultTemplate={(input) => void updateTemplate(input)}
      />
    </>
  );
}
