import { useEffect, useRef } from "react";

import { Bot, Info, Sparkles } from "lucide-react";

import type { ChatMessage, Room, TeamMember, TeamTemplate, WorkspaceSnapshot } from "@/domain/model";
import { ChatComposer } from "@/components/chat/chat-composer";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PanelToggleButton } from "@/components/layout/panel-toggle-button";
import { MemberAvatar } from "@/components/members/member-avatar";
import { MemberHoverPreview } from "@/components/members/member-hover-preview";
import { getWatcherForMember } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useRoomChat } from "@/lib/chat/use-room-chat";
import { getUIMessageText, type WorkspaceUIMessage } from "@/lib/chat/workspace-ui-message";
import type { MessageHandlerSummary } from "@/lib/message-feed";
import { badgeToneProps, memberStatusBadgeProps } from "@/lib/ui-tone";
import { cn, summarizePrompt } from "@/lib/utils";

export function ChatPane(props: {
  leftSidebarCollapsed: boolean;
  snapshot: WorkspaceSnapshot;
  room?: Room;
  template?: TeamTemplate;
  members: TeamMember[];
  selectedMemberId?: string;
  connected: boolean;
  error?: string;
  onOpenMember: (memberId: string) => void;
  onToggleLeftSidebar: () => void;
}) {
  const {
    leftSidebarCollapsed,
    snapshot,
    room,
    template,
    members,
    selectedMemberId,
    connected,
    error,
    onOpenMember,
    onToggleLeftSidebar,
  } = props;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const previousRoomIdRef = useRef<string | undefined>(undefined);
  const roomChat = useRoomChat({
    room,
    members,
    snapshot,
  });
  const roomId = room?.id;
  const latestMessageId = roomChat.messages.at(-1)?.id;

  useEffect(() => {
    if (!roomId) {
      return;
    }

    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    const roomChanged = previousRoomIdRef.current !== roomId;
    previousRoomIdRef.current = roomId;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: roomChanged ? "auto" : "smooth",
    });
  }, [latestMessageId, roomId]);

  if (!room) {
    const readyBadge = badgeToneProps("paper");
    const membersBadge = badgeToneProps("blueprint");
    const watcherBadge = badgeToneProps("correction");

    return (
      <main className="flex min-h-screen min-w-0 flex-col gap-4 px-6 py-10">
        <ShellToolbar leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} />
        <Card className="w-full max-w-2xl border border-border shadow-sm">
          <CardContent className="flex flex-col gap-4 p-8">
            <div className="space-y-2">
              <p className="m-0 text-3xl font-semibold tracking-tight">OpenAquarium</p>
              <p className="m-0 text-base text-muted-foreground">
                左边先建一个 project。每个 project 会以首条问题命名 room，并固定一套 team template。
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Badge variant={readyBadge.variant} className={readyBadge.className}>
                ACP-ready
              </Badge>
              <Badge variant={membersBadge.variant} className={membersBadge.className}>
                Interruptible members
              </Badge>
              <Badge variant={watcherBadge.variant} className={watcherBadge.className}>
                Watcher digests
              </Badge>
            </div>
          </CardContent>
        </Card>
      </main>
    );
  }

  const templateBadge = badgeToneProps(template?.accentTone ?? "paper");
  const watcherBadge = badgeToneProps("correction");
  const neutralBadge = badgeToneProps("paper");

  return (
    <main className="flex min-h-screen min-w-0 flex-col gap-5 border-x border-border/70 bg-background/70 px-4 py-5 md:px-6">
      <ShellToolbar leftSidebarCollapsed={leftSidebarCollapsed} onToggleLeftSidebar={onToggleLeftSidebar} />
      {!connected || error ? (
        <Card className="border border-destructive/30 bg-destructive/5 shadow-sm">
          <CardContent className="flex flex-col gap-2 p-4">
            <p className="m-0 text-sm font-medium">Runtime offline</p>
            <p className="m-0 text-sm text-muted-foreground">
              当前聊天依赖本地 runtime 服务；如果它没启动，发消息、建 room、改成员配置都不会生效。
            </p>
            <p className="m-0 text-xs text-muted-foreground">现在页面里展示的是本地空工作区，不是已经连上 runtime 的真实状态。</p>
            <p className="m-0 font-mono text-xs text-muted-foreground">bun run server</p>
            {error ? <p className="m-0 text-xs text-destructive">{error}</p> : null}
          </CardContent>
        </Card>
      ) : null}
      <Card className="border border-border shadow-sm">
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <p className="m-0 text-3xl font-semibold tracking-tight">{room.name}</p>
              <p className="m-0 max-w-3xl text-sm text-muted-foreground">{room.topic}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={templateBadge.variant} className={templateBadge.className}>
                {template?.name ?? "Template"}
              </Badge>
              <Badge variant={neutralBadge.variant} className={neutralBadge.className}>
                {members.length} members
              </Badge>
              <Badge variant={watcherBadge.variant} className={watcherBadge.className}>
                {room.watcherIds.length} watchers
              </Badge>
            </div>
          </div>
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {members.map((member) => {
              const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
              const statusBadge = memberStatusBadgeProps(member.status);

              return (
                <MemberHoverPreview
                  key={member.id}
                  member={member}
                  watcher={getWatcherForMember(room, snapshot, member.id)}
                >
                  <button
                    className={cn(
                      "flex min-h-[122px] items-start gap-3 rounded-xl border border-border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/60",
                      member.id === selectedMemberId && "border-ring bg-accent/10 shadow-md",
                    )}
                    type="button"
                    onClick={() => onOpenMember(member.id)}
                  >
                    <MemberAvatar member={member} compact />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="m-0 text-base font-semibold tracking-tight">{member.name}</p>
                          {member.observeAllRoomMessages ? (
                            <span
                              className="inline-flex size-2 rounded-full bg-[color:var(--tone-blueprint-foreground)]"
                              aria-label="monitoring room"
                            />
                          ) : null}
                        </div>
                        <p className="m-0 text-sm text-muted-foreground">@{member.handle}</p>
                      </div>
                      <p className="m-0 line-clamp-2 text-sm text-muted-foreground">
                        {activeTask ? activeTask.title : member.summary}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      <Badge variant={statusBadge.variant} className={cn("px-2 py-0.5 text-[10px]", statusBadge.className)}>
                        {member.status}
                      </Badge>
                      {member.isEntryMember ? <div className="text-xs font-medium text-muted-foreground">entry</div> : null}
                    </div>
                  </button>
                </MemberHoverPreview>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <section className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <p className="m-0 text-2xl font-semibold tracking-tight">Room transcript</p>
          <div className="flex items-center gap-3">
            <p className="m-0 text-sm text-muted-foreground">
              {describeStreamingState(roomChat.activeStreamSummary)}
            </p>
            <RoomInfoPopover room={room} template={template} members={members} />
          </div>
        </div>
        <div ref={transcriptRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          {roomChat.messages.map((message) => {
            const bubble = toBubbleModel(message, room.id, snapshot.currentUserName);
            const authorMember = bubble.authorMemberId ? roomChat.activeMembersById[bubble.authorMemberId] : undefined;

            return (
              <MessageBubble
                key={bubble.message.id}
                message={bubble.message}
                authorMember={authorMember}
                mentionedHandles={bubble.mentionedHandles}
                recipientHandles={bubble.recipientHandles}
                handlerSummaries={bubble.handlerSummaries}
                onAuthorClick={authorMember ? () => onOpenMember(authorMember.id) : undefined}
              />
            );
          })}
          {roomChat.messages.length === 0 ? (
            <Card className="border border-border shadow-sm">
              <CardContent className="flex items-center gap-4 p-6">
                <Bot size={28} />
                <p className="m-0 text-sm text-muted-foreground">还没有消息。发第一句话，入口 member 会先接住。</p>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <ChatComposer
        connected={connected}
        error={error}
        members={members}
        onSend={roomChat.sendMessage}
        sending={roomChat.hasActiveStreams}
      />
    </main>
  );
}

function ShellToolbar(props: {
  leftSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
}) {
  const { leftSidebarCollapsed, onToggleLeftSidebar } = props;

  return (
    <div className="flex items-center justify-start gap-2">
      <PanelToggleButton collapsed={leftSidebarCollapsed} side="left" onToggle={onToggleLeftSidebar} />
    </div>
  );
}

function RoomInfoPopover(props: {
  room: Room;
  template?: TeamTemplate;
  members: TeamMember[];
}) {
  const { room, template, members } = props;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Info size={16} />
          Room note
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(88vw,360px)]">
        <PopoverHeader>
          <PopoverTitle className="flex items-center gap-2 text-base">
            <Sparkles size={16} />
            Room note
          </PopoverTitle>
          <PopoverDescription>
            当前 template 固定为 {template?.name ?? "Template"}。
          </PopoverDescription>
        </PopoverHeader>
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="m-0">首条问题会把 room 主题初始化为：{summarizePrompt(room.topic, 80)}。</p>
          <p className="m-0">后台 runtime 会自动驱动 {members.length} 个成员 turn；更完整的执行细节和私聊上下文放在成员 Session，群聊只显示真实发出的消息。</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function describeStreamingState(activeStreamSummary?: string): string {
  if (activeStreamSummary) {
    return activeStreamSummary;
  }

  return "成员内部推理只显示为处理状态；只有显式发送到 room 或 direct 的消息才会出现在消息流里。";
}

function inferMessageStatus(message: WorkspaceUIMessage): ChatMessage["status"] {
  const textPart = message.parts.find((part) => part.type === "text");
  if (textPart?.state === "streaming") {
    return "streaming";
  }

  return message.role === "assistant" ? "completed" : "sent";
}

function toBubbleModel(
  message: WorkspaceUIMessage,
  roomId: string,
  currentUserName: string,
  activeRoute?: {
    memberId: string;
    memberName: string;
    memberHandle: string;
  },
): {
  message: ChatMessage;
  authorMemberId?: string;
  mentionedHandles: string[];
  recipientHandles: string[];
  handlerSummaries: MessageHandlerSummary[];
} {
  const text = getUIMessageText(message);
  const status = message.metadata?.status ?? inferMessageStatus(message);
  const authorKind = message.metadata?.authorKind ?? (message.role === "user" ? "user" : "member");
  const authorId = message.metadata?.authorId ?? (message.role === "user" ? "user" : activeRoute?.memberId ?? "assistant");
  const authorLabel = message.metadata?.authorLabel ?? (message.role === "user" ? currentUserName : activeRoute?.memberName ?? "Assistant");

  return {
    message: {
      id: message.id,
      roomId,
      author: {
        kind: authorKind,
        id: authorId,
        label: authorLabel,
      },
      content: text,
      createdAt: message.metadata?.createdAt ?? new Date().toISOString(),
      transport: message.metadata?.transport ?? "group",
      status,
      mentionedMemberIds: [],
      recipientMemberIds: [],
      taskId: message.metadata?.handlerSummaries?.[0]?.taskId,
    },
    authorMemberId: message.metadata?.memberId ?? (message.role === "assistant" ? activeRoute?.memberId : undefined),
    mentionedHandles: message.metadata?.mentionedHandles ?? [],
    recipientHandles: message.metadata?.recipientHandles ?? [],
    handlerSummaries: message.metadata?.handlerSummaries ?? [],
  };
}
