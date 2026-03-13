import type { UIMessage } from "ai";

import type { ChatMessage, Room, WorkspaceSnapshot } from "@/domain/model";
import type { JsonValue } from "@/lib/json";
import { isVisibleMainRoomMessage } from "@/lib/message-visibility";
import { resolveRoomVisibleMemberIdSet } from "@/lib/room-message-preferences";
import {
  getMessageHandlers,
  getMessageMentionHandles,
  getMessageQuotedHandles,
  getMessageRecipientHandles,
  type MessageHandlerSummary,
} from "@/lib/message-feed";

export interface WorkspaceMessageMetadata {
  roomId: string;
  domainMessageId?: string;
  authorKind: ChatMessage["author"]["kind"];
  authorId: string;
  authorLabel: string;
  memberId?: string;
  createdAt?: string;
  transport?: ChatMessage["transport"];
  status?: ChatMessage["status"];
  mentionedHandles?: string[];
  quotedHandles?: string[];
  recipientHandles?: string[];
  handlerSummaries?: MessageHandlerSummary[];
}

export interface WorkspaceMessageDataParts extends Record<string, JsonValue | object> {
  taskRoute: {
    taskId: string;
    memberId: string;
    memberName: string;
    memberHandle: string;
  };
  taskStatus: {
    taskId: string;
    memberId: string;
    summary: string;
  };
  taskSettled: {
    taskId: string;
    memberId: string;
  };
  notification: {
    level: "info" | "error";
    message: string;
  };
}

export type WorkspaceUIMessage = UIMessage<WorkspaceMessageMetadata, WorkspaceMessageDataParts>;

function mapDomainMessageRole(message: ChatMessage): WorkspaceUIMessage["role"] {
  if (message.author.kind === "user") {
    return "user";
  }

  if (message.author.kind === "system") {
    return "system";
  }

  return "assistant";
}

export function mapDomainMessageToUIMessage(snapshot: WorkspaceSnapshot, room: Room, message: ChatMessage): WorkspaceUIMessage {
  const handlerSummaries =
    message.author.kind === "user" || message.transport === "watch-digest"
      ? getMessageHandlers(snapshot, message)
      : [];

  return {
    id: message.id,
    role: mapDomainMessageRole(message),
    metadata: {
      roomId: room.id,
      domainMessageId: message.id,
      authorKind: message.author.kind,
      authorId: message.author.id,
      authorLabel: message.author.label,
      memberId: message.author.kind === "member" ? message.author.id : undefined,
      createdAt: message.createdAt,
      transport: message.transport,
      status: message.status,
      mentionedHandles: getMessageMentionHandles(snapshot, message),
      quotedHandles: getMessageQuotedHandles(snapshot, message),
      recipientHandles: getMessageRecipientHandles(snapshot, room, message),
      handlerSummaries,
    },
    parts: [
      {
        type: "text",
        text: message.content,
        state: message.status === "streaming" ? "streaming" : "done",
      },
    ],
  };
}

export function mapRoomMessagesToUIMessages(snapshot: WorkspaceSnapshot, room: Room): WorkspaceUIMessage[] {
  const template = snapshot.templates[room.templateId];
  const visibleMemberIds = resolveRoomVisibleMemberIdSet(snapshot, room, template);

  return (snapshot.messageOrderByRoom[room.id] ?? [])
    .map((messageId) => snapshot.messages[messageId])
    .filter((message): message is ChatMessage => Boolean(message) && isVisibleMainRoomMessage(message, visibleMemberIds))
    .map((message) => mapDomainMessageToUIMessage(snapshot, room, message));
}

export function getUIMessageText(message: WorkspaceUIMessage): string {
  return message.parts
    .filter((part): part is Extract<WorkspaceUIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function extractLastUserText(messages: WorkspaceUIMessage[]): string {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  return lastUserMessage ? getUIMessageText(lastUserMessage).trim() : "";
}

export function areWorkspaceUIMessagesEqual(left: WorkspaceUIMessage[], right: WorkspaceUIMessage[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) => {
    const other = right[index];
    if (!other) {
      return false;
    }

    return (
      message.id === other.id &&
      message.role === other.role &&
      getUIMessageText(message) === getUIMessageText(other) &&
      message.metadata?.status === other.metadata?.status &&
      message.metadata?.authorId === other.metadata?.authorId
    );
  });
}
