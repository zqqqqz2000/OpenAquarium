import { useEffect, useMemo, useRef, useState } from "react";

import { AlertCircle, ArrowDown, CheckCircle2, Compass, LoaderCircle, MessageSquareDashed, Milestone, TriangleAlert, type LucideIcon } from "lucide-react";

import type { Room, TaskTraceKind, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { getCollapsedMessageContent } from "@/components/chat/message-content";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getMemberSessionEntries, type MemberSessionTraceEntry } from "@/lib/member-session-feed";
import { badgeToneProps, surfaceToneClass } from "@/lib/ui-tone";
import { cn, formatTime } from "@/lib/utils";

function SessionTraceBadge(props: { traceKind: TaskTraceKind }) {
  const { traceKind } = props;
  const label = traceKind.replaceAll("-", " ");
  const variant: "destructive" | "secondary" | "outline" =
    traceKind === "error" ? "destructive" : traceKind === "completed" ? "secondary" : "outline";

  return <Badge variant={variant}>{label}</Badge>;
}

function getTraceTone(traceKind: TaskTraceKind): {
  icon: LucideIcon;
  surfaceTone: "paper" | "postit" | "blueprint" | "correction";
} {
  switch (traceKind) {
    case "completed":
      return {
        icon: CheckCircle2,
        surfaceTone: "blueprint",
      };
    case "error":
      return {
        icon: TriangleAlert,
        surfaceTone: "correction",
      };
    case "interrupted":
      return {
        icon: AlertCircle,
        surfaceTone: "correction",
      };
    case "status":
      return {
        icon: LoaderCircle,
        surfaceTone: "postit",
      };
    case "draft":
      return {
        icon: Milestone,
        surfaceTone: "postit",
      };
    case "task-prompt":
      return {
        icon: Compass,
        surfaceTone: "paper",
      };
    case "task-started":
      return {
        icon: MessageSquareDashed,
        surfaceTone: "paper",
      };
    default:
      return {
        icon: Compass,
        surfaceTone: "paper",
      };
  }
}

function SessionTraceBubble(props: { member: TeamMember; entry: MemberSessionTraceEntry }) {
  const { member, entry } = props;
  const { icon: Icon, surfaceTone } = getTraceTone(entry.traceKind);
  const preview = getCollapsedMessageContent(entry.content, entry.traceKind === "task-prompt" ? 900 : 1_200);
  const [expanded, setExpanded] = useState(!preview.collapsed);
  const content = expanded ? entry.content : preview.preview;
  const toneBadge = badgeToneProps(surfaceTone);

  return (
    <div className="flex shrink-0 gap-3">
      <MemberAvatar member={member} compact />
      <Card className={cn("max-w-[min(100%,58rem)] border border-border shadow-sm", surfaceToneClass(surfaceTone))}>
        <CardContent className="flex flex-col gap-3 p-4">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={toneBadge.variant} className={cn("gap-1 px-2 py-0.5 text-[10px]", toneBadge.className)}>
                  <Icon size={14} className={entry.traceKind === "status" ? "animate-spin" : undefined} />
                  Session
                </Badge>
                <SessionTraceBadge traceKind={entry.traceKind} />
                <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
                  {entry.taskTitle}
                </Badge>
              </div>
              <p className="m-0 text-sm font-medium">{entry.title}</p>
              <p className="m-0 text-xs uppercase tracking-[0.18em] text-muted-foreground">{formatTime(entry.createdAt)}</p>
            </div>
          </header>
          <div className="space-y-2">
            <p
              className={cn(
                "m-0 whitespace-pre-wrap break-words text-sm leading-6",
                entry.traceKind === "task-prompt" && "font-mono text-xs leading-6",
              )}
            >
              {content}
            </p>
            {preview.collapsed ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Collapse details" : "Show full details"}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
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
  const sessionEntries = useMemo(
    () => getMemberSessionEntries(snapshot, room, member),
    [member, room, snapshot],
  );
  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
  const canSendDirectMessage = typeof onSendDirectMessage === "function";
  const latestEntryId = sessionEntries.at(-1)?.id;
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
  }, [latestEntryId, member.id, showScrollToLatest]);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardContent className="flex h-full min-h-0 flex-col p-0">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="m-0 text-lg font-semibold tracking-tight">Member session</p>
              {activeTask ? <p className="m-0 text-sm text-muted-foreground">{activeTask.title}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeTask ? <Badge variant="outline">{activeTask.status}</Badge> : null}
              <Badge variant="secondary">{sessionEntries.length} entries</Badge>
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={transcriptRef} className="h-full min-h-0 overflow-y-auto px-4 py-4" onScroll={updateScrollState}>
            <div className="flex flex-col gap-4">
              {sessionEntries.map((entry) =>
                entry.type === "message" ? (
                  <MessageBubble
                    key={entry.id}
                    message={entry.message}
                    authorMember={entry.message.author.kind === "member" ? snapshot.members[entry.message.author.id] : undefined}
                    mentionedHandles={entry.mentionedHandles}
                    recipientHandles={entry.recipientHandles}
                    handlerSummaries={entry.handlerSummaries}
                    contextBadges={entry.contextBadges}
                    onAuthorClick={entry.message.author.kind === "member" && onOpenMember ? () => onOpenMember(entry.message.author.id) : undefined}
                  />
                ) : (
                  <SessionTraceBubble key={entry.id} member={member} entry={entry} />
                ),
              )}
              {sessionEntries.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="p-5">
                    <p className="m-0 text-sm text-muted-foreground">
                      还没有 session 内容。下一次这个成员接到任务或收到私聊后，这里会出现完整时间线。
                    </p>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
          {showScrollToLatest ? (
            <Button className="absolute right-4 bottom-4 shadow-lg" size="sm" type="button" onClick={() => scrollTimelineToLatest()}>
              <ArrowDown size={16} />
              Jump to latest
            </Button>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-border px-4 py-3">
          <ChatComposer
            className="border-none bg-transparent py-0 shadow-none ring-0"
            contentClassName="gap-2 p-0"
            textareaClassName="min-h-16"
            connected={connected && canSendDirectMessage}
            error={canSendDirectMessage ? error : "当前 session 不支持直接发消息。"}
            members={[member]}
            onSend={(content) => onSendDirectMessage?.(content)}
            sending={member.status === "running"}
            fixedDirectMemberId={member.id}
          />
        </div>
      </CardContent>
    </Card>
  );
}
