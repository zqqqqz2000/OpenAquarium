import { useEffect, useMemo, useRef, useState } from "react";

import { Send, X } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  return (
    <Card className={cn("border border-border shadow-sm", className)}>
      <CardContent className={cn("flex flex-col gap-3 p-4 md:p-5", contentClassName)}>
        {directMember ? (
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={channelBadge.variant} className={channelBadge.className}>
              {`DM @${directMember.handle}`}
            </Badge>
            {allowTargetSelection ? (
              <Button size="sm" variant="secondary" onClick={() => setDirectMemberId(undefined)}>
                <X size={16} />
                Clear target
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            className={cn("min-h-24", textareaClassName)}
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
            <div className="rounded-xl border border-border bg-card p-2 shadow-sm">
              <p className="m-0 px-2 pb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Mention member</p>
              <div className="flex flex-col gap-1">
                {visibleMentionMatch.matches.map((member, index) => (
                  <button
                    key={member.id}
                    type="button"
                    className={cn(
                      "flex items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/70",
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
        <div className="flex items-center justify-between gap-3">
          <div className="min-h-4">
            {sendError || error ? <p className="m-0 text-xs text-destructive">{sendError ?? error}</p> : null}
          </div>
          <Button
            disabled={text.trim().length === 0 || !connected}
            onClick={() => {
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
            }}
          >
            <Send size={18} />
            {sending ? "Send anyway" : "Send"}
          </Button>
        </div>
      </CardContent>
    </Card>
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
