import * as Popover from "@radix-ui/react-popover";

import { Bot, Info, Sparkles } from "lucide-react";

import type { Room, TeamMember, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { MemberAvatar } from "@/components/members/member-avatar";
import { summarizePrompt, tilt, wobbly } from "@/lib/utils";
import { getWatcherForMember } from "@/components/members/member-utils";
import { getMessageHandlers, getMessageMentionHandles, getMessageRecipientHandles } from "@/lib/message-feed";

export function ChatPane(props: {
  snapshot: WorkspaceSnapshot;
  room?: Room;
  template?: TeamTemplate;
  members: TeamMember[];
  selectedMemberId?: string;
  onOpenMember: (memberId: string) => void;
  onSend: (content: string, directMemberId?: string) => void | Promise<void>;
}) {
  const { snapshot, room, template, members, selectedMemberId, onOpenMember, onSend } = props;

  if (!room) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <Card className="max-w-2xl p-8" tone="paper">
          <p className="mt-0 text-3xl font-semibold tracking-tight">OpenAquarium</p>
          <p className="mb-6 text-lg text-[var(--muted-foreground)]">
            左边先建一个 project。每个 project 会以首条问题命名 room，并固定一套 team template。
          </p>
          <div className="flex flex-wrap gap-3">
            <Badge tone="paper">ACP-ready</Badge>
            <Badge tone="blueprint">Interruptible members</Badge>
            <Badge tone="correction">Watcher digests</Badge>
          </div>
        </Card>
      </main>
    );
  }

  const messages = (snapshot.messageOrderByRoom[room.id] ?? []).map((messageId) => snapshot.messages[messageId]);

  return (
    <main className="flex min-h-screen flex-col gap-5 border-x border-[var(--border)] bg-white/40 px-4 py-5 md:px-6">
      <Card className="flex flex-col gap-4 p-5" tone={template?.accentTone ?? "paper"}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mt-0 text-3xl font-semibold tracking-tight">{room.name}</p>
            <p className="m-0 max-w-3xl text-base text-[var(--muted-foreground)]">{room.topic}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="postit">{template?.name ?? "Template"}</Badge>
            <Badge tone="blueprint">{members.length} members</Badge>
            <Badge tone="correction">{room.watcherIds.length} watchers</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {members.map((member) => {
            const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;

            return (
              <MemberHoverPreview
                key={member.id}
                member={member}
                watcher={getWatcherForMember(room, snapshot, member.id)}
              >
                <button
                    className="paper-card surface-interactive flex min-w-[210px] flex-1 items-center gap-3 px-3 py-2 text-left"
                    style={{
                      ...wobbly.listItem,
                      ...(member.id === selectedMemberId ? tilt.active : tilt.positive),
                      background: member.id === selectedMemberId ? "var(--secondary)" : "var(--white)",
                    }}
                    type="button"
                    onClick={() => onOpenMember(member.id)}
                >
                  <MemberAvatar member={member} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-lg">{member.name}</p>
                    <p className="m-0 truncate text-sm opacity-65">
                      {activeTask ? activeTask.title : "Standing by"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-right">
                    <Badge
                      tone={member.status === "idle" ? "paper" : member.status === "running" ? "blueprint" : "correction"}
                      className="px-2 py-0.5 text-[10px]"
                    >
                      {member.status}
                    </Badge>
                    <div className="text-sm opacity-65">@{member.handle}</div>
                  </div>
                </button>
              </MemberHoverPreview>
            );
          })}
        </div>
      </Card>

      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="m-0 text-2xl font-semibold tracking-tight">Room transcript</p>
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm text-[var(--muted-foreground)]">中途 draft 会保留在消息流里，不会被打断后抹掉。</p>
            <RoomInfoPopover room={room} template={template} members={members} />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {messages.map((message) => {
            const authorMember = members.find((member) => member.id === message.author.id);

            return (
              <MessageBubble
                key={message.id}
                message={message}
                authorMember={authorMember}
                mentionedHandles={getMessageMentionHandles(snapshot, message)}
                recipientHandles={getMessageRecipientHandles(snapshot, room, message)}
                handlerSummaries={getMessageHandlers(snapshot, message)}
                onAuthorClick={authorMember ? () => onOpenMember(authorMember.id) : undefined}
              />
            );
          })}
          {messages.length === 0 ? (
            <Card className="flex items-center gap-4 p-6" tone="paper">
              <Bot size={28} />
              <p className="m-0 text-xl">还没有消息。发第一句话，入口 member 会先接住。</p>
            </Card>
          ) : null}
        </div>
      </section>

      <ChatComposer members={members} onSend={onSend} />
    </main>
  );
}

function RoomInfoPopover(props: {
  room: Room;
  template?: TeamTemplate;
  members: TeamMember[];
}) {
  const { room, template, members } = props;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="rough-button inline-flex min-h-11 items-center gap-2 px-3 py-2 text-base"
          style={wobbly.sm}
          type="button"
        >
          <Info size={16} />
          Room note
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="z-50 w-[min(88vw,360px)]" side="bottom" sideOffset={12}>
          <Card className="flex flex-col gap-3 p-4 text-sm" tone="paper">
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <p className="m-0 text-lg font-semibold">Room note</p>
            </div>
            <p className="m-0">当前 template 固定为 {template?.name ?? "Template"}。</p>
            <p className="m-0">首条问题会把 room 主题初始化为：{summarizePrompt(room.topic, 80)}。</p>
            <p className="m-0">后台 runtime 会自动驱动 {members.length} 个成员 turn，并保留被打断前的 draft。</p>
          </Card>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
