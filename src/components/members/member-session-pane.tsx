import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDown,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  Megaphone,
  Sparkles,
  TriangleAlert,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { getCollapsedMessageContent } from "@/components/chat/message-content";
import { MessageMarkdown } from "@/components/chat/message-markdown";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MemberIdentityChip } from "@/components/members/member-identity-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  getMemberSessionTimelineEntries,
  type MemberSessionActivityEntry,
  type MemberSessionActivityEvent,
  type MemberSessionInternalEvent,
  type MemberSessionRoomMessageEvent,
  type MemberSessionToolEvent,
  type MemberSessionTimelineEntry,
} from "@/lib/member-session-feed";
import { badgeToneProps, messageStatusBadgeProps, surfaceToneClass } from "@/lib/ui-tone";
import { cn, formatTime } from "@/lib/utils";

function getActivityTone(entry: MemberSessionActivityEntry): {
  icon: LucideIcon;
  label: string;
  surfaceTone: "paper" | "postit" | "blueprint" | "correction";
} {
  if (entry.latestInternalEvent?.kind === "error" || entry.latestInternalEvent?.kind === "interrupted") {
    return {
      icon: TriangleAlert,
      label: "Internal error",
      surfaceTone: "correction",
    };
  }

  if (entry.taskStatus === "running") {
    return {
      icon: LoaderCircle,
      label: entry.latestInternalEvent?.streaming ? "Internal stream" : "Internal activity",
      surfaceTone: "postit",
    };
  }

  const latestKind = entry.latestInternalEvent?.kind;
  if (latestKind === "draft" || latestKind === "completed") {
    return {
      icon: Bot,
      label: "Internal reply",
      surfaceTone: "blueprint",
    };
  }

  return {
    icon: Bot,
    label: "Internal activity",
    surfaceTone: "paper",
  };
}

function getInternalEventMeta(event: MemberSessionInternalEvent): {
  icon: LucideIcon;
  label: string;
  surfaceTone: "paper" | "postit" | "blueprint" | "correction";
} {
  switch (event.kind) {
    case "draft":
      return {
        icon: LoaderCircle,
        label: event.streaming ? "Internal draft" : "Internal reply",
        surfaceTone: event.streaming ? "postit" : "blueprint",
      };
    case "completed":
      return {
        icon: Bot,
        label: "Internal reply",
        surfaceTone: "blueprint",
      };
    case "tool-call":
      return {
        icon: Wrench,
        label: event.title,
        surfaceTone: "paper",
      };
    case "tool-result":
      return {
        icon: CheckCircle2,
        label: event.title,
        surfaceTone: "blueprint",
      };
    case "reasoning":
      return {
        icon: Sparkles,
        label: event.title,
        surfaceTone: "paper",
      };
    case "interrupted":
      return {
        icon: TriangleAlert,
        label: event.title || "Interrupted",
        surfaceTone: "correction",
      };
    case "error":
      return {
        icon: TriangleAlert,
        label: event.title || "Internal error",
        surfaceTone: "correction",
      };
    case "status":
    default:
      return {
        icon: LoaderCircle,
        label: event.title,
        surfaceTone: "postit",
      };
  }
}

function SessionInternalEventRow(props: { event: MemberSessionInternalEvent }) {
  const { event } = props;
  const { icon: Icon, label, surfaceTone } = getInternalEventMeta(event);
  const toneBadge = badgeToneProps(surfaceTone);
  const contentPreview = getCollapsedMessageContent(event.content, 1_200);
  const [expanded, setExpanded] = useState(!contentPreview.collapsed);
  const displayContent = expanded ? event.content : contentPreview.preview;

  return (
    <div
      data-testid="member-session-internal-event"
      className={cn("rounded-[1.25rem] border border-border/70 px-3 py-2.5", surfaceToneClass(surfaceTone))}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={toneBadge.variant} className={cn("gap-1 px-2 py-0.5 text-[10px]", toneBadge.className)}>
          <Icon
            size={14}
            className={cn(
              event.kind === "status" && "animate-spin",
              event.kind === "draft" && event.streaming && "animate-spin",
            )}
          />
          {label}
        </Badge>
        {event.streaming ? (
          <Badge variant="secondary" className="gap-1 px-2 py-0.5 text-[10px]">
            <LoaderCircle size={12} className="animate-spin" />
            live
          </Badge>
        ) : null}
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{formatTime(event.createdAt)}</span>
      </div>
      <p
        className={cn(
          "m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-6",
          (event.kind === "error" || event.kind === "interrupted") && "text-[color:var(--tone-correction-foreground)]",
        )}
      >
        {displayContent}
      </p>
      {contentPreview.collapsed ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Collapse details" : "Show full details"}
        </Button>
      ) : null}
    </div>
  );
}

function SessionToolEventRow(props: { event: MemberSessionToolEvent }) {
  const { event } = props;
  const toolBadge = badgeToneProps("paper");
  const statusBadge = badgeToneProps(event.status === "completed" ? "blueprint" : "postit");
  const timeLabel = event.updatedAt === event.createdAt
    ? formatTime(event.createdAt)
    : `${formatTime(event.createdAt)} -> ${formatTime(event.updatedAt)}`;

  return (
    <div
      data-testid="member-session-tool-event"
      className={cn(
        "rounded-[1.25rem] border border-border/70 px-3 py-2.5",
        surfaceToneClass(event.status === "completed" ? "blueprint" : "paper"),
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={toolBadge.variant} className={cn("gap-1 px-2 py-0.5 text-[10px]", toolBadge.className)}>
          <Wrench size={14} />
          Tool
        </Badge>
        <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
          {event.status}
        </Badge>
        <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{timeLabel}</span>
      </div>
      <p className="m-0 mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-muted-foreground">{event.toolName}</p>
    </div>
  );
}

function SessionRoomReplyRow(props: {
  member: TeamMember;
  event: MemberSessionRoomMessageEvent;
  onOpenMember?: (memberId: string) => void;
}) {
  const { member, event, onOpenMember } = props;
  const [expanded, setExpanded] = useState(false);
  const preview = getCollapsedMessageContent(event.message.message.content, 280);
  const displayContent = expanded ? event.message.message.content : preview.preview;
  const transportBadge = badgeToneProps("paper");
  const statusBadge = messageStatusBadgeProps(event.message.message.status);
  const contextBadges = event.message.contextBadges.filter((badge) => badge.id !== "reply" && badge.id !== "authored");

  return (
    <div
      data-testid="member-session-room-reply"
      className={cn("rounded-[1.25rem] border border-border/70 px-3 py-2.5", surfaceToneClass("paper"))}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <MemberIdentityChip member={member} onClick={onOpenMember ? () => onOpenMember(member.id) : undefined} />
          <Badge variant={transportBadge.variant} className={cn("gap-1 px-2 py-0.5 text-[10px]", transportBadge.className)}>
            <Megaphone size={14} />
            Room
          </Badge>
          {contextBadges.map((badge) => {
            const toneBadge = badgeToneProps(badge.tone);

            return (
              <Badge key={badge.id} variant={toneBadge.variant} className={cn("px-2 py-0.5 text-[10px]", toneBadge.className)}>
                {badge.label}
              </Badge>
            );
          })}
          {event.message.message.status !== "sent" ? (
            <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
              {event.message.message.status}
            </Badge>
          ) : null}
        </div>
        <span className="pt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{formatTime(event.createdAt)}</span>
      </div>
      <MessageMarkdown
        content={displayContent}
        className={cn("mt-2", !expanded && "text-muted-foreground")}
        mentionHandles={new Set(event.message.mentionedHandles)}
        quoteHandles={new Set(event.message.quotedHandles)}
        roomId={event.message.message.roomId}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="member-session-room-reply-toggle"
        className="mt-1 h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Hide room reply" : "Show room reply"}
      </Button>
    </div>
  );
}

function SessionActivityEventRow(props: {
  member: TeamMember;
  event: MemberSessionActivityEvent;
  onOpenMember?: (memberId: string) => void;
}) {
  const { member, event, onOpenMember } = props;

  if (event.type === "room-message") {
    return <SessionRoomReplyRow member={member} event={event} onOpenMember={onOpenMember} />;
  }

  if (event.type === "tool") {
    return <SessionToolEventRow event={event} />;
  }

  return <SessionInternalEventRow event={event} />;
}

function getTimelinePreview(entry: MemberSessionActivityEntry): { label: string; content: string } | undefined {
  const latestEvent = [...entry.events]
    .sort((left, right) => {
      const leftUpdatedAt = left.type === "tool" ? left.updatedAt : left.createdAt;
      const rightUpdatedAt = right.type === "tool" ? right.updatedAt : right.createdAt;
      return leftUpdatedAt.localeCompare(rightUpdatedAt);
    })
    .at(-1);
  if (!latestEvent) {
    return undefined;
  }

  if (latestEvent.type === "room-message") {
    return {
      label: "Latest room reply",
      content: latestEvent.message.message.content,
    };
  }

  if (latestEvent.type === "tool") {
    return {
      label: latestEvent.status === "completed" ? "Tool completed" : "Tool running",
      content: latestEvent.toolName,
    };
  }

  return {
    label: getInternalEventMeta(latestEvent).label,
    content: latestEvent.content,
  };
}

function SessionActivityBubble(props: {
  member: TeamMember;
  entry: MemberSessionActivityEntry;
  onOpenMember?: (memberId: string) => void;
}) {
  const { member, entry, onOpenMember } = props;
  const { icon: Icon, label, surfaceTone } = getActivityTone(entry);
  const toneBadge = badgeToneProps(surfaceTone);
  const promptPreview = getCollapsedMessageContent(entry.prompt ?? "", 900);
  const timelinePreview = getTimelinePreview(entry);
  const collapsedTimelinePreview = getCollapsedMessageContent(timelinePreview?.content ?? "", 240);
  const [showTimeline, setShowTimeline] = useState(true);
  const [showPrompt, setShowPrompt] = useState(false);
  const promptContent = showPrompt ? entry.prompt : promptPreview.preview;

  return (
    <div
      data-testid="member-session-activity"
      className={cn(
        "flex max-w-[min(100%,56rem)] shrink-0 flex-col gap-2 rounded-[1.45rem] border border-[color:var(--tone-paper-border)] px-3.5 py-2.5 text-foreground shadow-none",
        surfaceToneClass(surfaceTone),
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <MemberIdentityChip member={member} onClick={onOpenMember ? () => onOpenMember(member.id) : undefined} />
          <Badge variant={toneBadge.variant} className={cn("gap-1 px-2 py-0.5 text-[10px]", toneBadge.className)}>
            <Icon size={14} className={entry.taskStatus === "running" ? "animate-spin" : undefined} />
            {label}
          </Badge>
          <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
            {entry.taskTitle}
          </Badge>
          {entry.events.length > 0 ? <span className="text-xs text-muted-foreground">{entry.events.length} events</span> : null}
          {entry.roomReplyCount > 0 ? <span className="text-xs text-muted-foreground">{entry.roomReplyCount} room replies</span> : null}
        </div>
        <p className="m-0 pt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{formatTime(entry.updatedAt)}</p>
      </header>

      {entry.events.length > 0 || entry.prompt ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {entry.events.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              data-testid="member-session-internals-toggle"
              onClick={() => setShowTimeline((value) => !value)}
            >
              {showTimeline ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showTimeline ? "Hide task timeline" : `Show full task timeline (${entry.events.length})`}
            </Button>
          ) : null}
          {entry.prompt ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              data-testid="member-session-prompt-toggle"
              onClick={() => setShowPrompt((value) => !value)}
            >
              {showPrompt ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showPrompt ? "Hide task prompt" : "Show full task prompt"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {entry.events.length === 0 ? (
        <p className="m-0 text-sm leading-6 text-muted-foreground">
          {entry.taskStatus === "running" ? "Waiting for the first internal event." : "This task finished without a captured internal timeline."}
        </p>
      ) : null}

      {(showTimeline && entry.events.length > 0) || showPrompt ? <Separator className="bg-border/60" /> : null}

      {!showTimeline && timelinePreview ? (
        <div className={cn("rounded-[1.15rem] border border-dashed border-border/70 px-3 py-2.5", surfaceToneClass("paper"))}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
              {timelinePreview.label}
            </Badge>
            <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">preview</span>
          </div>
          <p className="m-0 mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
            {collapsedTimelinePreview.preview}
          </p>
        </div>
      ) : null}

      {showTimeline && entry.events.length > 0 ? (
        <div className="space-y-3" data-testid="member-session-internals">
          {entry.events.map((event) => (
            <SessionActivityEventRow key={event.id} member={member} event={event} onOpenMember={onOpenMember} />
          ))}
        </div>
      ) : null}

      {showPrompt && entry.prompt ? (
        <div className="space-y-2" data-testid="member-session-task-prompt">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]">
              Task prompt
            </Badge>
            {entry.promptCreatedAt ? (
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{formatTime(entry.promptCreatedAt)}</span>
            ) : null}
          </div>
          <p className="m-0 whitespace-pre-wrap break-words font-mono text-xs leading-6 text-muted-foreground">{promptContent}</p>
          {promptPreview.collapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => setShowPrompt((value) => !value)}
            >
              {showPrompt ? "Collapse task prompt" : "Show full task prompt"}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildLatestEntryMarker(entry?: MemberSessionTimelineEntry): string | undefined {
  if (!entry) {
    return undefined;
  }

  if (entry.type === "message") {
    return `${entry.id}:${entry.message.status}:${entry.message.content.length}`;
  }

  return `${entry.id}:${entry.updatedAt}:${entry.events.length}:${entry.roomReplyCount}:${entry.latestInternalEvent?.content.length ?? 0}`;
}

export function MemberSessionPane(props: {
  snapshot: WorkspaceSnapshot;
  room: Room;
  member: TeamMember;
  connected: boolean;
  error?: string;
  onSendDirectMessage?: (content: string) => void | Promise<void>;
  onOpenMember?: (memberId: string) => void;
}) {
  const { snapshot, room, member, connected, error, onSendDirectMessage, onOpenMember } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousMemberIdRef = useRef<string | undefined>(undefined);
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);
  const deferredSnapshot = useDeferredValue(snapshot);
  const deferredRoom = deferredSnapshot.rooms[room.id] ?? room;
  const deferredMember = deferredSnapshot.members[member.id] ?? member;
  const sessionEntries = useMemo(
    () => getMemberSessionTimelineEntries(deferredSnapshot, deferredRoom, deferredMember),
    [deferredMember, deferredRoom, deferredSnapshot],
  );
  const activeTask = deferredMember.activeTaskId ? deferredSnapshot.tasks[deferredMember.activeTaskId] : undefined;
  const canSendDirectMessage = typeof onSendDirectMessage === "function";
  const latestEntryMarker = buildLatestEntryMarker(sessionEntries.at(-1));
  const shouldVirtualize = sessionEntries.length > 40;
  const sessionVirtualizer = useVirtualizer({
    count: sessionEntries.length,
    getScrollElement: () => transcriptRef.current,
    estimateSize: () => 260,
    overscan: 4,
    getItemKey: (index) => sessionEntries[index]?.id ?? index,
  });
  const virtualRows = sessionVirtualizer.getVirtualItems();

  const updateScrollState = (): void => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    const bottomGap = container.scrollHeight - container.clientHeight - container.scrollTop;
    setShowScrollToLatest(bottomGap > 32);
  };

  const scrollTimelineToLatest = (behavior: ScrollBehavior = "smooth"): void => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    if (shouldVirtualize && sessionEntries.length > 0) {
      sessionVirtualizer.scrollToIndex(sessionEntries.length - 1, {
        align: "end",
        behavior,
      });
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
    setShowScrollToLatest(false);
  };

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    const memberChanged = previousMemberIdRef.current !== member.id;
    previousMemberIdRef.current = member.id;
    if (memberChanged || !showScrollToLatest) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: memberChanged ? "auto" : "smooth",
      });
    }
    window.requestAnimationFrame(updateScrollState);
  }, [latestEntryMarker, member.id, showScrollToLatest]);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-none bg-transparent py-0 ring-0 shadow-none">
      <CardContent className="flex h-full min-h-0 flex-col p-0">
        <div className="shrink-0 px-0 py-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="m-0 text-lg font-semibold tracking-tight">Member session</p>
              {activeTask ? <p className="m-0 text-sm text-muted-foreground">{activeTask.title}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeTask ? <Badge variant="outline">{activeTask.status}</Badge> : null}
              <Badge variant="secondary">{sessionEntries.length} items</Badge>
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={transcriptRef} className="h-full min-h-0 overflow-y-auto px-0 py-1" onScroll={updateScrollState}>
            <div className="flex flex-col gap-3">
              {sessionEntries.length === 0 ? (
                <Card className="border-dashed shadow-none">
                  <CardContent className="p-5">
                    <p className="m-0 text-sm text-muted-foreground">
                      还没有 session 内容。下一次这个成员接到任务或收到私聊后，这里会出现完整时间线。
                    </p>
                  </CardContent>
                </Card>
              ) : shouldVirtualize ? (
                <div
                  className="relative w-full"
                  style={{
                    height: `${sessionVirtualizer.getTotalSize()}px`,
                  }}
                >
                  {virtualRows.map((virtualRow) => {
                    const entry = sessionEntries[virtualRow.index];
                    if (!entry) {
                      return null;
                    }

                    return (
                      <div
                        key={virtualRow.key}
                        ref={sessionVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute top-0 left-0 w-full py-1"
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {entry.type === "message" ? (
                          <MessageBubble
                            message={entry.message}
                            authorMember={
                              entry.message.author.kind === "member"
                                ? deferredSnapshot.members[entry.message.author.id]
                                : undefined
                            }
                            mentionedHandles={entry.mentionedHandles}
                            quotedHandles={entry.quotedHandles}
                            recipientHandles={entry.recipientHandles}
                            handlerSummaries={entry.handlerSummaries}
                            contextBadges={entry.contextBadges}
                            onAuthorClick={
                              entry.message.author.kind === "member" && onOpenMember
                                ? () => onOpenMember(entry.message.author.id)
                                : undefined
                            }
                          />
                        ) : (
                          <SessionActivityBubble member={deferredMember} entry={entry} onOpenMember={onOpenMember} />
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                sessionEntries.map((entry) =>
                  entry.type === "message" ? (
                    <MessageBubble
                      key={entry.id}
                      message={entry.message}
                      authorMember={
                        entry.message.author.kind === "member"
                          ? deferredSnapshot.members[entry.message.author.id]
                          : undefined
                      }
                      mentionedHandles={entry.mentionedHandles}
                      quotedHandles={entry.quotedHandles}
                      recipientHandles={entry.recipientHandles}
                      handlerSummaries={entry.handlerSummaries}
                      contextBadges={entry.contextBadges}
                      onAuthorClick={
                        entry.message.author.kind === "member" && onOpenMember
                          ? () => onOpenMember(entry.message.author.id)
                          : undefined
                      }
                    />
                  ) : (
                    <SessionActivityBubble
                      key={entry.id}
                      member={deferredMember}
                      entry={entry}
                      onOpenMember={onOpenMember}
                    />
                  ),
                )
              )}
            </div>
          </div>
          {showScrollToLatest ? (
            <Button className="absolute right-0 bottom-2 shadow-lg" size="sm" type="button" onClick={() => scrollTimelineToLatest()}>
              <ArrowDown size={16} />
              Jump to latest
            </Button>
          ) : null}
        </div>

        <div className="shrink-0 px-0 py-2">
          <ChatComposer
            className="py-0"
            contentClassName="gap-2 p-0"
            textareaClassName="min-h-12"
            connected={connected && canSendDirectMessage}
            error={canSendDirectMessage ? error : "当前 session 不支持直接发消息。"}
            members={[member]}
            onSend={(content) => onSendDirectMessage?.(content)}
            sending={member.status === "running"}
            fixedDirectMemberId={member.id}
            draftKey={`member:${room.id}:${member.id}`}
          />
        </div>
      </CardContent>
    </Card>
  );
}
