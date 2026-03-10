import { useEffect, useRef } from "react";

import { Bot, Info, Sparkles, Users } from "lucide-react";

import type { ChatMessage, Room, TeamMember, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { getWatcherForMember } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRoomChat } from "@/lib/chat/use-room-chat";
import { getUIMessageText, type WorkspaceUIMessage } from "@/lib/chat/workspace-ui-message";
import type { MessageHandlerSummary } from "@/lib/message-feed";
import { badgeToneProps, memberStatusBadgeProps } from "@/lib/ui-tone";
import { cn, summarizePrompt } from "@/lib/utils";

export function ChatPane(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  snapshot: WorkspaceSnapshot;
  room?: Room;
  template?: TeamTemplate;
  members: TeamMember[];
  selectedMemberId?: string;
  connected: boolean;
  error?: string;
  onOpenMember: (memberId: string) => void;
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
    connected,
    error,
    onOpenMember,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousLayoutKeyRef = useRef<string | undefined>(undefined);
  const roomChat = useRoomChat({
    room,
    members,
    snapshot,
  });
  const roomId = room?.id;
  const latestMessageId = roomChat.messages.at(-1)?.id;
  const layoutKey = `${roomId ?? "no-room"}:${leftSidebarCollapsed ? "left-closed" : "left-open"}:${rightSidebarCollapsed ? "right-closed" : "right-open"}`;

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    const layoutChanged = previousLayoutKeyRef.current !== layoutKey;
    previousLayoutKeyRef.current = layoutKey;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: layoutChanged ? "auto" : "smooth",
    });
  }, [layoutKey, latestMessageId, roomId]);

  if (!room) {
    const readyBadge = badgeToneProps("paper");
    const membersBadge = badgeToneProps("blueprint");
    const watcherBadge = badgeToneProps("correction");

    return (
      <main className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden px-6 py-10">
        <ShellToolbar leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} />
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

  const templateBadge = badgeToneProps(template?.accentTone ?? "paper");
  const watcherBadge = badgeToneProps("correction");
  const neutralBadge = badgeToneProps("paper");

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col gap-5 overflow-hidden border-x border-border/70 bg-background/70 px-4 py-5 md:px-6">
      <ShellToolbar
        leftSidebarCollapsed={leftSidebarCollapsed}
        onToggleLeftSidebar={onToggleLeftSidebar}
        rightSidebarCollapsed={rightSidebarCollapsed}
        onToggleRightSidebar={onToggleRightSidebar}
      />
      {!connected || error ? (
        <Card className="border border-destructive/30 bg-destructive/5 shadow-sm">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="m-0 text-sm font-medium">Runtime offline</p>
            <p className="m-0 text-sm text-muted-foreground">
              当前聊天依赖本地 runtime 服务；如果它没启动，发消息、建 room、改成员配置都不会生效。
            </p>
            <p className="m-0 text-xs text-muted-foreground">现在页面里展示的是本地空工作区，不是已经连上 runtime 的真实状态。</p>
            <p className="m-0 font-mono text-xs text-muted-foreground">bun run server</p>
            {error ? <p className="m-0 text-xs text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <div
        className={cn(
          "relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden",
          !rightSidebarCollapsed && "xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:gap-5",
        )}
      >
        <section className="flex h-full min-h-0 min-w-0 flex-col gap-4">
          <Card className="shrink-0 border border-border shadow-sm">
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
            </CardContent>
          </Card>

          <Card className="min-h-0 flex-1 overflow-hidden border border-border shadow-sm">
            <CardContent className="flex h-full min-h-0 flex-col p-0">
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b border-border px-5 py-4">
                <div className="space-y-1">
                  <p className="m-0 text-2xl font-semibold tracking-tight">Room transcript</p>
                  <p className="m-0 text-sm text-muted-foreground">{describeStreamingState(roomChat.activeStreamSummary)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{roomChat.messages.length} messages</Badge>
                  <RoomInfoPopover room={room} template={template} members={members} />
                </div>
              </div>
              <div ref={transcriptRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {roomChat.messages.map((message) => {
                  const bubble = toBubbleModel(message, room.id, snapshot.currentUserName);
                  const authorMember = bubble.authorMemberId ? roomChat.activeMembersById[bubble.authorMemberId] : undefined;

                  return (
                    <MessageBubble
                      key={bubble.message.id}
                      message={bubble.message}
                      authorMember={authorMember}
                      mentionedHandles={bubble.mentionedHandles}
                      recipientHandles={bubble.recipientHandles}
                      handlerSummaries={bubble.handlerSummaries}
                      onAuthorClick={authorMember ? () => onOpenMember(authorMember.id) : undefined}
                    />
                  );
                })}
                {roomChat.messages.length === 0 ? (
                  <Card className="border border-border shadow-sm">
                    <CardContent className="flex items-center gap-4 p-6">
                      <Bot size={28} />
                      <p className="m-0 text-sm text-muted-foreground">还没有消息。发第一句话，入口 member 会先接住。</p>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <ChatComposer
            className="shrink-0"
            connected={connected}
            error={error}
            members={members}
            onSend={roomChat.sendMessage}
            sending={roomChat.hasActiveStreams}
          />
        </section>

        {!rightSidebarCollapsed ? (
          <RoomMembersSidebar
            room={room}
            snapshot={snapshot}
            members={members}
            selectedMemberId={selectedMemberId}
            onOpenMember={onOpenMember}
          />
        ) : null}
      </div>
    </main>
  );
}

function ShellToolbar(props: {
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
  rightSidebarCollapsed?: boolean;
  onToggleRightSidebar?: () => void;
}) {
  const { leftSidebarCollapsed, onToggleLeftSidebar, rightSidebarCollapsed, onToggleRightSidebar } = props;

  return (
    <div className="flex items-center justify-between gap-3">
      <PanelToggleButton collapsed={leftSidebarCollapsed} side="left" onToggle={onToggleLeftSidebar} />
      {typeof rightSidebarCollapsed === "boolean" && onToggleRightSidebar ? (
        <PanelToggleButton collapsed={rightSidebarCollapsed} side="right" onToggle={onToggleRightSidebar} />
      ) : null}
    </div>
  );
}

function RoomMembersSidebar(props: {
  room: Room;
  snapshot: WorkspaceSnapshot;
  members: TeamMember[];
  selectedMemberId?: string;
  onOpenMember: (memberId: string) => void;
}) {
  const { room, snapshot, members, selectedMemberId, onOpenMember } = props;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-[min(25rem,92vw)] min-h-0 border-l border-border/70 bg-background/96 backdrop-blur xl:static xl:w-auto xl:border-l-0 xl:bg-transparent xl:backdrop-blur-none">
      <Card className="flex h-full min-h-0 flex-col border border-border shadow-sm">
        <CardContent className="flex h-full min-h-0 flex-col gap-0 p-0">
          <div className="shrink-0 border-b border-border px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <p className="m-0 flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Users size={18} />
                  Members
                </p>
                <p className="m-0 text-sm text-muted-foreground">
                  团队通常不大，右侧保留更多状态，便于快速切换到具体 member session。
                </p>
              </div>
              <Badge variant="outline">{members.length}</Badge>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-3">
              {members.map((member) => {
                const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
                const statusBadge = memberStatusBadgeProps(member.status);
                const watcher = getWatcherForMember(room, snapshot, member.id);

                return (
                  <MemberHoverPreview key={member.id} member={member} watcher={watcher}>
                    <button
                      className={cn(
                        "flex w-full min-h-[138px] items-start gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/60",
                        member.id === selectedMemberId && "border-ring bg-accent/10 shadow-md",
                      )}
                      type="button"
                      onClick={() => onOpenMember(member.id)}
                    >
                      <MemberAvatar member={member} compact active={member.id === selectedMemberId} />
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="m-0 text-base font-semibold tracking-tight">{member.name}</p>
                            {member.observeAllRoomMessages ? (
                              <span
                                className="inline-flex size-2 rounded-full bg-[color:var(--tone-blueprint-foreground)]"
                                aria-label="monitoring room"
                              />
                            ) : null}
                            {member.isEntryMember ? <Badge variant="outline">Entry</Badge> : null}
                            {watcher ? <Badge variant="outline">Watcher {watcher.intervalMinutes}m</Badge> : null}
                          </div>
                          <p className="m-0 text-sm text-muted-foreground">@{member.handle}</p>
                        </div>
                        <p className="m-0 text-sm leading-6 text-muted-foreground">
                          {activeTask ? activeTask.title : summarizePrompt(member.summary, 120)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                        <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
                          {member.status}
                        </Badge>
                        <p className="m-0 text-xs text-muted-foreground">
                          {activeTask ? "处理中" : member.acceptsDirectMessages ? "Direct open" : "Direct closed"}
                        </p>
                      </div>
                    </button>
                  </MemberHoverPreview>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>
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
          <p className="m-0">后台 runtime 会自动驱动 {members.length} 个成员 turn；更完整的执行细节和私聊上下文放在成员 Session，群聊只显示真实发出的消息。</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function describeStreamingState(activeStreamSummary?: string): string {
  if (activeStreamSummary) {
    return activeStreamSummary;
  }

  return "成员内部推理只显示为处理状态；只有显式发送到 room 或 direct 的消息才会出现在消息流里。";
}

function inferMessageStatus(message: WorkspaceUIMessage): ChatMessage["status"] {
  const textPart = message.parts.find((part) => part.type === "text");
  if (textPart?.state === "streaming") {
    return "streaming";
  }

  return message.role === "assistant" ? "completed" : "sent";
}

function toBubbleModel(
  message: WorkspaceUIMessage,
  roomId: string,
  currentUserName: string,
  activeRoute?: {
    memberId: string;
    memberName: string;
    memberHandle: string;
  },
): {
  message: ChatMessage;
  authorMemberId?: string;
  mentionedHandles: string[];
  recipientHandles: string[];
  handlerSummaries: MessageHandlerSummary[];
} {
  const text = getUIMessageText(message);
  const status = message.metadata?.status ?? inferMessageStatus(message);
  const authorKind = message.metadata?.authorKind ?? (message.role === "user" ? "user" : "member");
  const authorId = message.metadata?.authorId ?? (message.role === "user" ? "user" : activeRoute?.memberId ?? "assistant");
  const authorLabel = message.metadata?.authorLabel ?? (message.role === "user" ? currentUserName : activeRoute?.memberName ?? "Assistant");

  return {
    message: {
      id: message.id,
      roomId,
      author: {
        kind: authorKind,
        id: authorId,
        label: authorLabel,
      },
      content: text,
      createdAt: message.metadata?.createdAt ?? new Date().toISOString(),
      transport: message.metadata?.transport ?? "group",
      status,
      mentionedMemberIds: [],
      recipientMemberIds: [],
      taskId: message.metadata?.handlerSummaries?.[0]?.taskId,
    },
    authorMemberId: message.metadata?.memberId ?? (message.role === "assistant" ? activeRoute?.memberId : undefined),
    mentionedHandles: message.metadata?.mentionedHandles ?? [],
    recipientHandles: message.metadata?.recipientHandles ?? [],
    handlerSummaries: message.metadata?.handlerSummaries ?? [],
  };
}
