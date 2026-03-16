import { startTransition, useEffect, useState, type CSSProperties, type PointerEvent } from "react";

import { useNavigate } from "@tanstack/react-router";

import type { Room, WorkspaceSnapshot } from "@/domain/model";
import { ChatPane } from "@/components/chat/chat-pane";
import { clampLeftPanelWidth, clampRightPanelWidth, getRoomGridColumns } from "@/lib/shell-panels";
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

export function WorkspaceScreen(props: { projectId?: string; roomId?: string; memberId?: string }) {
  const { projectId, roomId, memberId } = props;
  const navigate = useNavigate();
  const snapshot = useWorkspaceStore((state) => state.snapshot);
  const globalConfig = useWorkspaceStore((state) => state.globalConfig);
  const loading = useWorkspaceStore((state) => state.loading);
  const connected = useWorkspaceStore((state) => state.connected);
  const error = useWorkspaceStore((state) => state.error);
  const deleteProject = useWorkspaceStore((state) => state.deleteProject);
  const deleteRoom = useWorkspaceStore((state) => state.deleteRoom);
  const deleteTemplate = useWorkspaceStore((state) => state.deleteTemplate);
  const selectRoom = useWorkspaceStore((state) => state.selectRoom);
  const selectMember = useWorkspaceStore((state) => state.selectMember);
  const runWatcher = useWorkspaceStore((state) => state.runWatcher);
  const updateMemberConfig = useWorkspaceStore((state) => state.updateMemberConfig);
  const updateRoomSettings = useWorkspaceStore((state) => state.updateRoomSettings);
  const updateRoomTeam = useWorkspaceStore((state) => state.updateRoomTeam);
  const updateTemplate = useWorkspaceStore((state) => state.updateTemplate);
  const updateGlobalConfig = useWorkspaceStore((state) => state.updateGlobalConfig);
  const replaceRemoteState = useWorkspaceStore((state) => state.replaceRemoteState);
  const setEntryMember = useWorkspaceStore((state) => state.setEntryMember);
  const upsertWatcher = useWorkspaceStore((state) => state.upsertWatcher);
  const sendUserMessage = useWorkspaceStore((state) => state.sendUserMessage);
  const [templateStudioOpen, setTemplateStudioOpen] = useState(false);
  const [roomTeamOpen, setRoomTeamOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [deletingProjectId, setDeletingProjectId] = useState<string | undefined>(undefined);
  const [deletingRoomId, setDeletingRoomId] = useState<string | undefined>(undefined);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | undefined>(undefined);
  const {
    leftCollapsed,
    leftWidth,
    rightCollapsed,
    rightWidth,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    setLeftWidth,
    setRightWidth,
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
  const roomTeam = room ? resolveRoomTeamSummary(snapshot, room) : undefined;
  const members = room ? room.memberIds.map((memberId) => snapshot.members[memberId]) : [];
  const routedMember = memberId ? members.find((candidate) => candidate.id === memberId) : undefined;
  const selectedMemberId = routedMember?.id ?? snapshot.selection.memberId;
  const projectSummaries = buildProjectActivitySummaries(snapshot);
  const projects = projectSummaries.map((summary) => summary.project);
  const roomsByProject = Object.fromEntries(projectSummaries.map((summary) => [summary.project.id, summary.rooms.map((room) => room.room)])) as Record<
    string,
    Room[]
  >;
  const projectActivityById = Object.fromEntries(projectSummaries.map((summary) => [summary.project.id, summary]));
  const roomActivityById = Object.fromEntries(
    projectSummaries.flatMap((summary) => summary.rooms.map((roomSummary) => [roomSummary.room.id, roomSummary])),
  );
  const roomUnreadCountById = Object.fromEntries(
    Object.values(snapshot.rooms).map((candidateRoom) => [candidateRoom.id, candidateRoom.unreadMemberMessageCount ?? 0]),
  ) as Record<string, number>;
  const projectUnreadCountById = Object.fromEntries(
    projects.map((projectEntry) => [
      projectEntry.id,
      (roomsByProject[projectEntry.id] ?? []).reduce((count, candidateRoom) => count + (roomUnreadCountById[candidateRoom.id] ?? 0), 0),
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

  const gridColumns = getRoomGridColumns({
    leftCollapsed,
    leftWidth,
    rightCollapsed,
    rightWidth,
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
          projectActivityById={projectActivityById}
          roomActivityById={roomActivityById}
          projectUnreadCountById={projectUnreadCountById}
          roomUnreadCountById={roomUnreadCountById}
          projectRunningMembersById={projectRunningMembersById}
          roomRunningMembersById={roomRunningMembersById}
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
          onResizeStart={startSidebarResize}
          onDeleteProject={(targetProjectId) => void handleDeleteProject(targetProjectId)}
          onDeleteRoom={(targetRoomId) => void handleDeleteRoom(targetRoomId)}
          onDeleteTemplate={(templateIdToDelete) => void handleDeleteTemplate(templateIdToDelete)}
          onOpenMember={openRoomMemberFromSidebar}
          onOpenTemplate={openTemplateStudio}
          onOpenTemplateStudio={() => {
            setSelectedTemplateId((current) => current ?? template?.id ?? snapshot.templateOrder[0]);
            setTemplateStudioOpen(true);
          }}
        />
        <ChatPane
          leftSidebarCollapsed={leftCollapsed}
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
      />
    </>
  );
}
