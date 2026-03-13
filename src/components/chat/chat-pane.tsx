import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ArrowDown, Bot, ChevronDown, ChevronRight, FolderKanban, GitBranch, Link2, TerminalSquare, Users } from "lucide-react";

import type {
  ChatMessage,
  Room,
  TeamMember,
  TeamTemplate,
  UpdateRoomSettingsInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { RunningMembersHoverCard } from "@/components/members/running-members-hover-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getMemberActivitySummary } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMemberRoleLabel, getMemberRoleMonogram, getMemberRolePalette } from "@/lib/member-display";
import { useRoomChat, type RoomChatStatus } from "@/lib/chat/use-room-chat";
import { resolveRoomVisibleMemberIds } from "@/lib/room-message-preferences";
import type { RoomTeamSummary } from "@/lib/room-team";
import { getUIMessageText, type WorkspaceUIMessage } from "@/lib/chat/workspace-ui-message";
import {
  getMessageHandlers,
  getMessageMentionHandles,
  getMessageQuotedHandles,
  getMessageRecipientHandles,
  type MessageHandlerSummary,
} from "@/lib/message-feed";
import { badgeToneProps, compactBadgeClassName, memberStatusBadgeProps } from "@/lib/ui-tone";
import { cn, summarizePrompt } from "@/lib/utils";

function PresenceBadge(props: { active: boolean; activeLabel: string; idleLabel: string; className?: string }) {
  const { active, activeLabel, idleLabel, className } = props;

  return (
    <Badge
      variant="outline"
      className={cn(
        compactBadgeClassName,
        "gap-1.5",
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
  roomId: string;
  memberId: string;
  memberName: string;
  memberHandle: string;
  latestContentPreview?: string;
}

interface RoomRoleGroup {
  roleId: string;
  roleName: string;
  members: TeamMember[];
}

function buildMemberCardBadges(member: TeamMember, room: Room, snapshot: WorkspaceSnapshot): string[] {
  const badges: string[] = [];

  if (member.isEntryMember) {
    badges.push("Entry");
  }

  if (room.watcherIds.some((watcherId) => snapshot.watchers[watcherId]?.memberId === member.id)) {
    badges.push("Watcher");
  }

  if (member.provider.kind === "codex-acp") {
    badges.push("Codex ACP");
  }

  if (member.acceptsDirectMessages) {
    badges.push("Direct messages");
  }

  return badges;
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

      return {
        roomId: member.roomId,
        memberId: member.id,
        memberName: member.name,
        memberHandle: member.handle,
        latestContentPreview: summarizePrompt(routeSummary || activity.latestContentPreview || "正在处理当前消息。", 96),
      } satisfies RunningRoomMemberPreview;
    });
}

function groupMembersByRole(members: TeamMember[]): RoomRoleGroup[] {
  return members.reduce<RoomRoleGroup[]>((groups, member) => {
    const existingGroup = groups.find((group) => group.roleId === member.roleId);
    if (existingGroup) {
      existingGroup.members.push(member);
      return groups;
    }

    return [...groups, { roleId: member.roleId, roleName: member.roleName, members: [member] }];
  }, []);
}

export function ActiveRoomStatusBadge(props: {
  runningMembers: RunningRoomMemberPreview[];
  onOpenMember?: (preview: RunningRoomMemberPreview) => void;
}) {
  const { runningMembers, onOpenMember } = props;

  if (runningMembers.length === 0) {
    return <PresenceBadge active={false} activeLabel="Running" idleLabel="Ready" />;
  }

  return (
    <RunningMembersHoverCard
      members={runningMembers}
      side="bottom"
      align="start"
      onOpenMember={onOpenMember}
    >
      <span
        aria-label="Show running members"
        className="inline-flex align-middle"
      >
        <PresenceBadge active activeLabel="Running" idleLabel="Ready" />
      </span>
    </RunningMembersHoverCard>
  );
}

function RoomMetaBadge(props: {
  label: string;
  value: string;
  tone?: "outline" | "neutral";
  className?: string;
  children?: ReactNode;
}) {
  const { label, value, tone = "neutral", className, children } = props;

  return (
    <Badge
      variant="outline"
      className={cn(
        compactBadgeClassName,
        "gap-1",
        tone === "neutral" ? "border-border/75 bg-background/80 text-muted-foreground" : "border-border/80 bg-background/70 text-foreground",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
      {children}
    </Badge>
  );
}

function MemberVisibilityFilter(props: {
  members: TeamMember[];
  visibleMemberIds: string[];
  onChange: (visibleMemberIds: string[]) => void;
}) {
  const { members, visibleMemberIds, onChange } = props;
  const [draftVisibleMemberIds, setDraftVisibleMemberIds] = useState(visibleMemberIds);

  useEffect(() => {
    setDraftVisibleMemberIds(visibleMemberIds);
  }, [visibleMemberIds]);

  const visibleMemberIdSet = new Set(draftVisibleMemberIds);
  const toggleMember = (memberId: string): void => {
    const nextVisibleMemberIds = visibleMemberIdSet.has(memberId)
      ? draftVisibleMemberIds.filter((candidateId) => candidateId !== memberId)
      : [...draftVisibleMemberIds, memberId];
    setDraftVisibleMemberIds(nextVisibleMemberIds);
    onChange(nextVisibleMemberIds);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Visible members filter">
      {members.map((member) => {
        const checked = visibleMemberIdSet.has(member.id);
        const rolePalette = getMemberRolePalette(member.handle);
        const roleMonogram = getMemberRoleMonogram(member.handle);

        return (
          <button
            key={member.id}
            type="button"
            aria-pressed={checked}
            aria-label={`Toggle @${member.handle} visibility`}
            className={cn(
              "group relative inline-flex h-8 max-w-full items-center gap-1.5 overflow-hidden rounded-full border px-2.5 text-xs font-medium transition-colors",
              checked
                ? "border-border/70 bg-background/90 text-foreground shadow-sm hover:border-border hover:bg-background"
                : "border-border/55 bg-muted/40 text-muted-foreground grayscale hover:bg-muted/60",
            )}
            onClick={() => toggleMember(member.id)}
          >
            <Avatar size="sm" className="ring-0 after:hidden">
              <AvatarFallback style={{ backgroundColor: rolePalette.background, color: rolePalette.foreground }}>{roleMonogram}</AvatarFallback>
            </Avatar>
            <span className="max-w-20 truncate">{member.handle}</span>
            {!checked ? (
              <>
                <span aria-hidden className="absolute inset-0 bg-background/20" />
                <span aria-hidden className="pointer-events-none absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2 -rotate-[24deg] bg-foreground/35" />
              </>
            ) : null}
          </button>
        );
      })}
    </div>
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
  onUpdateRoomSettings?: (input: UpdateRoomSettingsInput) => void;
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
    onUpdateRoomSettings,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousLayoutKeyRef = useRef<string | undefined>(undefined);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const roomChat = useRoomChat({
    room,
    members,
    snapshot,
  });
  const roomId = room?.id;
  const latestMessageId = roomChat.messages.at(-1)?.id;
  const layoutKey = `${roomId ?? "no-room"}:${leftSidebarCollapsed ? "left-closed" : "left-open"}:${rightSidebarCollapsed ? "right-closed" : "right-open"}`;
  const runningMembers = buildRunningRoomMemberPreviews({
    members,
    snapshot,
    activeRoutes: roomChat.activeRoutes,
  });
  const visibleMemberIds = room ? resolveRoomVisibleMemberIds(snapshot, room, snapshot.templates[room.templateId]) : [];
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
            visibleMemberIds={visibleMemberIds}
            runningMembers={runningMembers}
            activeStreamSummary={roomChat.activeStreamSummary}
            onOpenRoomTeam={onOpenRoomTeam}
            onOpenMember={(memberId) => onOpenMember(memberId)}
            onUpdateRoomSettings={onUpdateRoomSettings}
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
            draftKey={room ? `room:${room.id}` : undefined}
          />
        </section>

        {!rightSidebarCollapsed ? (
          <RoomMembersSidebar
            room={room}
            snapshot={snapshot}
            members={members}
            selectedMemberId={selectedMemberId}
            activeRouteSummaryByMemberId={Object.fromEntries(
              roomChat.activeRoutes
                .filter((route) => route.summary?.trim())
                .map((route) => [route.memberId, summarizePrompt(route.summary?.trim() ?? "", 120)]),
            )}
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

function RoomTopBar(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  room: Room;
  roomTeam?: RoomTeamSummary;
  members: TeamMember[];
  visibleMemberIds: string[];
  runningMembers: RunningRoomMemberPreview[];
  activeStreamSummary?: string;
  onOpenRoomTeam?: () => void;
  onOpenMember: (memberId: string) => void;
  onUpdateRoomSettings?: (input: UpdateRoomSettingsInput) => void;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
}) {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    room,
    roomTeam,
    members,
    visibleMemberIds,
    runningMembers,
    activeStreamSummary,
    onOpenRoomTeam,
    onOpenMember,
    onUpdateRoomSettings,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } =
    props;
  const teamBadge = badgeToneProps(roomTeam?.accentTone ?? "paper");
  const teamBadgeTitle = roomTeam?.name?.trim() || "Room team";

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <PanelToggleButton collapsed={leftSidebarCollapsed} side="left" onToggle={onToggleLeftSidebar} />
        <div className="min-w-0 flex-1 space-y-3 pt-0.5">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-[min(100%,24rem)] flex-[1_1_24rem]">
              <p className="m-0 truncate text-3xl font-semibold tracking-tight">{room.name}</p>
            </div>
            <div className="flex max-w-full shrink-0 flex-nowrap items-center gap-1.5">
              {onOpenRoomTeam ? (
                <button
                  type="button"
                  aria-label={`Edit ${teamBadgeTitle}`}
                  title={teamBadgeTitle}
                  className="inline-flex rounded-full border-0 bg-transparent p-0 text-left align-middle"
                  onClick={onOpenRoomTeam}
                >
                  <Badge variant={teamBadge.variant} className={cn(compactBadgeClassName, teamBadge.className, "max-w-full gap-1.5 px-2")}>
                    <Link2 aria-hidden size={12} />
                    <span>Team</span>
                  </Badge>
                </button>
              ) : (
                <Badge
                  variant={teamBadge.variant}
                  className={cn(compactBadgeClassName, teamBadge.className, "max-w-full gap-1.5 px-2")}
                  title={teamBadgeTitle}
                >
                  <Link2 aria-hidden size={12} />
                  <span>Team</span>
                </Badge>
              )}
              <RoomMetaBadge label="Members" value={String(members.length)} />
              <RoomMetaBadge label="Watchers" value={String(room.watcherIds.length)} />
              <ActiveRoomStatusBadge
                runningMembers={runningMembers}
                onOpenMember={(preview) => onOpenMember(preview.memberId)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Message filter</span>
            <MemberVisibilityFilter
              members={members}
              visibleMemberIds={visibleMemberIds}
              onChange={(nextVisibleMemberIds) => onUpdateRoomSettings?.({ roomId: room.id, visibleMemberIds: nextVisibleMemberIds })}
            />
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
  activeRouteSummaryByMemberId: Record<string, string>;
  onOpenMember: (memberId: string) => void;
}) {
  const { room, snapshot, members, selectedMemberId, activeRouteSummaryByMemberId, onOpenMember } = props;
  const roleGroups = useMemo(() => groupMembersByRole(members), [members]);
  const [collapsedRoleIds, setCollapsedRoleIds] = useState<string[]>([]);

  useEffect(() => {
    setCollapsedRoleIds([]);
  }, [room.id]);

  const toggleRoleGroup = (roleId: string): void => {
    setCollapsedRoleIds((current) => (current.includes(roleId) ? current.filter((value) => value !== roleId) : [...current, roleId]));
  };

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
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="flex flex-col gap-2.5">
              {roleGroups.map((group: RoomRoleGroup) => {
                const collapsed = collapsedRoleIds.includes(group.roleId);
                const leadMember = group.members[0];
                if (!leadMember) {
                  return null;
                }

                return (
                  <div key={group.roleId} className="rounded-2xl border border-border/70 bg-card/35 p-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left"
                      onClick={() => toggleRoleGroup(group.roleId)}
                    >
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold tracking-tight">{group.roleName}</p>
                        <p className="m-0 text-xs text-muted-foreground">{group.members.length} staff</p>
                      </div>
                      {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {!collapsed ? (
                      <div className="mt-2 flex flex-col gap-2.5">
                        {group.members.map((member: TeamMember) => {
                          const roleLabel = getMemberRoleLabel(member.handle);
                          const summary = summarizePrompt((member.note?.trim() || member.summary || "").trim(), 140);
                          const activity = getMemberActivitySummary(snapshot, member);
                          const badges = buildMemberCardBadges(member, room, snapshot);
                          const latestPreview = activeRouteSummaryByMemberId[member.id]
                            ?? (activity.latestMessage ? summarizePrompt(activity.latestMessage.content, 120) : undefined)
                            ?? activity.latestContentPreview
                            ?? "No recent visible update.";

                          return (
                            <MemberHoverPreview key={member.id} member={member} watcher={undefined}>
                              <button
                                aria-label={`Open ${roleLabel} session panel`}
                                className={cn(
                                  "w-full rounded-2xl border border-border bg-card px-3.5 py-3 text-left shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  member.id === selectedMemberId && "border-ring bg-accent/10 shadow-md",
                                  member.status === "running" &&
                                    "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)]/95 shadow-[0_18px_36px_-32px_rgba(62,118,255,0.95)]",
                                )}
                                onClick={() => onOpenMember(member.id)}
                                type="button"
                              >
                                <div className="flex items-start gap-3">
                                  <MemberAvatar member={member} compact active={member.id === selectedMemberId} showRunningDot />
                                  <div className="min-w-0 flex-1">
                                    <p className="m-0 truncate text-base font-semibold tracking-tight">@{member.handle}</p>
                                    {summary ? <p className="mt-1 m-0 line-clamp-2 text-sm text-muted-foreground">{summary}</p> : null}
                                    <p className="mt-2 truncate text-sm text-foreground/85">{latestPreview}</p>
                                    <div className="mt-3 border-t border-border/70 pt-3">
                                      <div className="flex flex-wrap gap-1.5">
                                        {badges.map((badge) => (
                                          <Badge key={badge} variant="outline">
                                            {badge}
                                          </Badge>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </button>
                            </MemberHoverPreview>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
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
