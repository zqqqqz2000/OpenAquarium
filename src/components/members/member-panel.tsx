import { Bot, PencilLine } from "lucide-react";

import type { Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { getWatcherForMember } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { tilt, wobbly } from "@/lib/utils";

function QuickFact(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div
      className="rough-dashed-frame bg-white px-3 py-2"
      style={wobbly.note}
    >
      <p className="m-0 text-sm uppercase tracking-[0.18em] opacity-55">{label}</p>
      <p className="m-0 text-lg">{value}</p>
    </div>
  );
}

export function MemberPanel(props: {
  snapshot: WorkspaceSnapshot;
  room?: Room;
  members: TeamMember[];
  selectedMember?: TeamMember;
  onSelectMember: (memberId: string) => void;
  onOpenStudio: (memberId: string) => void;
  onRunWatcher: (watcherId: string) => void;
}) {
  const { snapshot, room, members, selectedMember, onSelectMember, onOpenStudio, onRunWatcher } = props;

  if (!room) {
    return (
      <aside className="member-panel-shell min-h-screen px-5 py-5">
        <Card className="p-6" tone="paper">
          <p className="m-0 text-2xl font-semibold tracking-tight">Pick A Room</p>
          <p className="m-0 text-sm text-[var(--muted-foreground)]">选中左侧 room 之后，这里只保留成员概览。深配置会进独立的 member studio。</p>
        </Card>
      </aside>
    );
  }

  return (
    <aside className="member-panel-shell flex min-h-screen flex-col gap-5 px-5 py-5">
      {selectedMember ? (
        <SelectedMemberSummary
          snapshot={snapshot}
          room={room}
          member={selectedMember}
          onOpenStudio={onOpenStudio}
          onRunWatcher={onRunWatcher}
        />
      ) : (
        <Card className="flex flex-col gap-3 p-5" tone="paper">
          <p className="m-0 text-2xl font-semibold tracking-tight">Member desk</p>
          <p className="m-0 text-sm text-[var(--muted-foreground)]">先点一个成员。主页面只看概览，更多配置点进 studio。</p>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-4" tone="paper">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="m-0 text-2xl">Team roster</p>
            <p className="m-0 text-lg opacity-70">悬浮预览，点击聚焦，再决定要不要打开 studio。</p>
          </div>
          <Badge tone="paper">{members.length} members</Badge>
        </div>
        <div className="flex flex-col gap-3">
          {members.map((member, index) => {
            const watcher = getWatcherForMember(room, snapshot, member.id);
            const isSelected = member.id === selectedMember?.id;

            return (
              <MemberHoverPreview key={member.id} member={member} watcher={watcher}>
                <button
                  className="paper-card surface-interactive flex items-center gap-3 px-3 py-3 text-left"
                  style={{
                    ...wobbly.listItem,
                    ...(isSelected ? tilt.active : index % 2 === 0 ? tilt.positive : tilt.negative),
                    background: isSelected ? "var(--secondary)" : "var(--white)",
                  }}
                  type="button"
                  onClick={() => onSelectMember(member.id)}
                >
                  <MemberAvatar member={member} compact />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-xl">{member.name}</p>
                    <p className="m-0 text-base opacity-65">@{member.handle}</p>
                  </div>
                  {isSelected ? <Badge tone="blueprint">Focused</Badge> : null}
                </button>
              </MemberHoverPreview>
            );
          })}
        </div>
      </Card>
    </aside>
  );
}

function SelectedMemberSummary(props: {
  snapshot: WorkspaceSnapshot;
  room: Room;
  member: TeamMember;
  onOpenStudio: (memberId: string) => void;
  onRunWatcher: (watcherId: string) => void;
}) {
  const { snapshot, room, member, onOpenStudio, onRunWatcher } = props;
  const watcher = getWatcherForMember(room, snapshot, member.id);
  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;

  return (
    <>
      <Card className="flex flex-col gap-4 p-5" tone={member.accentTone}>
        <MemberAvatar member={member} active />
        <p className="m-0 text-sm leading-6 text-[var(--muted-foreground)]">{member.summary}</p>
        <div className="flex flex-wrap gap-2">
          <Badge tone="paper">{member.provider.label}</Badge>
          {member.isEntryMember ? <Badge tone="postit">Entry member</Badge> : null}
          {member.observeAllRoomMessages ? <Badge tone="blueprint">Monitor all</Badge> : null}
          {watcher ? <Badge tone="correction">Watcher {watcher.intervalMinutes}m</Badge> : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <QuickFact label="Skills" value={`${member.skills.length}`} />
          <QuickFact label="Direct inbox" value={member.acceptsDirectMessages ? "Open" : "Closed"} />
          <QuickFact label="Status" value={member.status} />
          <QuickFact label="Watcher" value={watcher ? `${watcher.intervalMinutes} min` : "Off"} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {watcher ? (
            <Button size="sm" variant="secondary" onClick={() => onRunWatcher(watcher.id)}>
              <PencilLine size={16} />
              Run watcher
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onOpenStudio(member.id)}>
            Open studio
          </Button>
        </div>
      </Card>

      {activeTask ? (
        <Card className="flex flex-col gap-2 p-4" tone="paper">
          <p className="m-0 text-lg font-semibold tracking-tight">Live task</p>
          <p className="m-0 text-base">{activeTask.title}</p>
          <p className="m-0 text-sm text-[var(--muted-foreground)]">status: {activeTask.status}</p>
          <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-[var(--muted-foreground)]">source message</p>
          <p className="m-0 text-sm">{snapshot.messages[activeTask.sourceMessageId]?.content}</p>
        </Card>
      ) : (
        <Card className="flex items-center gap-3 p-4" tone="paper">
          <Bot size={24} />
          <p className="m-0 text-sm text-[var(--muted-foreground)]">Prompt、skills、ACP provider、watcher 细节都已经收进 studio，不在右栏常驻展开。</p>
        </Card>
      )}
    </>
  );
}
