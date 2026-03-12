import { memo, useMemo, useState } from "react";

import { Cpu, Lock, Megaphone, PencilLine } from "lucide-react";

import type { ChatMessage, TeamMember } from "@/domain/model";
import type { ContextBadge, MessageHandlerSummary } from "@/lib/message-feed";
import { areMessageBubblePropsEqual } from "@/components/chat/message-bubble-equality";
import { getCollapsedMessageContent } from "@/components/chat/message-content";
import { MessageMarkdown } from "@/components/chat/message-markdown";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberIdentityChip } from "@/components/members/member-identity-chip";
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
  const isCompactMember = message.author.kind === "member" && message.transport === "group";
  const usesCompactSurface = isUser || isCompactMember;
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
  const metadataBadges = (
    <>
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
    </>
  );
  const messageContent = (
    <>
      <div className={cn("space-y-1.5", usesCompactSurface && "space-y-1")}>
        <MessageMarkdown
          content={displayContent}
          className={cn(usesCompactSurface && "space-y-2.5 leading-[1.35rem]")}
          mentionHandles={highlightedHandles.mentionHandles}
          quoteHandles={highlightedHandles.quoteHandles}
          streaming={message.status === "streaming"}
        />
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
    </>
  );
  const memberCompactMessageClassName = cn(
    "flex max-w-[min(100%,56rem)] shrink-0 flex-col gap-2 rounded-[1.45rem] border border-[color:var(--tone-paper-border)] px-3.5 py-2.5 text-foreground shadow-none",
    surfaceToneClass("paper"),
  );

  if (isUser) {
    return (
      <div
        data-message-kind="user"
        data-message-surface="compact"
        className={cn(
          "ml-auto flex max-w-[min(100%,54rem)] shrink-0 flex-col gap-2 rounded-[1.6rem] border border-border/45 bg-accent/22 px-3.5 py-2.5 text-foreground shadow-none",
          surfaceToneClass("blueprint"),
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--tone-blueprint-foreground)]">
              {authorRoleLabel}
            </span>
            {metadataBadges}
          </div>
          <p className="m-0 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{formatTime(message.createdAt)}</p>
        </div>
        {messageContent}
      </div>
    );
  }

  if (isCompactMember) {
    return (
      <div data-message-kind="member" data-message-surface="compact" className={memberCompactMessageClassName}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {authorMember ? (
              <MemberIdentityChip member={authorMember} onClick={onAuthorClick} />
            ) : (
              <div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/70 px-1.5 py-1 text-left">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                  <Cpu size={18} />
                </div>
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.16em]">{authorRoleLabel}</span>
              </div>
            )}
            {authorName ? <span className="truncate text-xs text-muted-foreground">{authorName}</span> : null}
            {metadataBadges}
          </div>
          <p className="m-0 pt-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{formatTime(message.createdAt)}</p>
        </div>
        {messageContent}
      </div>
    );
  }

  return (
    <Card
      data-message-kind={isSystem ? "system" : "member"}
      data-message-surface="card"
      className={cn(
        "relative shrink-0 max-w-[min(100%,58rem)] border border-border shadow-sm",
        isSystem && cn(surfaceToneClass("paper"), "border-l-4 border-l-[color:var(--tone-blueprint-border)]"),
      )}
    >
      <CardContent className="flex flex-col gap-3 p-3.5">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {authorMember ? (
              <MemberAvatar member={authorMember} compact onClick={onAuthorClick} />
            ) : (
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-card">
                <Cpu size={18} />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                <span className="truncate" style={authorRolePalette ? { color: authorRolePalette.background } : undefined}>
                  {authorRoleLabel}
                </span>
                {authorName ? <span className="truncate text-xs text-muted-foreground">{authorName}</span> : null}
                {metadataBadges}
              </div>
              <p className="m-0 text-xs uppercase tracking-[0.18em] text-muted-foreground">{formatTime(message.createdAt)}</p>
            </div>
          </div>
        </header>
        {messageContent}
      </CardContent>
    </Card>
  );
}

export const MessageBubble = memo(MessageBubbleComponent, areMessageBubblePropsEqual);
