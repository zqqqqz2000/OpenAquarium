import { AtSign, Cpu, Lock, Megaphone, PencilLine, UserRound } from "lucide-react";

import type { ChatMessage, TeamMember } from "@/domain/model";
import type { ContextBadge, MessageHandlerSummary } from "@/lib/message-feed";
import { Badge } from "@/components/ui/badge";
import { MemberAvatar } from "@/components/members/member-avatar";
import { cn, formatTime, wobbly } from "@/lib/utils";

export function MessageBubble(props: {
  message: ChatMessage;
  authorMember?: TeamMember;
  mentionedHandles?: string[];
  recipientHandles?: string[];
  handlerSummaries?: MessageHandlerSummary[];
  contextBadges?: ContextBadge[];
  onAuthorClick?: () => void;
}) {
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
  const cardToneClass = isUser
    ? "bg-[var(--postit)] ml-auto"
    : isSystem
      ? "bg-[color-mix(in_srgb,var(--blue)_12%,white)]"
      : "bg-white";
  const statusBadgeTone = message.status === "interrupted" ? "correction" : "blueprint";

  return (
    <article
      className={cn("paper-card relative flex max-w-[min(100%,58rem)] flex-col gap-3 p-4", cardToneClass)}
      style={wobbly.bubble}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {authorMember ? (
            <MemberAvatar member={authorMember} compact onClick={onAuthorClick} />
          ) : (
            <div
              className="rough-frame flex h-12 w-12 shrink-0 items-center justify-center bg-white"
              style={wobbly.sm}
            >
              {isUser ? <UserRound size={18} /> : <Cpu size={18} />}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-lg">
              <span className="truncate">{message.author.label}</span>
              <Badge tone={message.transport === "watch-digest" ? "correction" : "paper"} className="gap-1 px-2 py-0.5 text-[10px]">
                {transportIcon}
                {transportLabel}
              </Badge>
              {contextBadges.map((badge) => (
                <Badge key={badge.id} tone={badge.tone} className="px-2 py-0.5 text-[10px]">
                  {badge.label}
                </Badge>
              ))}
              {message.status !== "sent" ? (
                <Badge tone={statusBadgeTone} className="px-2 py-0.5 text-[10px]">
                  {message.status}
                </Badge>
              ) : null}
            </div>
            <p className="m-0 text-sm uppercase tracking-[0.18em] opacity-50">{formatTime(message.createdAt)}</p>
          </div>
        </div>
      </header>
      <p className="m-0 whitespace-pre-wrap text-[1.15rem] leading-7">{message.content}</p>

      {(recipientHandles.length > 0 || handlerSummaries.length > 0 || mentionedHandles.length > 0) ? (
        <div className="flex flex-col gap-2">
          {recipientHandles.length > 0 ? (
            <footer className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[0.85rem] uppercase tracking-[0.16em] opacity-55">To</span>
              {recipientHandles.map((handle) => (
                <Badge key={`recipient-${handle}`} tone="paper" className="px-2 py-0.5 text-[10px]">
                  @{handle}
                </Badge>
              ))}
            </footer>
          ) : null}

          {handlerSummaries.length > 0 ? (
            <footer className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-[0.85rem] uppercase tracking-[0.16em] opacity-55">Handled by</span>
              {handlerSummaries.map((handler) => (
                <Badge
                  key={handler.taskId}
                  tone={handler.status === "completed" ? "blueprint" : handler.status === "interrupted" ? "correction" : "postit"}
                  className="gap-1 px-2 py-0.5 text-[10px]"
                  title={handler.title}
                >
                  @{handler.handle}
                  <span className="opacity-70">{handler.status}</span>
                </Badge>
              ))}
            </footer>
          ) : null}

          {mentionedHandles.length > 0 ? (
            <footer className="flex flex-wrap items-center gap-2 text-sm">
              <AtSign size={14} />
              {mentionedHandles.map((handle) => (
                <Badge key={`mention-${handle}`} tone="postit" className="px-2 py-0.5 text-[10px]">
                  @{handle}
                </Badge>
              ))}
            </footer>
          ) : null}
        </div>
      ) : null}
      {isSystem ? <div className="pointer-events-none absolute -right-2 -top-2 h-5 w-5 rounded-full border-[3px] border-[var(--ink)] bg-[var(--accent)]" /> : null}
    </article>
  );
}
