import { useMemo, useState } from "react";

import { Send, X } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MemberAvatar } from "@/components/members/member-avatar";
import { badgeToneProps } from "@/lib/ui-tone";

export function ChatComposer(props: {
  connected: boolean;
  error?: string;
  members: TeamMember[];
  onSend: (content: string, directMemberId?: string) => void | Promise<void>;
}) {
  const { connected, error, members, onSend } = props;
  const [text, setText] = useState("");
  const [directMemberId, setDirectMemberId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | undefined>();
  const directMember = useMemo(
    () => members.find((member) => member.id === directMemberId),
    [directMemberId, members],
  );
  const channelBadge = badgeToneProps(directMember ? "correction" : "blueprint");

  return (
    <Card className="border border-border shadow-sm">
      <CardContent className="flex flex-col gap-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={channelBadge.variant} className={channelBadge.className}>
            {directMember ? `DM @${directMember.handle}` : "Group message"}
          </Badge>
          {directMember ? (
            <Button size="sm" variant="secondary" onClick={() => setDirectMemberId(undefined)}>
              <X size={16} />
              Clear target
            </Button>
          ) : null}
        </div>
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
        <Textarea
          className="min-h-24"
          placeholder={directMember ? `私发给 @${directMember.handle}，发送后会打断对方当前任务。` : "在群里说点什么，或者直接 @member 指定接收者。"}
          disabled={!connected || sending}
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="m-0 text-sm text-muted-foreground">
              {connected ? "群聊里直接 `@member`，或先点头像切到私聊目标。" : "Runtime offline 时发送会被禁用；先启动 `bun run server`。"}
            </p>
            {sendError || error ? <p className="m-0 text-xs text-destructive">{sendError ?? error}</p> : null}
          </div>
          <Button
            disabled={text.trim().length === 0 || !connected || sending}
            onClick={() => {
              void (async () => {
                setSending(true);
                setSendError(undefined);
                try {
                  await onSend(text, directMemberId);
                  setText("");
                  setDirectMemberId(undefined);
                } catch (caughtError) {
                  setSendError(caughtError instanceof Error ? caughtError.message : String(caughtError));
                } finally {
                  setSending(false);
                }
              })();
            }}
          >
            <Send size={18} />
            {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
