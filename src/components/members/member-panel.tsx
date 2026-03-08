import { Bot, PencilLine } from "lucide-react";

import type { Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { getWatcherForMember } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { badgeToneProps } from "@/lib/ui-tone";

function QuickFact(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2">
      <p className="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="m-0 text-sm font-medium">{value}</p>
    </div>
  );
}

export function MemberPanel(props: {
  collapsed: boolean;
  snapshot: WorkspaceSnapshot;
  room?: Room;
  members: TeamMember[];
  selectedMember?: TeamMember;
  onSelectMember: (memberId: string) => void;
  onOpenStudio: (memberId: string) => void;
  onRunWatcher: (watcherId: string) => void;
  onToggleCollapsed: () => void;
}) {
  const { collapsed, snapshot, room, members, selectedMember, onSelectMember, onOpenStudio, onRunWatcher, onToggleCollapsed } = props;

  if (collapsed) {
    return <aside className="member-panel-shell min-h-0 min-w-0 overflow-hidden" data-collapsed="true" aria-hidden />;
  }

  if (!room) {
    return (
      <aside className="member-panel-shell min-h-screen min-w-0 border-l border-border/60 px-5 py-5">
        <Card className="border border-border shadow-sm">
          <CardContent className="p-6">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="m-0 text-2xl font-semibold tracking-tight">Pick A Room</p>
              <PanelToggleButton collapsed={false} side="right" onToggle={onToggleCollapsed} />
            </div>
            <p className="m-0 text-sm text-muted-foreground">
              选中左侧 room 之后，这里只保留成员概览。深配置会进独立的 member studio。
            </p>
          </CardContent>
        </Card>
      </aside>
    );
  }

  return (
    <aside className="member-panel-shell flex min-h-screen min-w-0 flex-col gap-5 border-l border-border/60 px-5 py-5">
      <div className="flex justify-end">
        <PanelToggleButton collapsed={false} side="right" onToggle={onToggleCollapsed} />
      </div>
      {selectedMember ? (
        <SelectedMemberSummary
          snapshot={snapshot}
          room={room}
          member={selectedMember}
          onOpenStudio={onOpenStudio}
          onRunWatcher={onRunWatcher}
        />
      ) : (
        <Card className="border border-border shadow-sm">
          <CardContent className="flex flex-col gap-3 p-5">
            <p className="m-0 text-2xl font-semibold tracking-tight">Member desk</p>
            <p className="m-0 text-sm text-muted-foreground">先点一个成员。主页面只看概览，更多配置点进 studio。</p>
          </CardContent>
        </Card>
      )}

      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 text-xl font-semibold tracking-tight">Team roster</p>
              <p className="m-0 text-sm text-muted-foreground">悬浮预览，点击聚焦，再决定要不要打开 studio。</p>
            </div>
            <Badge variant="secondary">{members.length} members</Badge>
          </div>
          <div className="flex flex-col gap-3">
            {members.map((member) => {
              const watcher = getWatcherForMember(room, snapshot, member.id);
              const isSelected = member.id === selectedMember?.id;

              return (
                <MemberHoverPreview key={member.id} member={member} watcher={watcher}>
                  <button
                    className={cn(
                      "flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left shadow-sm transition-colors hover:bg-muted/60",
                      isSelected && "border-ring bg-accent/5",
                    )}
                    type="button"
                    onClick={() => onSelectMember(member.id)}
                  >
                    <MemberAvatar member={member} compact />
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-sm font-medium">{member.name}</p>
                      <p className="m-0 text-xs text-muted-foreground">@{member.handle}</p>
                    </div>
                    {isSelected ? <Badge variant="outline">Focused</Badge> : null}
                  </button>
                </MemberHoverPreview>
              );
            })}
          </div>
        </CardContent>
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
  const toneBadge = badgeToneProps(member.accentTone);

  return (
    <>
      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5">
          <MemberAvatar member={member} active />
          <p className="m-0 text-sm leading-6 text-muted-foreground">{member.summary}</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={toneBadge.variant} className={toneBadge.className}>
              {member.provider.label}
            </Badge>
            {member.isEntryMember ? <Badge variant="outline">Entry member</Badge> : null}
            {member.observeAllRoomMessages ? <Badge variant="outline">Monitor all</Badge> : null}
            {watcher ? <Badge variant="outline">Watcher {watcher.intervalMinutes}m</Badge> : null}
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
        </CardContent>
      </Card>

      {activeTask ? (
        <Card className="border border-border shadow-sm">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="m-0 text-lg font-semibold tracking-tight">Live task</p>
            <p className="m-0 text-base">{activeTask.title}</p>
            <p className="m-0 text-sm text-muted-foreground">status: {activeTask.status}</p>
            <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">source message</p>
            <p className="m-0 text-sm">{snapshot.messages[activeTask.sourceMessageId]?.content}</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border border-border shadow-sm">
          <CardContent className="flex items-center gap-3 p-4">
            <Bot size={24} />
            <p className="m-0 text-sm text-muted-foreground">
              Prompt、skills、ACP provider、watcher 细节都已经收进 studio，不在右栏常驻展开。
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
