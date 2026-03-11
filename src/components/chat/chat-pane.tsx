import { useEffect, useRef, useState } from "react";

import { ArrowDown, Bot, CornerDownLeft, Users } from "lucide-react";

import type { ChatMessage, Room, TeamMember, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { getMemberActivitySummary, getWatcherForMember } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMemberRoleLabel, getMemberRolePalette } from "@/lib/member-display";
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
  onOpenTemplate?: () => void;
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
    onOpenTemplate,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousLayoutKeyRef = useRef<string | undefined>(undefined);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [composerDirectMemberId, setComposerDirectMemberId] = useState<string | undefined>(undefined);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const roomChat = useRoomChat({
    room,
    members,
    snapshot,
  });
  const roomId = room?.id;
  const latestMessageId = roomChat.messages.at(-1)?.id;
  const layoutKey = `${roomId ?? "no-room"}:${leftSidebarCollapsed ? "left-closed" : "left-open"}:${rightSidebarCollapsed ? "right-closed" : "right-open"}`;
  const composerTargetMemberId =
    composerDirectMemberId && members.some((member) => member.id === composerDirectMemberId) ? composerDirectMemberId : undefined;
  const updateScrollState = (): void => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    const bottomGap = container.scrollHeight - container.clientHeight - container.scrollTop;
    setShowScrollToLatest(bottomGap > 32);
  };
  const scrollTranscriptToLatest = (behavior: ScrollBehavior = "smooth"): void => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
    setShowScrollToLatest(false);
  };

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
    if (layoutChanged || !showScrollToLatest) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: layoutChanged ? "auto" : "smooth",
      });
    }
    window.requestAnimationFrame(updateScrollState);
  }, [layoutKey, latestMessageId, roomId, showScrollToLatest]);

  const handleDirectMessageMember = (memberId: string): void => {
    setComposerDirectMemberId(memberId);
    setComposerFocusSignal((current) => current + 1);

    if (!rightSidebarCollapsed && window.matchMedia("(max-width: 1279px)").matches) {
      onToggleRightSidebar();
    }
  };

  if (!room) {
    return (
      <main className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden px-6 py-10">
        <ShellToolbar leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} />
        <Card className="w-full max-w-2xl border border-border shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8">
            <div className="space-y-2">
              <p className="m-0 text-3xl font-semibold tracking-tight">OpenAquarium</p>
              <p className="m-0 text-base text-muted-foreground">创建一个 project 开始聊天。</p>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-background/70 px-3 py-3 md:px-4">
      {!connected || error ? (
        <Card className="border border-destructive/30 bg-destructive/5 shadow-sm">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="m-0 text-sm font-medium">Runtime offline</p>
            <p className="m-0 text-sm text-muted-foreground">启动本地 runtime 后，发消息和保存改动才会生效。</p>
            <p className="m-0 font-mono text-xs text-muted-foreground">bun run server</p>
            {error ? <p className="m-0 text-xs text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <div
        className={cn(
          "relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden",
          !rightSidebarCollapsed && "xl:grid-cols-[minmax(0,1fr)_minmax(21rem,25rem)] xl:gap-3",
        )}
      >
        {!rightSidebarCollapsed ? (
          <button
            aria-label="Close members sidebar"
            className="absolute inset-y-0 left-0 z-10 bg-background/48 backdrop-blur-sm xl:hidden right-[min(23rem,84vw)]"
            type="button"
            onClick={onToggleRightSidebar}
          />
        ) : null}
        <section className="flex h-full min-h-0 min-w-0 flex-col gap-3">
          <RoomTopBar
            leftSidebarCollapsed={leftSidebarCollapsed}
            rightSidebarCollapsed={rightSidebarCollapsed}
            room={room}
            template={template}
            members={members}
            activeStreamSummary={roomChat.activeStreamSummary}
            onOpenTemplate={onOpenTemplate}
            onToggleLeftSidebar={onToggleLeftSidebar}
            onToggleRightSidebar={onToggleRightSidebar}
          />
          <div className="relative min-h-0 flex-1">
            <div ref={transcriptRef} className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-1 md:px-2" onScroll={updateScrollState}>
              {roomChat.messages.map((message) => {
                const bubble = toBubbleModel(message, room.id, snapshot.currentUserName);
                const authorMember = bubble.authorMemberId ? roomChat.activeMembersById[bubble.authorMemberId] : undefined;

                return (
                  <MessageBubble
                    key={bubble.message.id}
                    message={bubble.message}
                    authorMember={authorMember}
                    mentionedHandles={bubble.mentionedHandles}
                    quotedHandles={bubble.quotedHandles}
                    recipientHandles={bubble.recipientHandles}
                    handlerSummaries={bubble.handlerSummaries}
                    onAuthorClick={authorMember ? () => onOpenMember(authorMember.id) : undefined}
                  />
                );
              })}
              {roomChat.messages.length === 0 ? (
                <Card className="border border-border shadow-none">
                  <CardContent className="flex items-center gap-4 p-5">
                    <Bot size={28} />
                    <p className="m-0 text-sm text-muted-foreground">还没有消息。发送第一句话开始。</p>
                  </CardContent>
                </Card>
              ) : null}
            </div>
            {showScrollToLatest ? (
              <Button
                className="absolute right-2 bottom-2 shadow-lg"
                size="sm"
                type="button"
                onClick={() => scrollTranscriptToLatest()}
              >
                <ArrowDown size={16} />
                Jump to latest
              </Button>
            ) : null}
          </div>

          <ChatComposer
            className="shrink-0 py-0"
            contentClassName="gap-2 p-0"
            textareaClassName="min-h-16"
            connected={connected}
            error={error}
            members={members}
            onSend={roomChat.sendMessage}
            sending={roomChat.hasActiveStreams}
            preferredDirectMemberId={composerTargetMemberId}
            focusSignal={composerFocusSignal}
          />
        </section>

        {!rightSidebarCollapsed ? (
          <RoomMembersSidebar
            room={room}
            snapshot={snapshot}
            members={members}
            selectedMemberId={selectedMemberId}
            onOpenMember={onOpenMember}
            onDirectMessageMember={handleDirectMessageMember}
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

function RoomTopBar(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  room: Room;
  template?: TeamTemplate;
  members: TeamMember[];
  activeStreamSummary?: string;
  onOpenTemplate?: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}) {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    room,
    template,
    members,
    activeStreamSummary,
    onOpenTemplate,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } =
    props;
  const templateBadge = badgeToneProps(template?.accentTone ?? "paper");
  const watcherBadge = badgeToneProps("correction");
  const neutralBadge = badgeToneProps("paper");
  const statusBadgeLabel = activeStreamSummary ? "Running" : "Ready";

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <PanelToggleButton collapsed={leftSidebarCollapsed} side="left" onToggle={onToggleLeftSidebar} />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="m-0 text-3xl font-semibold tracking-tight">{room.name}</p>
            {onOpenTemplate ? (
              <button type="button" className="rounded-none border-0 bg-transparent p-0 text-left" onClick={onOpenTemplate}>
                <Badge variant={templateBadge.variant} className={cn(templateBadge.className, "cursor-pointer")}>
                  {template?.name ?? "Template"}
                </Badge>
              </button>
            ) : (
              <Badge variant={templateBadge.variant} className={templateBadge.className}>
                {template?.name ?? "Template"}
              </Badge>
            )}
            <Badge variant={neutralBadge.variant} className={neutralBadge.className}>
              {members.length} members
            </Badge>
            <Badge variant={watcherBadge.variant} className={watcherBadge.className}>
              {room.watcherIds.length} watchers
            </Badge>
            <Badge variant="outline">{statusBadgeLabel}</Badge>
          </div>
          {room.topic.trim().length > 0 ? <p className="m-0 max-w-3xl text-sm text-muted-foreground">{room.topic}</p> : null}
          {activeStreamSummary ? <p className="m-0 text-sm text-muted-foreground">{activeStreamSummary}</p> : null}
        </div>
      </div>
      <PanelToggleButton collapsed={rightSidebarCollapsed} side="right" onToggle={onToggleRightSidebar} />
    </div>
  );
}

function RoomMembersSidebar(props: {
  room: Room;
  snapshot: WorkspaceSnapshot;
  members: TeamMember[];
  selectedMemberId?: string;
  onOpenMember: (memberId: string) => void;
  onDirectMessageMember: (memberId: string) => void;
}) {
  const { room, snapshot, members, selectedMemberId, onOpenMember, onDirectMessageMember } = props;

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-[min(23rem,84vw)] min-h-0 border-l border-border/70 bg-background/96 backdrop-blur xl:static xl:w-auto xl:border-l-0 xl:bg-transparent xl:backdrop-blur-none">
      <Card className="flex h-full min-h-0 flex-col border border-border shadow-sm">
        <CardContent className="flex h-full min-h-0 flex-col gap-0 p-0">
          <div className="shrink-0 border-b border-border px-5 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Users size={18} />
                Members
              </p>
              <Badge variant="outline">{members.length}</Badge>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-3">
              {members.map((member) => {
                const activity = getMemberActivitySummary(snapshot, member);
                const activeTask = activity.activeTask;
                const statusBadge = memberStatusBadgeProps(member.status);
                const watcher = getWatcherForMember(room, snapshot, member.id);
                const roleLabel = getMemberRoleLabel(member.handle);
                const rolePalette = getMemberRolePalette(member.handle);

                return (
                  <MemberHoverPreview key={member.id} member={member} watcher={watcher}>
                    <div
                      className={cn(
                        "flex min-h-[154px] flex-col gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/60",
                        member.id === selectedMemberId && "border-ring bg-accent/10 shadow-md",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <MemberAvatar member={member} compact active={member.id === selectedMemberId} />
                        <div className="min-w-0 flex-1 space-y-3">
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="m-0 text-base font-semibold tracking-tight" style={{ color: rolePalette.background }}>
                                {roleLabel}
                              </p>
                              {member.observeAllRoomMessages ? (
                                <span
                                  className="inline-flex size-2 rounded-full bg-[color:var(--tone-blueprint-foreground)]"
                                  aria-label="monitoring room"
                                />
                              ) : null}
                              {member.isEntryMember ? <Badge variant="outline">Entry</Badge> : null}
                              {watcher ? <Badge variant="outline">Watcher {watcher.intervalMinutes}m</Badge> : null}
                            </div>
                            <p className="m-0 text-sm text-muted-foreground">{member.name}</p>
                          </div>
                          <div className="space-y-2">
                            <p className="m-0 text-sm leading-6 text-foreground/90">
                              {activeTask ? activeTask.title : summarizePrompt(member.summary, 120)}
                            </p>
                            {activeTask ? (
                              <>
                                <p className="m-0 text-xs leading-5 text-muted-foreground">{activity.statusLine}</p>
                                {activity.sourcePreview ? (
                                  <p className="m-0 text-xs leading-5 text-muted-foreground">
                                    Source: {summarizePrompt(activity.sourcePreview, 96)}
                                  </p>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                        <div className="space-y-1">
                          <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
                            {member.status}
                          </Badge>
                          <p className="m-0 text-xs text-muted-foreground">
                            {activity.statusLine}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" type="button" variant="outline" onClick={() => onDirectMessageMember(member.id)}>
                            Direct
                          </Button>
                          <Button size="sm" type="button" onClick={() => onOpenMember(member.id)}>
                            <CornerDownLeft size={14} />
                            Chat
                          </Button>
                        </div>
                      </div>
                    </div>
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
  quotedHandles: string[];
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
      quotedMemberIds: [],
      recipientMemberIds: [],
      taskId: message.metadata?.handlerSummaries?.[0]?.taskId,
    },
    authorMemberId: message.metadata?.memberId ?? (message.role === "assistant" ? activeRoute?.memberId : undefined),
    mentionedHandles: message.metadata?.mentionedHandles ?? [],
    quotedHandles: message.metadata?.quotedHandles ?? [],
    recipientHandles: message.metadata?.recipientHandles ?? [],
    handlerSummaries: message.metadata?.handlerSummaries ?? [],
  };
}
