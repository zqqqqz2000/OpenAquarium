import { memo, useState } from "react";

import { AtSign, Cpu, Lock, Megaphone, PencilLine, UserRound } from "lucide-react";

import type { ChatMessage, TeamMember } from "@/domain/model";
import type { ContextBadge, MessageHandlerSummary } from "@/lib/message-feed";
import { areMessageBubblePropsEqual } from "@/components/chat/message-bubble-equality";
import { getCollapsedMessageContent } from "@/components/chat/message-content";
import { MemberAvatar } from "@/components/members/member-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { badgeToneProps, messageStatusBadgeProps, surfaceToneClass } from "@/lib/ui-tone";
import { cn, formatTime } from "@/lib/utils";

export interface MessageBubbleProps {
  message: ChatMessage;
  authorMember?: TeamMember;
  mentionedHandles?: string[];
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
                <span className="truncate">{message.author.label}</span>
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
          <p className="m-0 whitespace-pre-wrap text-sm leading-6">{displayContent}</p>
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

        {recipientHandles.length > 0 || handlerSummaries.length > 0 || mentionedHandles.length > 0 ? (
          <div className="flex flex-col gap-2">
            {recipientHandles.length > 0 ? (
              <footer className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">To</span>
                {recipientHandles.map((handle) => (
                  <Badge key={`recipient-${handle}`} variant="secondary" className="px-2 py-0.5 text-[10px]">
                    @{handle}
                  </Badge>
                ))}
              </footer>
            ) : null}

            {handlerSummaries.length > 0 ? (
              <footer className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-[0.7rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">Handled by</span>
                {handlerSummaries.map((handler) => {
                  const handlerBadge = badgeToneProps("blueprint");

                  return (
                    <Badge
                      key={handler.taskId}
                      variant={handlerBadge.variant}
                      className={cn("gap-1 px-2 py-0.5 text-[10px]", handlerBadge.className)}
                      title={handler.title}
                    >
                      @{handler.handle}
                    </Badge>
                  );
                })}
              </footer>
            ) : null}

            {mentionedHandles.length > 0 ? (
              <footer className="flex flex-wrap items-center gap-2 text-sm">
                <AtSign size={14} />
                {mentionedHandles.map((handle) => (
                  <Badge
                    key={`mention-${handle}`}
                    variant="outline"
                    className="border-[color:var(--tone-postit-border)] bg-[var(--tone-postit-badge)] px-2 py-0.5 text-[10px] text-[var(--tone-postit-foreground)]"
                  >
                    @{handle}
                  </Badge>
                ))}
              </footer>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export const MessageBubble = memo(MessageBubbleComponent, areMessageBubblePropsEqual);
