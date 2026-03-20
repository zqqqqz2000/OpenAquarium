import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  AlertTriangle,
  BarChart3,
  Bot,
  Eye,
  EyeOff,
  FolderKanban,
  GitBranch,
  Link2,
  TerminalSquare,
  Users,
} from "lucide-react";

import type {
  ChatMessage,
  Room,
  TeamMember,
  TeamTemplate,
  UpdateRoomSettingsInput,
  WorkspaceSnapshot,
} from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import {
  MessageBubble,
  MessageBubbleMeta,
} from "@/components/chat/message-bubble";
import { RoomDashboard } from "@/components/chat/room-dashboard";
import { RoomTodoTreesPanel } from "@/components/todo/room-todo-trees-panel";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { RunningMembersHoverCard } from "@/components/members/running-members-hover-card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { getMemberActivitySummary } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getMemberRoleLabel } from "@/lib/member-display";
import { useRoomChat, type RoomChatStatus } from "@/lib/chat/use-room-chat";
import { resolveRoomVisibleMemberIds } from "@/lib/room-message-preferences";
import { isProviderAssociationRequiredBinding } from "@/lib/provider-association";
import type { RoomTeamSummary } from "@/lib/room-team";
import {
  getUIMessageText,
  getVisibleRoomMessages,
  mapDomainMessageToUIMessage,
  type WorkspaceUIMessage,
} from "@/lib/chat/workspace-ui-message";
import {
  getMessageHandlers,
  getMessageMentionHandles,
  getMessageQuotedHandles,
  getMessageRecipientHandles,
  type MessageHandlerSummary,
} from "@/lib/message-feed";
import { WorkspaceRuntimeClient } from "@/lib/runtime-client";
import { badgeToneProps, compactBadgeClassName } from "@/lib/ui-tone";
import { cn, summarizePrompt } from "@/lib/utils";

function PresenceBadge(props: {
  active: boolean;
  activeLabel: string;
  idleLabel: string;
  className?: string;
}) {
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

const HISTORY_PAGE_SIZE = 80;

interface CachedTranscriptViewState {
  historyMessages: ChatMessage[];
  historyHasMore: boolean;
  scrollTop: number;
}

const transcriptViewStateByScopeKey = new Map<
  string,
  CachedTranscriptViewState
>();

function buildMemberCardBadges(
  member: TeamMember,
  room: Room,
  snapshot: WorkspaceSnapshot,
): string[] {
  const badges: string[] = [];

  if (member.isEntryMember) {
    badges.push("Entry");
  }

  if (
    room.watcherIds.some(
      (watcherId) => snapshot.watchers[watcherId]?.memberId === member.id,
    )
  ) {
    badges.push("Watcher");
  }

  if (member.provider.kind === "codex-acp") {
    badges.push("Codex ACP");
  }

  return badges;
}

function buildRunningRoomMemberPreviews(args: {
  members: TeamMember[];
  snapshot: WorkspaceSnapshot;
  activeRoutes: RoomChatStatus[];
}): RunningRoomMemberPreview[] {
  const { members, snapshot, activeRoutes } = args;
  const routeByMemberId = Object.fromEntries(
    activeRoutes.map((route) => [route.memberId, route] as const),
  );

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
        latestContentPreview: summarizePrompt(
          routeSummary || activity.latestContentPreview || "正在处理当前消息。",
          96,
        ),
      } satisfies RunningRoomMemberPreview;
    });
}

function groupMembersByRole(members: TeamMember[]): RoomRoleGroup[] {
  return members.reduce<RoomRoleGroup[]>((groups, member) => {
    const roleId =
      typeof member.roleId === "string" && member.roleId.trim().length > 0
        ? member.roleId.trim()
        : member.id;
    const roleName =
      typeof member.roleName === "string" && member.roleName.trim().length > 0
        ? member.roleName.trim()
        : member.handle;
    const existingGroup = groups.find((group) => group.roleId === roleId);
    if (existingGroup) {
      existingGroup.members.push(member);
      return groups;
    }

    return [...groups, { roleId, roleName, members: [member] }];
  }, []);
}

function resolveMemberLatestPreview(
  member: TeamMember,
  snapshot: WorkspaceSnapshot,
  activeRouteSummaryByMemberId: Record<string, string>,
): string {
  const activity = getMemberActivitySummary(snapshot, member);

  return (
    activeRouteSummaryByMemberId[member.id] ??
    (activity.latestMessage
      ? summarizePrompt(activity.latestMessage.content, 120)
      : undefined) ??
    activity.latestContentPreview ??
    "No recent visible update."
  );
}

export function ActiveRoomStatusBadge(props: {
  runningMembers: RunningRoomMemberPreview[];
  onOpenMember?: (preview: RunningRoomMemberPreview) => void;
}) {
  const { runningMembers, onOpenMember } = props;

  if (runningMembers.length === 0) {
    return (
      <PresenceBadge active={false} activeLabel="Running" idleLabel="Ready" />
    );
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
        tone === "neutral"
          ? "border-border/75 bg-background/80 text-muted-foreground"
          : "border-border/80 bg-background/70 text-foreground",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
      {children}
    </Badge>
  );
}

function SidebarMemberCard(props: {
  member: TeamMember;
  room: Room;
  snapshot: WorkspaceSnapshot;
  selectedMemberId?: string;
  latestPreview?: string;
  visible: boolean;
  onOpenMember: (memberId: string) => void;
  onToggleVisible: (memberId: string) => void;
}) {
  const {
    member,
    onOpenMember,
    onToggleVisible,
    selectedMemberId,
    visible,
    ...rest
  } = props;
  const roleLabel = getMemberRoleLabel(member.handle);

  return (
    <MemberHoverPreview member={member} latestPreview={rest.latestPreview}>
      <button
        aria-label={`Open ${roleLabel} session panel`}
        className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={() => onOpenMember(member.id)}
        type="button"
      >
        <SidebarMemberCardSurface
          member={member}
          visible={visible}
          onToggleVisible={onToggleVisible}
          {...rest}
          selected={member.id === selectedMemberId}
          className="hover:bg-muted/60"
        />
      </button>
    </MemberHoverPreview>
  );
}

function SidebarMemberCardSurface(props: {
  member: TeamMember;
  room: Room;
  snapshot: WorkspaceSnapshot;
  selected?: boolean;
  latestPreview?: string;
  previewMode?: "sidebar" | "hover";
  visible: boolean;
  onToggleVisible?: (memberId: string) => void;
  titleSuffix?: ReactNode;
  className?: string;
}) {
  const {
    member,
    room,
    snapshot,
    selected = false,
    latestPreview,
    previewMode = "sidebar",
    visible,
    onToggleVisible,
    titleSuffix,
    className,
  } = props;
  const summary = summarizePrompt(
    (member.note?.trim() || member.summary || "").trim(),
    140,
  );
  const badges = buildMemberCardBadges(member, room, snapshot);
  const eyeLabel = visible
    ? `Hide @${member.handle} messages`
    : `Show @${member.handle} messages`;
  const showSidebarSummary = previewMode === "sidebar" && summary.length > 0;
  const showLatestPreview = previewMode === "hover";
  const resolvedLatestPreview = latestPreview ?? "No recent visible update.";

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-border bg-card px-3.5 py-3 text-left shadow-sm transition-colors",
        selected && "border-ring bg-accent/10 shadow-md",
        !visible && "opacity-70",
        member.status === "running" &&
          "border-[color:var(--tone-blueprint-border)] bg-[color:var(--tone-blueprint-surface)]/95 shadow-[0_18px_36px_-32px_rgba(62,118,255,0.95)]",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <MemberAvatar
          member={member}
          compact
          active={selected}
          showRunningDot
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="inline-flex max-w-full items-center gap-2 align-top">
                <p className="m-0 truncate text-base font-semibold tracking-tight">
                  @{member.handle}
                </p>
                {titleSuffix}
              </div>
            </div>
            {onToggleVisible ? (
              <button
                type="button"
                aria-pressed={visible}
                aria-label={eyeLabel}
                title={eyeLabel}
                className={cn(
                  "inline-flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors",
                  visible
                    ? "border-border/70 bg-background text-foreground hover:bg-muted/50"
                    : "border-border/50 bg-muted/50 text-muted-foreground hover:bg-muted/70",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleVisible(member.id);
                }}
              >
                {visible ? <Eye size={15} /> : <EyeOff size={15} />}
              </button>
            ) : null}
          </div>
          {showSidebarSummary ? (
            <p className="mt-1 m-0 line-clamp-2 text-sm text-muted-foreground">
              {summary}
            </p>
          ) : null}
          {showLatestPreview ? (
            <div className="mt-2 rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Latest update
              </p>
              <p className="mt-1 m-0 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
                {resolvedLatestPreview}
              </p>
            </div>
          ) : null}
          {previewMode === "sidebar" && badges.length > 0 ? (
            <div className="mt-3 border-t border-border/70 pt-3">
              <div className="flex flex-wrap gap-1.5">
                {badges.map((badge) => (
                  <Badge key={badge} variant="outline">
                    {badge}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RoleGroupHoverPreview(props: {
  group: RoomRoleGroup;
  room: Room;
  snapshot: WorkspaceSnapshot;
  selectedMemberId?: string;
  visibleMemberIds: string[];
  activeRouteSummaryByMemberId: Record<string, string>;
  onOpenMember: (memberId: string) => void;
  onToggleVisible: (memberId: string) => void;
}) {
  const {
    group,
    room,
    snapshot,
    selectedMemberId,
    visibleMemberIds,
    activeRouteSummaryByMemberId,
    onOpenMember,
    onToggleVisible,
  } = props;
  const previewMember = group.members[0];
  const groupHasSelectedMember = group.members.some(
    (member) => member.id === selectedMemberId,
  );
  const visibleMemberIdSet = new Set(visibleMemberIds);

  if (!previewMember) {
    return null;
  }

  return (
    <HoverCard openDelay={120}>
      <HoverCardTrigger asChild>
        <div aria-label={`Role group ${group.roleName}`} className="w-full">
          <SidebarMemberCardSurface
            member={previewMember}
            room={room}
            snapshot={snapshot}
            selected={groupHasSelectedMember}
            visible={visibleMemberIdSet.has(previewMember.id)}
            onToggleVisible={onToggleVisible}
            titleSuffix={
              <Badge
                variant="outline"
                className="shrink-0 px-1.5 text-[10px] font-medium text-muted-foreground"
              >
                x {group.members.length}
              </Badge>
            }
            className="overflow-hidden bg-card transition-transform duration-150 ease-out hover:-translate-y-0.5"
          />
        </div>
      </HoverCardTrigger>
      <HoverCardContent
        side="left"
        align="start"
        sideOffset={14}
        collisionPadding={12}
        className="w-[min(88vw,340px)] max-h-[min(70vh,calc(100vh-2rem))] overflow-y-auto p-2.5"
      >
        <div className="flex flex-col gap-2">
          {group.members.map((member) => {
            const latestPreview = resolveMemberLatestPreview(
              member,
              snapshot,
              activeRouteSummaryByMemberId,
            );

            return (
              <button
                key={member.id}
                aria-label={`Open @${member.handle} session panel`}
                className={cn(
                  "w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                onClick={() => onOpenMember(member.id)}
                type="button"
              >
                <SidebarMemberCardSurface
                  member={member}
                  room={room}
                  snapshot={snapshot}
                  selected={member.id === selectedMemberId}
                  latestPreview={latestPreview}
                  previewMode="hover"
                  visible={visibleMemberIdSet.has(member.id)}
                  onToggleVisible={onToggleVisible}
                  className="hover:bg-muted/60"
                />
              </button>
            );
          })}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}

export function ChatPane(props: {
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  rightSidebarWidth?: number;
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
  onRightSidebarResizeStart?: (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => void;
}) {
  const {
    leftSidebarCollapsed,
    rightSidebarCollapsed,
    rightSidebarWidth = 372,
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
    onRightSidebarResizeStart = () => undefined,
  } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousLayoutKeyRef = useRef<string | undefined>(undefined);
  const previousLiveLatestMessageIdRef = useRef<string | undefined>(undefined);
  const historyBootstrapCursorRef = useRef<string | undefined>(undefined);
  const pendingInitialBottomAlignRef = useRef(false);
  const pendingPrependAnchorRef = useRef<
    { scrollHeight: number; scrollTop: number } | undefined
  >(undefined);
  const historyRequestIdRef = useRef(0);
  const pendingRestoreScrollTopRef = useRef<number | undefined>(undefined);
  const runtimeClient = useMemo(() => new WorkspaceRuntimeClient(), []);
  const roomId = room?.id;
  const visibleMemberIds = room
    ? resolveRoomVisibleMemberIds(
        snapshot,
        room,
        snapshot.templates[room.templateId],
      )
    : [];
  const historyScopeKey = `${roomId ?? "no-room"}:${visibleMemberIds.join(",")}`;
  const cachedTranscriptViewState = useMemo(
    () => transcriptViewStateByScopeKey.get(historyScopeKey),
    [historyScopeKey],
  );
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const [transcriptScrollTop, setTranscriptScrollTop] = useState(0);
  const [historyMessages, setHistoryMessages] = useState<ChatMessage[]>(
    () => cachedTranscriptViewState?.historyMessages ?? [],
  );
  const [historyHasMore, setHistoryHasMore] = useState(
    () => cachedTranscriptViewState?.historyHasMore ?? false,
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | undefined>(
    undefined,
  );
  const [focusedMessageId, setFocusedMessageId] = useState<string | undefined>(
    undefined,
  );
  const roomChat = useRoomChat({
    room,
    members,
    snapshot,
  });
  const membersNeedingProviderAssociation = useMemo(
    () =>
      members.filter((member) =>
        isProviderAssociationRequiredBinding(member.provider),
      ),
    [members],
  );
  const liveRoomMessages = useMemo(
    () => (room ? getVisibleRoomMessages(snapshot, room) : []),
    [room, snapshot],
  );
  historyBootstrapCursorRef.current = liveRoomMessages[0]?.id;
  const transcriptDomainMessages = useMemo(
    () => mergeVisibleRoomMessages(historyMessages, liveRoomMessages),
    [historyMessages, liveRoomMessages],
  );
  const transcriptMessages = useMemo(
    () =>
      room
        ? transcriptDomainMessages.map((message) =>
            mapDomainMessageToUIMessage(snapshot, room, message),
          )
        : [],
    [room, snapshot, transcriptDomainMessages],
  );
  const latestLiveMessageId = liveRoomMessages.at(-1)?.id;
  const layoutKey = `${roomId ?? "no-room"}:${leftSidebarCollapsed ? "left-closed" : "left-open"}:${rightSidebarCollapsed ? "right-closed" : "right-open"}`;
  const runningMembers = buildRunningRoomMemberPreviews({
    members,
    snapshot,
    activeRoutes: roomChat.activeRoutes,
  });
  const messageVirtualizer = useVirtualizer({
    count: transcriptMessages.length,
    getScrollElement: () => transcriptRef.current,
    estimateSize: () => 220,
    overscan: 8,
    getItemKey: (index) => transcriptMessages[index]?.id ?? index,
  });
  const virtualRows = messageVirtualizer.getVirtualItems();
  const stickyVirtualRow =
    virtualRows.find((row) => row.end > transcriptScrollTop + 4) ??
    virtualRows[0];
  const stickyMessage = stickyVirtualRow
    ? transcriptMessages[stickyVirtualRow.index]
    : undefined;
  const stickyBubble =
    stickyMessage && room
      ? toBubbleModel(stickyMessage, snapshot, room, snapshot.currentUserName)
      : undefined;
  const stickyAuthorMemberId = stickyBubble?.authorMemberId;
  const transcriptIndexByMessageId = useMemo(
    () =>
      Object.fromEntries(
        transcriptMessages.map(
          (message, index) => [message.id, index] as const,
        ),
      ),
    [transcriptMessages],
  );
  const updateScrollState = useCallback((): void => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    setTranscriptScrollTop(container.scrollTop);
    const bottomGap =
      container.scrollHeight - container.clientHeight - container.scrollTop;
    setShowScrollToLatest(bottomGap > 32);
  }, []);

  useEffect(() => {
    transcriptViewStateByScopeKey.set(historyScopeKey, {
      historyMessages,
      historyHasMore,
      scrollTop: transcriptRef.current?.scrollTop ?? transcriptScrollTop,
    });
  }, [historyHasMore, historyMessages, historyScopeKey, transcriptScrollTop]);
  const scrollTranscriptToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth"): void => {
      const container = transcriptRef.current;
      if (!container) {
        return;
      }

      if (transcriptMessages.length > 0) {
        messageVirtualizer.scrollToIndex(transcriptMessages.length - 1, {
          align: "end",
          behavior,
        });
      }

      window.requestAnimationFrame(() => {
        container.scrollTo({
          top: container.scrollHeight,
          behavior,
        });
        setShowScrollToLatest(false);
        updateScrollState();
      });
    },
    [messageVirtualizer, transcriptMessages.length, updateScrollState],
  );

  useEffect(() => {
    historyRequestIdRef.current += 1;
    const requestId = historyRequestIdRef.current;
    pendingInitialBottomAlignRef.current = !cachedTranscriptViewState;
    pendingPrependAnchorRef.current = undefined;
    pendingRestoreScrollTopRef.current = cachedTranscriptViewState?.scrollTop;
    setHistoryMessages([]);
    setHistoryHasMore(cachedTranscriptViewState?.historyHasMore ?? false);
    setHistoryError(undefined);

    if (!roomId) {
      setHistoryLoading(false);
      return;
    }

    if (cachedTranscriptViewState) {
      setHistoryMessages(cachedTranscriptViewState.historyMessages);
      setHistoryLoading(false);
      return;
    }

    setHistoryLoading(true);
    void runtimeClient
      .getRoomMessageHistory({
        roomId,
        beforeMessageId: historyBootstrapCursorRef.current,
        limit: HISTORY_PAGE_SIZE,
      })
      .then((page) => {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        setHistoryMessages(page.messages);
        setHistoryHasMore(page.hasMore);
        setHistoryError(undefined);
      })
      .catch((error) => {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        setHistoryMessages([]);
        setHistoryHasMore(false);
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Failed to load room history.",
        );
      })
      .finally(() => {
        if (historyRequestIdRef.current === requestId) {
          setHistoryLoading(false);
        }
      });
  }, [cachedTranscriptViewState, historyScopeKey, roomId, runtimeClient]);

  useEffect(() => {
    if (!roomId || transcriptMessages.length === 0) {
      return;
    }

    previousLayoutKeyRef.current = layoutKey;
    previousLiveLatestMessageIdRef.current = latestLiveMessageId;

    const restoreScrollTop = pendingRestoreScrollTopRef.current;
    if (typeof restoreScrollTop === "number") {
      pendingRestoreScrollTopRef.current = undefined;
      pendingInitialBottomAlignRef.current = false;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const container = transcriptRef.current;
          if (!container) {
            return;
          }

          container.scrollTo({
            top: restoreScrollTop,
            behavior: "auto",
          });
          updateScrollState();
        });
      });
      return;
    }

    if (!pendingInitialBottomAlignRef.current) {
      return;
    }

    pendingInitialBottomAlignRef.current = false;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        scrollTranscriptToLatest("auto");
      });
    });
  }, [
    layoutKey,
    latestLiveMessageId,
    roomId,
    scrollTranscriptToLatest,
    transcriptMessages.length,
    updateScrollState,
  ]);

  useEffect(() => {
    const pendingAnchor = pendingPrependAnchorRef.current;
    const container = transcriptRef.current;
    if (!pendingAnchor || !container) {
      return;
    }

    window.requestAnimationFrame(() => {
      container.scrollTo({
        top:
          pendingAnchor.scrollTop +
          (container.scrollHeight - pendingAnchor.scrollHeight),
        behavior: "auto",
      });
      updateScrollState();
      window.requestAnimationFrame(() => {
        container.scrollTo({
          top:
            pendingAnchor.scrollTop +
            (container.scrollHeight - pendingAnchor.scrollHeight),
          behavior: "auto",
        });
        pendingPrependAnchorRef.current = undefined;
        updateScrollState();
      });
    });
  }, [scrollTranscriptToLatest, transcriptMessages.length, updateScrollState]);

  useEffect(() => {
    if (
      !roomId ||
      transcriptMessages.length === 0 ||
      pendingInitialBottomAlignRef.current ||
      pendingPrependAnchorRef.current
    ) {
      return;
    }

    const layoutChanged = previousLayoutKeyRef.current !== layoutKey;
    const liveLatestChanged =
      previousLiveLatestMessageIdRef.current !== latestLiveMessageId;
    previousLayoutKeyRef.current = layoutKey;
    previousLiveLatestMessageIdRef.current = latestLiveMessageId;

    if ((layoutChanged || liveLatestChanged) && !showScrollToLatest) {
      window.requestAnimationFrame(() => {
        scrollTranscriptToLatest(layoutChanged ? "auto" : "smooth");
      });
      return;
    }

    window.requestAnimationFrame(updateScrollState);
  }, [
    layoutKey,
    latestLiveMessageId,
    roomId,
    scrollTranscriptToLatest,
    showScrollToLatest,
    transcriptMessages.length,
    updateScrollState,
  ]);

  const loadEarlierMessages = (): void => {
    if (!room || historyLoading) {
      return;
    }

    const requestId = ++historyRequestIdRef.current;
    const container = transcriptRef.current;
    if (container) {
      pendingPrependAnchorRef.current = {
        scrollHeight: container.scrollHeight,
        scrollTop: container.scrollTop,
      };
    }

    setHistoryLoading(true);
    setHistoryError(undefined);
    void runtimeClient
      .getRoomMessageHistory({
        roomId: room.id,
        beforeMessageId: transcriptDomainMessages[0]?.id,
        limit: HISTORY_PAGE_SIZE,
      })
      .then((page) => {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        if (page.messages.length === 0) {
          pendingPrependAnchorRef.current = undefined;
        }

        setHistoryMessages((currentMessages) =>
          mergeVisibleRoomMessages(page.messages, currentMessages),
        );
        setHistoryHasMore(page.hasMore);
      })
      .catch((error) => {
        if (historyRequestIdRef.current !== requestId) {
          return;
        }

        pendingPrependAnchorRef.current = undefined;
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Failed to load earlier messages.",
        );
      })
      .finally(() => {
        if (historyRequestIdRef.current === requestId) {
          setHistoryLoading(false);
        }
      });
  };

  const focusMessage = useCallback(
    (messageId: string): void => {
      const targetIndex = transcriptIndexByMessageId[messageId];
      if (typeof targetIndex !== "number") {
        return;
      }

      setFocusedMessageId(messageId);
      messageVirtualizer.scrollToIndex(targetIndex, {
        align: "center",
        behavior: "smooth",
      });
      window.setTimeout(() => {
        setFocusedMessageId((current) =>
          current === messageId ? undefined : current,
        );
      }, 1800);
    },
    [messageVirtualizer, transcriptIndexByMessageId],
  );

  if (!room) {
    const templateCount = snapshot.templateOrder.length;
    const featuredTemplates = snapshot.templateOrder
      .slice(0, 3)
      .map((templateId) => snapshot.templates[templateId])
      .filter((template): template is TeamTemplate => Boolean(template));

    return (
      <main className="flex h-full min-h-0 min-w-0 flex-col gap-4 overflow-hidden px-6 py-10">
        <ShellToolbar
          leftSidebarCollapsed={leftSidebarCollapsed}
          onToggleLeftSidebar={onToggleLeftSidebar}
        />
        <div className="grid flex-1 content-start gap-10 pt-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(17rem,24rem)]">
          <section className="space-y-10">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {connected ? "Runtime online" : "Runtime offline"}
                </Badge>
                <Badge variant="outline">{templateCount} templates ready</Badge>
                <Badge variant="outline">Project path supported</Badge>
              </div>
              <div className="space-y-3">
                <p className="m-0 text-5xl font-semibold tracking-tight">
                  OpenAquarium
                </p>
                <p className="m-0 max-w-3xl text-lg leading-8 text-muted-foreground">
                  从左侧创建一个 project 开始协作。你可以选 team
                  template，也可以额外填写 project path，让 ACP
                  直接在真实仓库目录里启动。
                </p>
              </div>
            </div>

            <div className="grid gap-8 md:grid-cols-3">
              <div className="space-y-3">
                <FolderKanban size={18} />
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight">1</p>
                  <p className="m-0 text-sm font-medium">新建 project</p>
                  <p className="m-0 text-sm leading-7 text-muted-foreground">
                    在左侧 Projects 面板点击加号，立即生成一个空 room。
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <Users size={18} />
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight">2</p>
                  <p className="m-0 text-sm font-medium">选择协作模板</p>
                  <p className="m-0 text-sm leading-7 text-muted-foreground">
                    模板会决定入口成员、实现者、研究员和 watcher 的初始结构。
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <GitBranch size={18} />
                <div className="space-y-2">
                  <p className="m-0 text-3xl font-semibold tracking-tight">3</p>
                  <p className="m-0 text-sm font-medium">可选填写 path</p>
                  <p className="m-0 text-sm leading-7 text-muted-foreground">
                    如果你要操作真实项目，填写路径后 ACP
                    会以那个目录作为默认工作目录。
                  </p>
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
              {!connected ? (
                <p className="m-0 font-mono text-xs text-muted-foreground">
                  bun run server
                </p>
              ) : null}
            </div>

            <div className="space-y-3">
              <p className="m-0 text-sm font-medium">Available templates</p>
              <div className="flex flex-wrap gap-2">
                {featuredTemplates.map((template) => {
                  const badge = badgeToneProps(template.accentTone);

                  return (
                    <Badge
                      key={template.id}
                      variant={badge.variant}
                      className={badge.className}
                    >
                      {template.name}
                    </Badge>
                  );
                })}
              </div>
              <p className="m-0 text-sm leading-7 text-muted-foreground">
                新建 project 之后，消息区会展示 room transcript、成员状态和
                watcher 活动。
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
            <p className="m-0 text-sm text-muted-foreground">
              启动本地 runtime 后，发消息和保存改动才会生效。
            </p>
            <p className="m-0 font-mono text-xs text-muted-foreground">
              bun run server
            </p>
            {error ? (
              <p className="m-0 text-xs text-destructive">{error}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      <div
        className={cn(
          "relative grid min-h-0 flex-1 grid-cols-1 overflow-hidden",
          !rightSidebarCollapsed &&
            "xl:grid-cols-[minmax(0,1fr)_var(--oa-right-panel)] xl:gap-3",
        )}
        style={
          !rightSidebarCollapsed
            ? ({
                "--oa-right-panel": `${rightSidebarWidth}px`,
              } as CSSProperties)
            : undefined
        }
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
            onOpenMember={(memberId) => onOpenMember(memberId)}
            onToggleLeftSidebar={onToggleLeftSidebar}
            onToggleRightSidebar={onToggleRightSidebar}
          />
          {membersNeedingProviderAssociation.length > 0 ? (
            <Card className="border border-amber-500/30 bg-amber-500/5 shadow-none">
              <CardContent className="flex flex-wrap items-start gap-3 p-4">
                <AlertTriangle size={18} className="mt-0.5 text-amber-700" />
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-medium">Provider association required</p>
                  <p className="m-0 text-sm leading-6 text-muted-foreground">
                    这个 project 是从 room context 恢复的。请先在 room team 或 member config 里为{" "}
                    {membersNeedingProviderAssociation
                      .map((member) => `@${member.handle}`)
                      .join(", ")}{" "}
                    关联 provider，再运行任务。
                  </p>
                </div>
                {onOpenRoomTeam ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenRoomTeam}
                  >
                    Open room team
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <div className="relative min-h-0 flex-1">
            {historyHasMore || historyError ? (
              <div className="mb-2 flex flex-col gap-2 px-1">
                {historyHasMore ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={historyLoading}
                    onClick={loadEarlierMessages}
                  >
                    {historyLoading
                      ? "Loading earlier messages..."
                      : "Load earlier messages"}
                  </Button>
                ) : null}
                {historyError ? (
                  <p className="m-0 text-xs text-destructive">{historyError}</p>
                ) : null}
              </div>
            ) : null}
            {transcriptScrollTop > 8 && stickyBubble ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
                <div className="pointer-events-auto bg-background/95 backdrop-blur-sm">
                  <MessageBubbleMeta
                    message={stickyBubble.message}
                    authorMember={
                      stickyAuthorMemberId
                        ? roomChat.activeMembersById[stickyAuthorMemberId]
                        : undefined
                    }
                    mentionedHandles={stickyBubble.mentionedHandles}
                    quotedHandles={stickyBubble.quotedHandles}
                    recipientHandles={stickyBubble.recipientHandles}
                    handlerSummaries={stickyBubble.handlerSummaries}
                    onAuthorClick={
                      stickyAuthorMemberId
                        ? () => onOpenMember(stickyAuthorMemberId)
                        : undefined
                    }
                  />
                </div>
              </div>
            ) : null}
            <div
              ref={transcriptRef}
              className="h-full min-h-0 overflow-y-auto pb-6"
              onScroll={updateScrollState}
            >
              {historyLoading && transcriptMessages.length === 0 ? (
                <Card className="border border-border shadow-none">
                  <CardContent className="flex items-center gap-4 p-5">
                    <Bot size={28} />
                    <p className="m-0 text-sm text-muted-foreground">
                      正在加载完整消息历史…
                    </p>
                  </CardContent>
                </Card>
              ) : transcriptMessages.length === 0 ? (
                <Card className="border border-border shadow-none">
                  <CardContent className="flex items-center gap-4 p-5">
                    <Bot size={28} />
                    <p className="m-0 text-sm text-muted-foreground">
                      还没有消息。发送第一句话开始。
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div
                  className="relative w-full"
                  style={{
                    height: `${messageVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const message = transcriptMessages[virtualRow.index];
                    if (!message) {
                      return null;
                    }

                    const bubble = toBubbleModel(
                      message,
                      snapshot,
                      room,
                      snapshot.currentUserName,
                    );
                    const authorMember = bubble.authorMemberId
                      ? roomChat.activeMembersById[bubble.authorMemberId]
                      : undefined;

                    return (
                      <div
                        key={virtualRow.key}
                        ref={messageVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className={cn(
                          "absolute top-0 left-0 w-full rounded-2xl py-1 transition-all duration-500",
                          focusedMessageId === bubble.message.id &&
                            "bg-[color:var(--tone-blueprint-surface)]/75 ring-1 ring-[color:var(--tone-blueprint-border)]",
                        )}
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <MessageBubble
                          key={bubble.message.id}
                          message={bubble.message}
                          authorMember={authorMember}
                          mentionedHandles={bubble.mentionedHandles}
                          quotedHandles={bubble.quotedHandles}
                          recipientHandles={bubble.recipientHandles}
                          handlerSummaries={bubble.handlerSummaries}
                          onAuthorClick={
                            authorMember
                              ? () => onOpenMember(authorMember.id)
                              : undefined
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            {showScrollToLatest ? (
              <Button
                className="absolute right-2 bottom-2 z-30 shadow-lg"
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
            runtimeClient={runtimeClient}
            snapshot={snapshot}
            members={members}
            visibleMemberIds={visibleMemberIds}
            selectedMemberId={selectedMemberId}
            activeRouteSummaryByMemberId={Object.fromEntries(
              roomChat.activeRoutes
                .filter((route) => route.summary?.trim())
                .map((route) => [
                  route.memberId,
                  summarizePrompt(route.summary?.trim() ?? "", 120),
                ]),
            )}
            onOpenMember={onOpenMember}
            onUpdateRoomSettings={onUpdateRoomSettings}
            onFocusMessage={focusMessage}
            onResizeStart={onRightSidebarResizeStart}
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
  const {
    leftSidebarCollapsed,
    onToggleLeftSidebar,
    rightSidebarCollapsed,
    onToggleRightSidebar,
  } = props;

  return (
    <div className="flex items-center justify-between gap-3">
      <PanelToggleButton
        collapsed={leftSidebarCollapsed}
        side="left"
        onToggle={onToggleLeftSidebar}
      />
      {typeof rightSidebarCollapsed === "boolean" && onToggleRightSidebar ? (
        <PanelToggleButton
          collapsed={rightSidebarCollapsed}
          side="right"
          onToggle={onToggleRightSidebar}
        />
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
  onOpenMember: (memberId: string) => void;
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
    onOpenMember,
    onToggleLeftSidebar,
    onToggleRightSidebar,
  } = props;
  const teamBadge = badgeToneProps(roomTeam?.accentTone ?? "paper");
  const teamBadgeTitle = roomTeam?.name?.trim() || "Room team";

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <PanelToggleButton
          collapsed={leftSidebarCollapsed}
          side="left"
          onToggle={onToggleLeftSidebar}
        />
        <div className="min-w-0 flex-1 space-y-3 pt-0.5">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
            <div className="min-w-[min(100%,24rem)] flex-[1_1_24rem]">
              <p className="m-0 truncate text-3xl font-semibold tracking-tight">
                {room.name}
              </p>
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
                  <Badge
                    variant={teamBadge.variant}
                    className={cn(
                      compactBadgeClassName,
                      teamBadge.className,
                      "max-w-full gap-1.5 px-2",
                    )}
                  >
                    <Link2 aria-hidden size={12} />
                    <span>Team</span>
                  </Badge>
                </button>
              ) : (
                <Badge
                  variant={teamBadge.variant}
                  className={cn(
                    compactBadgeClassName,
                    teamBadge.className,
                    "max-w-full gap-1.5 px-2",
                  )}
                  title={teamBadgeTitle}
                >
                  <Link2 aria-hidden size={12} />
                  <span>Team</span>
                </Badge>
              )}
              <RoomMetaBadge label="Members" value={String(members.length)} />
              <RoomMetaBadge
                label="Watchers"
                value={String(room.watcherIds.length)}
              />
              <ActiveRoomStatusBadge
                runningMembers={runningMembers}
                onOpenMember={(preview) => onOpenMember(preview.memberId)}
              />
            </div>
          </div>
          {activeStreamSummary ? (
            <p className="m-0 text-sm text-muted-foreground">
              {activeStreamSummary}
            </p>
          ) : null}
        </div>
      </div>
      <PanelToggleButton
        collapsed={rightSidebarCollapsed}
        side="right"
        onToggle={onToggleRightSidebar}
      />
    </div>
  );
}

function RoomMembersSidebar(props: {
  room: Room;
  runtimeClient: WorkspaceRuntimeClient;
  snapshot: WorkspaceSnapshot;
  members: TeamMember[];
  visibleMemberIds: string[];
  selectedMemberId?: string;
  activeRouteSummaryByMemberId: Record<string, string>;
  onOpenMember: (memberId: string) => void;
  onUpdateRoomSettings?: (input: UpdateRoomSettingsInput) => void;
  onFocusMessage: (messageId: string) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const {
    room,
    runtimeClient,
    snapshot,
    members,
    visibleMemberIds,
    selectedMemberId,
    activeRouteSummaryByMemberId,
    onOpenMember,
    onUpdateRoomSettings,
    onFocusMessage,
    onResizeStart,
  } = props;
  const roleGroups = useMemo(() => groupMembersByRole(members), [members]);
  const [activeTab, setActiveTab] = useState<"members" | "dashboard" | "todo">(
    "members",
  );
  const toggleMemberVisibility = useCallback(
    (memberId: string): void => {
      const visibleMemberIdSet = new Set(visibleMemberIds);
      const nextVisibleMemberIds = visibleMemberIdSet.has(memberId)
        ? visibleMemberIds.filter((candidateId) => candidateId !== memberId)
        : [...visibleMemberIds, memberId];
      onUpdateRoomSettings?.({
        roomId: room.id,
        visibleMemberIds: nextVisibleMemberIds,
      });
    },
    [onUpdateRoomSettings, room.id, visibleMemberIds],
  );

  return (
    <aside className="absolute inset-y-0 right-0 z-20 w-[min(23rem,84vw)] min-h-0 border-l border-border/70 bg-background/96 backdrop-blur xl:static xl:w-auto xl:border-l-0 xl:bg-transparent xl:backdrop-blur-none">
      <Card className="relative flex h-full min-h-0 flex-col border border-border shadow-sm">
        <CardContent className="flex h-full min-h-0 flex-col gap-0 p-0">
          <Tabs
            value={activeTab}
            onValueChange={(value) =>
              setActiveTab(value as "members" | "dashboard" | "todo")
            }
            className="h-full min-h-0 gap-0"
          >
            <div className="shrink-0 border-b border-border px-4 py-3">
              <TabsList
                variant="line"
                className="h-auto w-full justify-start rounded-none bg-transparent p-0"
              >
                <TabsTrigger
                  value="members"
                  className="rounded-none px-2.5 py-2"
                >
                  <Users size={16} />
                  Members
                  <Badge variant="outline" className="ml-1">
                    {members.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger
                  value="todo"
                  className="rounded-none px-2.5 py-2"
                >
                  <FolderKanban size={16} />
                  Todo
                </TabsTrigger>
                <TabsTrigger
                  value="dashboard"
                  className="rounded-none px-2.5 py-2"
                >
                  <BarChart3 size={16} />
                  Dashboard
                </TabsTrigger>
              </TabsList>
            </div>
            <TabsContent
              value="members"
              className="m-0 min-h-0 flex-1 overflow-y-auto px-3 py-3"
            >
              <div className="min-h-full">
                <div className="flex flex-col gap-2.5">
                  {roleGroups.map((group: RoomRoleGroup) => {
                    if (group.members.length === 0) {
                      return null;
                    }

                    if (group.members.length === 1) {
                      const member = group.members[0];
                      const latestPreview = resolveMemberLatestPreview(
                        member,
                        snapshot,
                        activeRouteSummaryByMemberId,
                      );

                      return (
                        <SidebarMemberCard
                          key={group.roleId}
                          member={member}
                          room={room}
                          snapshot={snapshot}
                          visible={visibleMemberIds.includes(member.id)}
                          selectedMemberId={selectedMemberId}
                          latestPreview={latestPreview}
                          onOpenMember={onOpenMember}
                          onToggleVisible={toggleMemberVisibility}
                        />
                      );
                    }

                    return (
                      <RoleGroupHoverPreview
                        key={group.roleId}
                        group={group}
                        room={room}
                        snapshot={snapshot}
                        selectedMemberId={selectedMemberId}
                        visibleMemberIds={visibleMemberIds}
                        activeRouteSummaryByMemberId={
                          activeRouteSummaryByMemberId
                        }
                        onOpenMember={onOpenMember}
                        onToggleVisible={toggleMemberVisibility}
                      />
                    );
                  })}
                </div>
              </div>
            </TabsContent>
            <TabsContent
              value="todo"
              className="m-0 min-h-0 flex-1 overflow-hidden px-3 py-3"
            >
              <RoomTodoTreesPanel room={room} runtimeClient={runtimeClient} />
            </TabsContent>
            <TabsContent
              value="dashboard"
              className="m-0 min-h-0 flex-1 overflow-y-auto px-3 py-3"
            >
              <RoomDashboard
                snapshot={snapshot}
                room={room}
                members={members}
                onOpenMember={onOpenMember}
                onFocusMessage={onFocusMessage}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
        <div
          aria-hidden
          className="absolute inset-y-0 -left-2 hidden w-4 cursor-col-resize xl:block"
          onPointerDown={onResizeStart}
        >
          <div className="absolute inset-y-4 left-1/2 w-px -translate-x-1/2 rounded-full bg-border/80" />
        </div>
      </Card>
    </aside>
  );
}

function mergeVisibleRoomMessages(
  historyMessages: ChatMessage[],
  liveMessages: ChatMessage[],
): ChatMessage[] {
  const mergedById = new Map<string, ChatMessage>();

  historyMessages.forEach((message) => {
    mergedById.set(message.id, message);
  });
  liveMessages.forEach((message) => {
    mergedById.set(message.id, message);
  });

  return [...mergedById.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

function inferMessageStatus(
  message: WorkspaceUIMessage,
): ChatMessage["status"] {
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
  const authorKind =
    message.metadata?.authorKind ??
    (message.role === "user" ? "user" : "member");
  const authorId =
    message.metadata?.authorId ??
    (message.role === "user" ? "user" : (activeRoute?.memberId ?? "assistant"));
  const authorLabel =
    message.metadata?.authorLabel ??
    (message.role === "user"
      ? currentUserName
      : (activeRoute?.memberName ?? "Assistant"));
  const sourceMessageId = message.metadata?.domainMessageId;
  const sourceMessage = sourceMessageId
    ? snapshot.messages[sourceMessageId]
    : undefined;
  const handlerSummaries =
    message.metadata?.handlerSummaries ??
    (sourceMessage ? getMessageHandlers(snapshot, sourceMessage) : []);
  const mentionedHandles =
    message.metadata?.mentionedHandles ??
    (sourceMessage ? getMessageMentionHandles(snapshot, sourceMessage) : []);
  const quotedHandles =
    message.metadata?.quotedHandles ??
    (sourceMessage ? getMessageQuotedHandles(snapshot, sourceMessage) : []);
  const recipientHandles =
    message.metadata?.recipientHandles ??
    (sourceMessage
      ? getMessageRecipientHandles(snapshot, room, sourceMessage)
      : []);

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
    authorMemberId:
      message.metadata?.memberId ??
      (message.role === "assistant" ? activeRoute?.memberId : undefined),
    mentionedHandles,
    quotedHandles,
    recipientHandles,
    handlerSummaries,
  };
}
