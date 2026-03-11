import { startTransition, useEffect, useState, type CSSProperties, type PointerEvent } from "react";

import { useNavigate } from "@tanstack/react-router";

import type { Room, WorkspaceSnapshot } from "@/domain/model";
import { ChatPane } from "@/components/chat/chat-pane";
import { clampLeftPanelWidth, getRoomGridColumns } from "@/lib/shell-panels";
import { Sidebar } from "@/components/layout/sidebar";
import { useShellPanels } from "@/components/layout/use-shell-panels";
import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import { TemplateStudioDialog } from "@/components/templates/template-studio-dialog";
import { useWorkspaceStore } from "@/store/workspace-store-context";

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
  return Boolean(member && member.roomId === roomId);
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
  const toggleMemberMonitoring = useWorkspaceStore((state) => state.toggleMemberMonitoring);
  const runWatcher = useWorkspaceStore((state) => state.runWatcher);
  const updateMemberConfig = useWorkspaceStore((state) => state.updateMemberConfig);
  const updateTemplate = useWorkspaceStore((state) => state.updateTemplate);
  const updateGlobalConfig = useWorkspaceStore((state) => state.updateGlobalConfig);
  const replaceRemoteState = useWorkspaceStore((state) => state.replaceRemoteState);
  const setEntryMember = useWorkspaceStore((state) => state.setEntryMember);
  const upsertWatcher = useWorkspaceStore((state) => state.upsertWatcher);
  const sendUserMessage = useWorkspaceStore((state) => state.sendUserMessage);
  const [templateStudioOpen, setTemplateStudioOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(undefined);
  const [deletingProjectId, setDeletingProjectId] = useState<string | undefined>(undefined);
  const [deletingRoomId, setDeletingRoomId] = useState<string | undefined>(undefined);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | undefined>(undefined);
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

  const openTemplateStudio = (templateId: string): void => {
    if (snapshot.templates[templateId]) {
      setSelectedTemplateId(templateId);
    }
    setTemplateStudioOpen(true);
  };

  const closeTemplateStudio = (): void => {
    setTemplateStudioOpen(false);
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
          onOpenTemplate={openTemplateStudio}
          onOpenTemplateStudio={() => {
            setSelectedTemplateId((current) => current ?? template?.id ?? snapshot.templateOrder[0]);
            setTemplateStudioOpen(true);
          }}
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
          onOpenTemplate={template ? () => openTemplateStudio(template.id) : undefined}
          onToggleLeftSidebar={toggleLeftCollapsed}
          onToggleRightSidebar={toggleRightCollapsed}
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
        onToggleMonitor={(targetMemberId) => void toggleMemberMonitoring(targetMemberId)}
        onSaveConfig={(input) => void updateMemberConfig(input)}
        onSetEntryMember={(targetMemberId) => void setEntryMember(targetMemberId)}
        onSaveWatcher={(input) => void upsertWatcher(input)}
        onRunWatcher={(watcherId) => void runWatcher(watcherId)}
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
    </>
  );
}
