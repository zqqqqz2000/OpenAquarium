import { useEffect, useMemo, useRef, useState } from "react";

import { Send, X } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MemberAvatar } from "@/components/members/member-avatar";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

export function ChatComposer(props: {
  className?: string;
  connected: boolean;
  error?: string;
  members: TeamMember[];
  onSend: (content: string, directMemberId?: string) => void | Promise<void>;
  sending?: boolean;
  fixedDirectMemberId?: string;
  preferredDirectMemberId?: string;
  focusSignal?: number;
}) {
  const { className, connected, error, members, onSend, sending = false, fixedDirectMemberId, preferredDirectMemberId, focusSignal } = props;
  const [text, setText] = useState("");
  const [directMemberId, setDirectMemberId] = useState<string | undefined>(fixedDirectMemberId);
  const [sendError, setSendError] = useState<string | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resolvedDirectMemberId = fixedDirectMemberId ?? directMemberId;
  const directMember = useMemo(
    () => members.find((member) => member.id === resolvedDirectMemberId),
    [members, resolvedDirectMemberId],
  );
  const channelBadge = badgeToneProps(directMember ? "correction" : "blueprint");
  const allowTargetSelection = fixedDirectMemberId === undefined;

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

  return (
    <Card className={cn("border border-border shadow-sm", className)}>
      <CardContent className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={channelBadge.variant} className={channelBadge.className}>
            {directMember ? `DM @${directMember.handle}` : "Group message"}
          </Badge>
          {allowTargetSelection && directMember ? (
            <Button size="sm" variant="secondary" onClick={() => setDirectMemberId(undefined)}>
              <X size={16} />
              Clear target
            </Button>
          ) : null}
        </div>
        {allowTargetSelection ? (
          <div className="space-y-2">
            <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Quick direct targets</p>
            <div className="flex flex-wrap gap-3">
            {members.map((member) => (
              <MemberAvatar
                key={member.id}
                member={member}
                compact
                active={member.id === directMemberId}
                onClick={() => setDirectMemberId((current) => (current === member.id ? undefined : member.id))}
              />
            ))}
            </div>
          </div>
        ) : null}
        <Textarea
          ref={textareaRef}
          className="min-h-24"
          placeholder={directMember ? `私发给 @${directMember.handle}，发送后会打断对方当前任务。` : "在群里说点什么，或者直接 @member 指定接收者。"}
          disabled={!connected}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="m-0 text-sm text-muted-foreground">
              {connected
                ? sending
                  ? "当前仍有 member 在流式处理中；继续发送会按路由复用或打断对应 member 的当前流。"
                  : allowTargetSelection
                    ? "群聊里直接 `@member`，或先点头像切到私聊目标。"
                    : `这是和 @${directMember?.handle ?? "member"} 的一对一会话；发送后会直接进入对方的 direct inbox。`
                : "Runtime offline 时发送会被禁用；先启动 `bun run server`。"}
            </p>
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
