import { useEffect, useRef, useState } from "react";

import { ArrowDown, Bot, CornerDownLeft, FolderKanban, GitBranch, TerminalSquare, Users } from "lucide-react";

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
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { getMemberRoleLabel, getMemberRolePalette } from "@/lib/member-display";
import { useRoomChat, type RoomChatStatus } from "@/lib/chat/use-room-chat";
import type { RoomTeamSummary } from "@/lib/room-team";
import { getUIMessageText, type WorkspaceUIMessage } from "@/lib/chat/workspace-ui-message";
import {
  getMessageHandlers,
  getMessageMentionHandles,
  getMessageQuotedHandles,
  getMessageRecipientHandles,
  type MessageHandlerSummary,
} from "@/lib/message-feed";
import { badgeToneProps, memberStatusBadgeProps } from "@/lib/ui-tone";
import { cn, summarizePrompt } from "@/lib/utils";

function PresenceBadge(props: { active: boolean; activeLabel: string; idleLabel: string; className?: string }) {
  const { active, activeLabel, idleLabel, className } = props;

  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
        active
          ? "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-badge)] text-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_1px_rgba(120,150,255,0.08)]"
          : "border-border/80 bg-background/80 text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          active
            ? "animate-oa-breathe bg-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_0.24rem_rgba(113,113,255,0.12)]"
            : "bg-muted-foreground/45",
        )}
      />
      {active ? activeLabel : idleLabel}
    </Badge>
  );
}

interface RunningRoomMemberPreview {
  memberId: string;
  memberName: string;
  memberHandle: string;
  summary: string;
}

function buildRunningRoomMemberPreviews(args: {
  members: TeamMember[];
  snapshot: WorkspaceSnapshot;
  activeRoutes: RoomChatStatus[];
}): RunningRoomMemberPreview[] {
  const { members, snapshot, activeRoutes } = args;
  const routeByMemberId = Object.fromEntries(activeRoutes.map((route) => [route.memberId, route] as const));

  return members
    .filter((member) => member.status === "running")
    .map((member) => {
      const activity = getMemberActivitySummary(snapshot, member);
      const routeSummary = routeByMemberId[member.id]?.summary?.trim();
      const activeTaskTitle = activity.activeTask?.title?.trim();
      const taskStatusLine = member.activeTaskId ? activity.statusLine.trim() : undefined;

      return {
        memberId: member.id,
        memberName: member.name,
        memberHandle: member.handle,
        summary: summarizePrompt(routeSummary || activeTaskTitle || taskStatusLine || "正在处理当前消息。", 96),
      } satisfies RunningRoomMemberPreview;
    });
}

export function ActiveRoomStatusBadge(props: { runningMembers: RunningRoomMemberPreview[] }) {
  const { runningMembers } = props;

  if (runningMembers.length === 0) {
    return <PresenceBadge active={false} activeLabel="Running" idleLabel="Ready" />;
  }

  return (
    <HoverCard openDelay={0} closeDelay={0}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label="Show running members"
          className="cursor-help rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PresenceBadge active activeLabel="Running" idleLabel="Ready" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" sideOffset={10} className="w-[min(26rem,calc(100vw-2.5rem))] p-0">
        <div className="flex flex-col gap-2 px-3 py-3">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Running members</p>
          <div className="flex flex-col gap-2">
            {runningMembers.map((member) => (
              <div key={member.memberId} className="rounded-xl border border-border/70 bg-muted/35 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2 rounded-full animate-oa-breathe bg-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_0.24rem_rgba(113,113,255,0.12)]"
                  />
                  <p className="m-0 text-sm font-semibold tracking-tight">@{member.memberHandle}</p>
                  <span className="text-xs text-muted-foreground">{member.memberName}</span>
                </div>
                <p className="m-0 mt-1 text-xs leading-5 text-muted-foreground">{member.summary}</p>
              </div>
            ))}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

function MemberStatusBadge(props: { status: TeamMember["status"] }) {
  const { status } = props;
  const statusBadge = memberStatusBadgeProps(status);
  const isRunning = status === "running";
  const isInterrupted = status === "interrupted";
  const label = isRunning ? "Running" : isInterrupted ? "Interrupted" : "Ready";

  return (
    <Badge
      variant={statusBadge.variant}
      className={cn(
        "gap-1.5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
        statusBadge.className,
        isRunning && "shadow-[0_0_0_1px_rgba(120,150,255,0.08)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          isRunning
            ? "animate-oa-breathe bg-[color:var(--tone-blueprint-foreground)] shadow-[0_0_0_0.24rem_rgba(113,113,255,0.12)]"
            : isInterrupted
              ? "bg-[color:var(--tone-correction-foreground)]"
              : "bg-muted-foreground/45",
        )}
      />
      {label}
    </Badge>
  );
}

export function ChatPane(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  snapshot: WorkspaceSnapshot;
  room?: Room;
  roomTeam?: RoomTeamSummary;
  members: TeamMember[];
  selectedMemberId?: string;
  connected: boolean;
  error?: string;
  onOpenMember: (memberId: string) => void;
  onOpenRoomTeam?: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}) {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    snapshot,
    room,
    roomTeam,
    members,
    selectedMemberId,
    connected,
    error,
    onOpenMember,
    onOpenRoomTeam,
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
  const runningMembers = buildRunningRoomMemberPreviews({
    members,
    snapshot,
    activeRoutes: roomChat.activeRoutes,
  });
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
    const templateCount = snapshot.templateOrder.length;
    const featuredTemplates = snapshot.templateOrder
      .slice(0, 3)
      .map((templateId) => snapshot.templates[templateId])
      .filter((template): template is TeamTemplate => Boolean(template));

    return (
      <main className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden px-6 py-10">
        <ShellToolbar leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} />
        <div className="grid flex-1 content-start gap-10 pt-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(17rem,24rem)]">
          <section className="space-y-10">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{connected ? "Runtime online" : "Runtime offline"}</Badge>
                <Badge variant="outline">{templateCount} templates ready</Badge>
                <Badge variant="outline">Project path supported</Badge>
              </div>
              <div className="space-y-3">
                <p className="m-0 text-5xl font-semibold tracking-tight">OpenAquarium</p>
                <p className="m-0 max-w-3xl text-lg leading-8 text-muted-foreground">
                  从左侧创建一个 project 开始协作。你可以选 team template，也可以额外填写 project path，让 ACP 直接在真实仓库目录里启动。
                </p>
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              <div className="space-y-3">
                <FolderKanban size={18} />
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight">1</p>
                  <p className="m-0 text-sm font-medium">新建 project</p>
                  <p className="m-0 text-sm leading-7 text-muted-foreground">在左侧 Projects 面板点击加号，立即生成一个空 room。</p>
                </div>
              </div>
              <div className="space-y-3">
                <Users size={18} />
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight">2</p>
                  <p className="m-0 text-sm font-medium">选择协作模板</p>
                  <p className="m-0 text-sm leading-7 text-muted-foreground">模板会决定入口成员、实现者、研究员和 watcher 的初始结构。</p>
                </div>
              </div>
              <div className="space-y-3">
                <GitBranch size={18} />
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight">3</p>
                  <p className="m-0 text-sm font-medium">可选填写 path</p>
                  <p className="m-0 text-sm leading-7 text-muted-foreground">如果你要操作真实项目，填写路径后 ACP 会以那个目录作为默认工作目录。</p>
                </div>
              </div>
            </div>
          </section>

          <aside className="space-y-6 pt-1">
            <div className="space-y-2">
              <p className="m-0 flex items-center gap-2 text-lg font-semibold tracking-tight">
                <TerminalSquare size={18} />
                Ready State
              </p>
              <p className="m-0 text-sm leading-7 text-muted-foreground">
                {connected
                  ? "Runtime 已连接。创建 project 后，首条消息会自动路由给入口成员。"
                  : "Runtime 还没连上。启动本地服务后再创建 project，消息和保存才会真正落盘。"}
              </p>
              {!connected ? <p className="m-0 font-mono text-xs text-muted-foreground">bun run server</p> : null}
            </div>

            <div className="space-y-3">
              <p className="m-0 text-sm font-medium">Available templates</p>
              <div className="flex flex-wrap gap-2">
                {featuredTemplates.map((template) => {
                  const badge = badgeToneProps(template.accentTone);

                  return (
                    <Badge key={template.id} variant={badge.variant} className={badge.className}>
                      {template.name}
                    </Badge>
                  );
                })}
              </div>
              <p className="m-0 text-sm leading-7 text-muted-foreground">
                新建 project 之后，消息区会展示 room transcript、成员状态和 watcher 活动。
              </p>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col gap-2 overflow-hidden bg-background/70 px-2 py-2 md:px-3">
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
        <section className="flex h-full min-h-0 min-w-0 flex-col gap-2">
          <RoomTopBar
            leftSidebarCollapsed={leftSidebarCollapsed}
            rightSidebarCollapsed={rightSidebarCollapsed}
            room={room}
            roomTeam={roomTeam}
            members={members}
            runningMembers={runningMembers}
            activeStreamSummary={roomChat.activeStreamSummary}
            onOpenRoomTeam={onOpenRoomTeam}
            onToggleLeftSidebar={onToggleLeftSidebar}
            onToggleRightSidebar={onToggleRightSidebar}
          />
          <div className="relative min-h-0 flex-1">
            <div ref={transcriptRef} className="flex h-full min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-0.5 py-0.5 md:px-1" onScroll={updateScrollState}>
              {roomChat.messages.map((message) => {
                const bubble = toBubbleModel(message, snapshot, room, snapshot.currentUserName);
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
  roomTeam?: RoomTeamSummary;
  members: TeamMember[];
  runningMembers: RunningRoomMemberPreview[];
  activeStreamSummary?: string;
  onOpenRoomTeam?: () => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}) {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    room,
    roomTeam,
    members,
    runningMembers,
    activeStreamSummary,
    onOpenRoomTeam,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } =
    props;
  const teamBadge = badgeToneProps(roomTeam?.accentTone ?? "paper");
  const watcherBadge = badgeToneProps("correction");
  const neutralBadge = badgeToneProps("paper");

  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <PanelToggleButton collapsed={leftSidebarCollapsed} side="left" onToggle={onToggleLeftSidebar} />
        <div className="min-w-0 flex-1 space-y-2 pt-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="m-0 text-3xl font-semibold tracking-tight">{room.name}</p>
            {onOpenRoomTeam ? (
              <button type="button" className="rounded-none border-0 bg-transparent p-0 text-left" onClick={onOpenRoomTeam}>
                <Badge variant={teamBadge.variant} className={cn(teamBadge.className, "cursor-pointer")}>
                  {roomTeam?.name ?? "Room team"}
                </Badge>
              </button>
            ) : (
              <Badge variant={teamBadge.variant} className={teamBadge.className}>
                {roomTeam?.name ?? "Room team"}
              </Badge>
            )}
            <Badge variant={neutralBadge.variant} className={neutralBadge.className}>
              {members.length} members
            </Badge>
            <Badge variant={watcherBadge.variant} className={watcherBadge.className}>
              {room.watcherIds.length} watchers
            </Badge>
            <ActiveRoomStatusBadge runningMembers={runningMembers} />
          </div>
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
  const runningMembers = members.filter((member) => member.status === "running").length;

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
              <div className="flex items-center gap-2">
                <PresenceBadge
                  active={runningMembers > 0}
                  activeLabel={runningMembers > 1 ? `${runningMembers} live` : "Live"}
                  idleLabel="Ready"
                />
                <Badge variant="outline">{members.length}</Badge>
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-3">
              {members.map((member) => {
                const activity = getMemberActivitySummary(snapshot, member);
                const activeTask = activity.activeTask;
                const watcher = getWatcherForMember(room, snapshot, member.id);
                const roleLabel = getMemberRoleLabel(member.handle);
                const rolePalette = getMemberRolePalette(member.handle);

                return (
                  <MemberHoverPreview key={member.id} member={member} watcher={watcher}>
                    <div
                      className={cn(
                        "flex min-h-[154px] flex-col gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/60",
                        member.id === selectedMemberId && "border-ring bg-accent/10 shadow-md",
                        member.status === "running" &&
                          "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)]/95 shadow-[0_18px_36px_-32px_rgba(62,118,255,0.95)]",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <MemberAvatar member={member} compact active={member.id === selectedMemberId} showRunningDot />
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
                              {member.status === "running" ? <PresenceBadge active activeLabel="Live now" idleLabel="Ready" /> : null}
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
                          <MemberStatusBadge status={member.status} />
                          <p className="m-0 text-xs text-muted-foreground">{activity.statusLine}</p>
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
  snapshot: WorkspaceSnapshot,
  room: Room,
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
  const sourceMessageId = message.metadata?.domainMessageId;
  const sourceMessage = sourceMessageId ? snapshot.messages[sourceMessageId] : undefined;
  const handlerSummaries = message.metadata?.handlerSummaries ?? (sourceMessage ? getMessageHandlers(snapshot, sourceMessage) : []);
  const mentionedHandles = message.metadata?.mentionedHandles ?? (sourceMessage ? getMessageMentionHandles(snapshot, sourceMessage) : []);
  const quotedHandles = message.metadata?.quotedHandles ?? (sourceMessage ? getMessageQuotedHandles(snapshot, sourceMessage) : []);
  const recipientHandles = message.metadata?.recipientHandles ?? (sourceMessage ? getMessageRecipientHandles(snapshot, room, sourceMessage) : []);

  return {
    message: {
      id: message.id,
      roomId: room.id,
      author: {
        kind: authorKind,
        id: authorId,
        label: authorLabel,
      },
      content: text,
      createdAt: message.metadata?.createdAt ?? new Date().toISOString(),
      transport: message.metadata?.transport ?? "group",
      status,
      mentionedMemberIds: sourceMessage?.mentionedMemberIds ?? [],
      quotedMemberIds: sourceMessage?.quotedMemberIds ?? [],
      recipientMemberIds: sourceMessage?.recipientMemberIds ?? [],
      taskId: handlerSummaries[0]?.taskId ?? sourceMessage?.taskId,
    },
    authorMemberId: message.metadata?.memberId ?? (message.role === "assistant" ? activeRoute?.memberId : undefined),
    mentionedHandles,
    quotedHandles,
    recipientHandles,
    handlerSummaries,
  };
}
