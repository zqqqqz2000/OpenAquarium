import { useEffect } from "react";

import { useNavigate } from "@tanstack/react-router";

import type { Room } from "@/domain/model";
import { ChatPane } from "@/components/chat/chat-pane";
import { Sidebar } from "@/components/layout/sidebar";
import { MemberPanel } from "@/components/members/member-panel";
import { MemberStudioDialog } from "@/components/members/member-studio-dialog";
import { useWorkspaceStore } from "@/store/workspace-store-context";

export function WorkspaceScreen(props: { projectId?: string; roomId?: string; memberId?: string }) {
  const { projectId, roomId, memberId } = props;
  const navigate = useNavigate();
  const snapshot = useWorkspaceStore((state) => state.snapshot);
  const loading = useWorkspaceStore((state) => state.loading);
  const connected = useWorkspaceStore((state) => state.connected);
  const selectRoom = useWorkspaceStore((state) => state.selectRoom);
  const selectMember = useWorkspaceStore((state) => state.selectMember);
  const sendUserMessage = useWorkspaceStore((state) => state.sendUserMessage);
  const toggleMemberMonitoring = useWorkspaceStore((state) => state.toggleMemberMonitoring);
  const runWatcher = useWorkspaceStore((state) => state.runWatcher);
  const updateMemberConfig = useWorkspaceStore((state) => state.updateMemberConfig);
  const setEntryMember = useWorkspaceStore((state) => state.setEntryMember);
  const upsertWatcher = useWorkspaceStore((state) => state.upsertWatcher);

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
  const selectedMember = routedMember ?? (snapshot.selection.memberId ? snapshot.members[snapshot.selection.memberId] : undefined);
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

  return (
    <>
      <div className="room-grid">
        <Sidebar
          projects={projects}
          roomsByProject={roomsByProject}
          activeProjectId={selectedProjectId}
          activeRoomId={selectedRoomId}
          templates={snapshot.templateOrder.map((templateId) => snapshot.templates[templateId])}
          connected={connected}
          loading={loading}
        />
        <ChatPane
          snapshot={snapshot}
          room={room}
          template={template}
          members={members}
          selectedMemberId={selectedMember?.id}
          onOpenMember={openMemberStudio}
          onSend={(content, directMemberId) => sendUserMessage(content, directMemberId)}
        />
        <MemberPanel
          snapshot={snapshot}
          room={room}
          members={members}
          selectedMember={selectedMember}
          onSelectMember={selectMember}
          onOpenStudio={openMemberStudio}
          onRunWatcher={(watcherId) => void runWatcher(watcherId)}
        />
      </div>
      <MemberStudioDialog
        snapshot={snapshot}
        room={room}
        member={routedMember}
        onClose={closeMemberStudio}
        onToggleMonitor={(targetMemberId) => void toggleMemberMonitoring(targetMemberId)}
        onSaveConfig={(input) => void updateMemberConfig(input)}
        onSetEntryMember={(targetMemberId) => void setEntryMember(targetMemberId)}
        onSaveWatcher={(input) => void upsertWatcher(input)}
        onRunWatcher={(watcherId) => void runWatcher(watcherId)}
      />
    </>
  );
}
