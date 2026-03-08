import { Bot, Info, Sparkles } from "lucide-react";

import type { Room, TeamMember, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, summarizePrompt } from "@/lib/utils";
import { badgeToneProps, memberStatusBadgeProps } from "@/lib/ui-tone";
import { getWatcherForMember } from "@/components/members/member-utils";
import { getMessageHandlers, getMessageMentionHandles, getMessageRecipientHandles } from "@/lib/message-feed";

export function ChatPane(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  snapshot: WorkspaceSnapshot;
  room?: Room;
  template?: TeamTemplate;
  members: TeamMember[];
  selectedMemberId?: string;
  onOpenMember: (memberId: string) => void;
  onSend: (content: string, directMemberId?: string) => void | Promise<void>;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}) {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    snapshot,
    room,
    template,
    members,
    selectedMemberId,
    onOpenMember,
    onSend,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } = props;

  if (!room) {
    const readyBadge = badgeToneProps("paper");
    const membersBadge = badgeToneProps("blueprint");
    const watcherBadge = badgeToneProps("correction");

    return (
      <main className="flex min-h-screen min-w-0 flex-col gap-4 px-6 py-10">
        <ShellToolbar
          leftSidebarCollapsed={leftSidebarCollapsed}
          rightSidebarCollapsed={rightSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
          onToggleRightSidebar={onToggleRightSidebar}
        />
        <Card className="w-full max-w-2xl border border-border shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8">
            <div className="space-y-2">
              <p className="m-0 text-3xl font-semibold tracking-tight">OpenAquarium</p>
              <p className="m-0 text-base text-muted-foreground">
                左边先建一个 project。每个 project 会以首条问题命名 room，并固定一套 team template。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Badge variant={readyBadge.variant} className={readyBadge.className}>
                ACP-ready
              </Badge>
              <Badge variant={membersBadge.variant} className={membersBadge.className}>
                Interruptible members
              </Badge>
              <Badge variant={watcherBadge.variant} className={watcherBadge.className}>
                Watcher digests
              </Badge>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const messages = (snapshot.messageOrderByRoom[room.id] ?? []).map((messageId) => snapshot.messages[messageId]);
  const templateBadge = badgeToneProps(template?.accentTone ?? "paper");
  const watcherBadge = badgeToneProps("correction");
  const neutralBadge = badgeToneProps("paper");

  return (
    <main className="flex min-h-screen min-w-0 flex-col gap-5 border-x border-border/70 bg-background/70 px-4 py-5 md:px-6">
      <ShellToolbar
        leftSidebarCollapsed={leftSidebarCollapsed}
        rightSidebarCollapsed={rightSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        onToggleRightSidebar={onToggleRightSidebar}
      />
      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="m-0 text-3xl font-semibold tracking-tight">{room.name}</p>
              <p className="m-0 max-w-3xl text-sm text-muted-foreground">{room.topic}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={templateBadge.variant} className={templateBadge.className}>
                {template?.name ?? "Template"}
              </Badge>
              <Badge variant={neutralBadge.variant} className={neutralBadge.className}>
                {members.length} members
              </Badge>
              <Badge variant={watcherBadge.variant} className={watcherBadge.className}>
                {room.watcherIds.length} watchers
              </Badge>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {members.map((member) => {
              const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
              const statusBadge = memberStatusBadgeProps(member.status);

              return (
                <MemberHoverPreview
                  key={member.id}
                  member={member}
                  watcher={getWatcherForMember(room, snapshot, member.id)}
                >
                  <button
                    className={cn(
                      "flex min-h-[122px] items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/60",
                      member.id === selectedMemberId && "border-ring bg-accent/10 shadow-md",
                    )}
                    type="button"
                    onClick={() => onOpenMember(member.id)}
                  >
                    <MemberAvatar member={member} compact />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="m-0 text-base font-semibold tracking-tight">{member.name}</p>
                          {member.observeAllRoomMessages ? (
                            <span
                              className="inline-flex size-2 rounded-full bg-[color:var(--tone-blueprint-foreground)]"
                              aria-label="monitoring room"
                            />
                          ) : null}
                        </div>
                        <p className="m-0 text-sm text-muted-foreground">@{member.handle}</p>
                      </div>
                      <p className="m-0 line-clamp-2 text-sm text-muted-foreground">
                        {activeTask ? activeTask.title : member.summary}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
                        {member.status}
                      </Badge>
                      {member.isEntryMember ? <div className="text-xs font-medium text-muted-foreground">entry</div> : null}
                    </div>
                  </button>
                </MemberHoverPreview>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 text-2xl font-semibold tracking-tight">Room transcript</p>
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm text-muted-foreground">中途 draft 会保留在消息流里，不会被打断后抹掉。</p>
            <RoomInfoPopover room={room} template={template} members={members} />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {messages.map((message) => {
            const authorMember = members.find((member) => member.id === message.author.id);

            return (
              <MessageBubble
                key={message.id}
                message={message}
                authorMember={authorMember}
                mentionedHandles={getMessageMentionHandles(snapshot, message)}
                recipientHandles={getMessageRecipientHandles(snapshot, room, message)}
                handlerSummaries={getMessageHandlers(snapshot, message)}
                onAuthorClick={authorMember ? () => onOpenMember(authorMember.id) : undefined}
              />
            );
          })}
          {messages.length === 0 ? (
            <Card className="border border-border shadow-sm">
              <CardContent className="flex items-center gap-4 p-6">
                <Bot size={28} />
                <p className="m-0 text-sm text-muted-foreground">还没有消息。发第一句话，入口 member 会先接住。</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <ChatComposer members={members} onSend={onSend} />
    </main>
  );
}

function ShellToolbar(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}) {
  const { leftSidebarCollapsed, rightSidebarCollapsed, onToggleLeftSidebar, onToggleRightSidebar } = props;

  return (
    <div className="flex items-center justify-end gap-2">
      <PanelToggleButton collapsed={leftSidebarCollapsed} side="left" onToggle={onToggleLeftSidebar} />
      <div className="hidden xl:block">
        <PanelToggleButton collapsed={rightSidebarCollapsed} side="right" onToggle={onToggleRightSidebar} />
      </div>
    </div>
  );
}

function RoomInfoPopover(props: {
  room: Room;
  template?: TeamTemplate;
  members: TeamMember[];
}) {
  const { room, template, members } = props;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Info size={16} />
          Room note
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(88vw,360px)]">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-2 text-base">
            <Sparkles size={16} />
            Room note
          </PopoverTitle>
          <PopoverDescription>
            当前 template 固定为 {template?.name ?? "Template"}。
          </PopoverDescription>
        </PopoverHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="m-0">首条问题会把 room 主题初始化为：{summarizePrompt(room.topic, 80)}。</p>
          <p className="m-0">后台 runtime 会自动驱动 {members.length} 个成员 turn，并保留被打断前的 draft。</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
