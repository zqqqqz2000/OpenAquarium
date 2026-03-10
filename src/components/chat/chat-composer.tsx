import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowUp, Plus, X } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

export function ChatComposer(props: {
  className?: string;
  contentClassName?: string;
  textareaClassName?: string;
  connected: boolean;
  error?: string;
  members: TeamMember[];
  onSend: (content: string, directMemberId?: string) => void | Promise<void>;
  sending?: boolean;
  fixedDirectMemberId?: string;
  preferredDirectMemberId?: string;
  focusSignal?: number;
}) {
  const {
    className,
    contentClassName,
    textareaClassName,
    connected,
    error,
    members,
    onSend,
    sending = false,
    fixedDirectMemberId,
    preferredDirectMemberId,
    focusSignal,
  } = props;
  const [text, setText] = useState("");
  const [directMemberId, setDirectMemberId] = useState<string | undefined>(fixedDirectMemberId);
  const [sendError, setSendError] = useState<string | undefined>();
  const [caretPosition, setCaretPosition] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | undefined>();
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resolvedDirectMemberId = fixedDirectMemberId ?? directMemberId;
  const directMember = useMemo(
    () => members.find((member) => member.id === resolvedDirectMemberId),
    [members, resolvedDirectMemberId],
  );
  const mentionMatch = useMemo(() => resolveMentionMatch(text, caretPosition, members), [caretPosition, members, text]);
  const channelBadge = badgeToneProps(directMember ? "correction" : "blueprint");
  const allowTargetSelection = fixedDirectMemberId === undefined;
  const visibleMentionMatch = mentionMatch?.key === dismissedMentionKey ? undefined : mentionMatch;

  useEffect(() => {
    setDirectMemberId(fixedDirectMemberId);
  }, [fixedDirectMemberId]);

  useEffect(() => {
    if (fixedDirectMemberId !== undefined || preferredDirectMemberId === undefined) {
      return;
    }

    setDirectMemberId(preferredDirectMemberId);
  }, [fixedDirectMemberId, focusSignal, preferredDirectMemberId]);

  useEffect(() => {
    if (focusSignal === undefined) {
      return;
    }

    textareaRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [visibleMentionMatch?.key]);

  const applyMention = (member: TeamMember): void => {
    if (!visibleMentionMatch) {
      return;
    }

    const trailingText = text.slice(visibleMentionMatch.end);
    const needsSpace = trailingText.length === 0 || !trailingText.startsWith(" ");
    const insertedMention = `@${member.handle}${needsSpace ? " " : ""}`;
    const nextText = `${text.slice(0, visibleMentionMatch.start)}${insertedMention}${trailingText}`;
    const nextCaretPosition = visibleMentionMatch.start + insertedMention.length;

    setText(nextText);
    setCaretPosition(nextCaretPosition);
    setDismissedMentionKey(undefined);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  };

  const submitLabel = sending ? "Send anyway" : "Send";
  const submitMessage = (): void => {
    const nextText = text;
    const nextDirectMemberId = resolvedDirectMemberId;
    setText("");
    if (allowTargetSelection) {
      setDirectMemberId(undefined);
    }
    setSendError(undefined);
    void Promise.resolve(onSend(nextText, nextDirectMemberId)).catch((caughtError) => {
      setText(nextText);
      if (allowTargetSelection) {
        setDirectMemberId(nextDirectMemberId);
      }
      setSendError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    });
  };

  return (
    <div className={cn("overflow-visible rounded-[1.75rem] border border-border/70 bg-card/95 shadow-sm", className)}>
      <div className={cn("flex flex-col gap-2 p-3 md:p-3.5", contentClassName)}>
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            className={cn(
              "min-h-20 resize-none border-0 bg-transparent px-0 py-0 text-[1.05rem] leading-7 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0",
              textareaClassName,
            )}
            placeholder={directMember ? `私发给 @${directMember.handle}，发送后会打断对方当前任务。` : "在群里说点什么。输入 @ 可提及成员。"}
            disabled={!connected}
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
              setDismissedMentionKey(undefined);
            }}
            onClick={(event) => {
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onKeyUp={(event) => {
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onSelect={(event) => {
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onKeyDown={(event) => {
              if (!visibleMentionMatch || visibleMentionMatch.matches.length === 0) {
                return;
              }

              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveMentionIndex((current) => (current + 1) % visibleMentionMatch.matches.length);
                return;
              }

              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveMentionIndex((current) => (current - 1 + visibleMentionMatch.matches.length) % visibleMentionMatch.matches.length);
                return;
              }

              if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                event.preventDefault();
                const selectedMember = visibleMentionMatch.matches[activeMentionIndex];

                if (selectedMember) {
                  applyMention(selectedMember);
                }
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                setDismissedMentionKey(visibleMentionMatch.key);
              }
            }}
          />
          {visibleMentionMatch && visibleMentionMatch.matches.length > 0 ? (
            <div className="rounded-2xl border border-border/70 bg-background/95 p-2 shadow-lg">
              <p className="m-0 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Mention member</p>
              <div className="flex flex-col gap-1">
                {visibleMentionMatch.matches.map((member, index) => (
                  <button
                    key={member.id}
                    type="button"
                    className={cn(
                      "flex items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70",
                      index === activeMentionIndex && "bg-accent text-accent-foreground",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(member);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">@{member.handle}</span>
                      <span className="block truncate text-xs text-muted-foreground">{member.name}</span>
                    </span>
                    {member.isEntryMember ? <Badge variant="outline">Entry</Badge> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
              <Plus size={16} />
            </span>
            {directMember ? (
              <Badge variant={channelBadge.variant} className={cn("h-7 rounded-full px-2.5 text-[0.78rem]", channelBadge.className)}>
                {`DM @${directMember.handle}`}
              </Badge>
            ) : (
              <span className="truncate text-sm text-muted-foreground">Room chat</span>
            )}
            {sendError || error ? <p className="m-0 truncate text-xs text-destructive">{sendError ?? error}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {allowTargetSelection && directMember ? (
              <Button
                aria-label="Clear target"
                className="rounded-full border-border/70 text-muted-foreground"
                size="icon-sm"
                type="button"
                variant="outline"
                onClick={() => setDirectMemberId(undefined)}
              >
                <X size={16} />
              </Button>
            ) : null}
            <Button
              aria-label={submitLabel}
              className="size-10 rounded-full bg-foreground/45 text-background hover:bg-foreground/60 disabled:bg-muted disabled:text-muted-foreground"
              disabled={text.trim().length === 0 || !connected}
              size="icon"
              type="button"
              onClick={submitMessage}
            >
              <ArrowUp size={20} />
              <span className="sr-only">{submitLabel}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MentionMatch {
  key: string;
  start: number;
  end: number;
  matches: TeamMember[];
}

function resolveMentionMatch(text: string, caretPosition: number, members: TeamMember[]): MentionMatch | undefined {
  const textBeforeCaret = text.slice(0, caretPosition);
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(textBeforeCaret);

  if (!match) {
    return undefined;
  }

  const matchedText = match[0];
  const query = match[1]?.toLowerCase() ?? "";
  const mentionStart = (match.index ?? 0) + matchedText.lastIndexOf("@");
  const matches = members.filter((member) => {
    const handle = member.handle.toLowerCase();
    const name = member.name.toLowerCase();

    return query.length === 0 || handle.includes(query) || name.includes(query);
  });

  if (matches.length === 0) {
    return undefined;
  }

  return {
    key: `${mentionStart}:${caretPosition}:${query}`,
    start: mentionStart,
    end: caretPosition,
    matches,
  };
}
