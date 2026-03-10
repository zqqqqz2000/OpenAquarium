import { Fragment, memo, useMemo, useState } from "react";

import { Cpu, Lock, Megaphone, PencilLine, UserRound } from "lucide-react";

import type { ChatMessage, TeamMember } from "@/domain/model";
import type { ContextBadge, MessageHandlerSummary } from "@/lib/message-feed";
import { areMessageBubblePropsEqual } from "@/components/chat/message-bubble-equality";
import { getCollapsedMessageContent } from "@/components/chat/message-content";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMemberRoleLabel, getMemberRolePalette } from "@/lib/member-display";
import { badgeToneProps, messageStatusBadgeProps, surfaceToneClass } from "@/lib/ui-tone";
import { cn, formatTime } from "@/lib/utils";

export interface MessageBubbleProps {
  message: ChatMessage;
  authorMember?: TeamMember;
  mentionedHandles?: string[];
  quotedHandles?: string[];
  recipientHandles?: string[];
  handlerSummaries?: MessageHandlerSummary[];
  contextBadges?: ContextBadge[];
  onAuthorClick?: () => void;
}

function MessageBubbleComponent(props: MessageBubbleProps) {
  const {
    message,
    authorMember,
    mentionedHandles = [],
    quotedHandles = [],
    recipientHandles = [],
    handlerSummaries = [],
    contextBadges = [],
    onAuthorClick,
  } = props;
  const isSystem = message.author.kind === "system";
  const isUser = message.author.kind === "user";
  const transportLabel =
    message.transport === "direct" ? "Direct" : message.transport === "watch-digest" ? "Watcher" : "Room";
  const transportIcon =
    message.transport === "direct" ? <Lock size={14} /> : message.transport === "watch-digest" ? <PencilLine size={14} /> : <Megaphone size={14} />;
  const transportBadge =
    message.transport === "watch-digest"
      ? badgeToneProps("correction")
      : badgeToneProps("paper");
  const statusBadge = messageStatusBadgeProps(message.status);
  const initialPreview = getCollapsedMessageContent(message.content);
  const [expanded, setExpanded] = useState(!initialPreview.collapsed);
  const displayContent = expanded ? message.content : initialPreview.preview;
  const showExpandToggle = initialPreview.collapsed;
  const authorRoleLabel = authorMember ? getMemberRoleLabel(authorMember.handle) : message.author.label;
  const authorName = authorMember?.name;
  const authorRolePalette = authorMember ? getMemberRolePalette(authorMember.handle) : undefined;
  const highlightedHandles = useMemo(
    () => ({
      mentionHandles: new Set([
        ...mentionedHandles,
        ...recipientHandles.filter((handle) => handle !== message.author.label),
        ...handlerSummaries.map((handler) => handler.handle),
      ]),
      quoteHandles: new Set(quotedHandles),
    }),
    [handlerSummaries, mentionedHandles, message.author.label, quotedHandles, recipientHandles],
  );

  return (
    <Card
      className={cn(
        "relative shrink-0 max-w-[min(100%,58rem)] border border-border shadow-sm",
        isUser && cn("ml-auto", surfaceToneClass("blueprint")),
        isSystem && cn(surfaceToneClass("paper"), "border-l-4 border-l-[color:var(--tone-blueprint-border)]"),
      )}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {authorMember ? (
              <MemberAvatar member={authorMember} compact onClick={onAuthorClick} />
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                {isUser ? <UserRound size={18} /> : <Cpu size={18} />}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate" style={authorRolePalette ? { color: authorRolePalette.background } : undefined}>
                  {authorRoleLabel}
                </span>
                {authorName ? <span className="truncate text-xs text-muted-foreground">{authorName}</span> : null}
                <Badge variant={transportBadge.variant} className={cn("gap-1 px-2 py-0.5 text-[10px]", transportBadge.className)}>
                  {transportIcon}
                  {transportLabel}
                </Badge>
                {contextBadges.map((badge) => {
                  const toneBadge = badgeToneProps(badge.tone);

                  return (
                    <Badge key={badge.id} variant={toneBadge.variant} className={cn("px-2 py-0.5 text-[10px]", toneBadge.className)}>
                      {badge.label}
                    </Badge>
                  );
                })}
                {message.status !== "sent" ? (
                  <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
                    {message.status}
                  </Badge>
                ) : null}
              </div>
              <p className="m-0 text-xs uppercase tracking-[0.18em] text-muted-foreground">{formatTime(message.createdAt)}</p>
            </div>
          </div>
        </header>
        <div className="space-y-2">
          <p className="m-0 whitespace-pre-wrap text-sm leading-6">{renderHighlightedMessage(displayContent, highlightedHandles)}</p>
          {showExpandToggle ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Collapse message" : "Show full message"}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export const MessageBubble = memo(MessageBubbleComponent, areMessageBubblePropsEqual);

function renderHighlightedMessage(
  content: string,
  handles: {
    mentionHandles: ReadonlySet<string>;
    quoteHandles: ReadonlySet<string>;
  },
) {
  return content.split(/(@[\p{L}\p{N}_-]+|"[\p{L}\p{N}_-]+)/gu).map((segment, index) => {
    const mentionMatch = /^@([\p{L}\p{N}_-]+)$/u.exec(segment);
    if (mentionMatch && handles.mentionHandles.has(mentionMatch[1] ?? "")) {
      return (
        <span
          key={`${segment}-${index}`}
          className="rounded-md bg-[var(--tone-postit-badge)] px-1 py-0.5 text-[var(--tone-postit-foreground)]"
        >
          {segment}
        </span>
      );
    }

    const quoteMatch = /^"([\p{L}\p{N}_-]+)$/u.exec(segment);
    if (quoteMatch && handles.quoteHandles.has(quoteMatch[1] ?? "")) {
      return (
        <span
          key={`${segment}-${index}`}
          className="rounded-md bg-[var(--tone-paper-badge)] px-1 py-0.5 text-[var(--tone-paper-foreground)]"
        >
          {segment}
        </span>
      );
    }

    return <Fragment key={`${segment}-${index}`}>{segment}</Fragment>;
  });
}
