import type { ChatMessage, MessageId, WatchSubscription } from "@/domain/model";

function normalizeVisibleRoomMessageId(
  roomMessageIds: readonly MessageId[],
  messageId?: MessageId,
): MessageId | undefined {
  if (messageId === undefined) {
    return undefined;
  }

  return roomMessageIds.includes(messageId)
    ? messageId
    : roomMessageIds[roomMessageIds.length - 1];
}

function normalizePendingDigestMessageId(
  messages: Record<MessageId, ChatMessage>,
  watcher: Pick<WatchSubscription, "roomId">,
  messageId?: MessageId,
): MessageId | undefined {
  if (messageId === undefined) {
    return undefined;
  }

  const message = messages[messageId];
  return message?.roomId === watcher.roomId && message.transport === "watch-digest"
    ? messageId
    : undefined;
}

function pickLaterVisibleRoomMessageId(
  roomMessageIds: readonly MessageId[],
  currentMessageId?: MessageId,
  pendingMessageId?: MessageId,
): MessageId | undefined {
  if (pendingMessageId === undefined) {
    return currentMessageId;
  }
  if (currentMessageId === undefined) {
    return pendingMessageId;
  }

  return roomMessageIds.indexOf(pendingMessageId) >= roomMessageIds.indexOf(currentMessageId)
    ? pendingMessageId
    : currentMessageId;
}

function pickLaterTimestamp(currentTimestamp?: string, pendingTimestamp?: string): string | undefined {
  if (pendingTimestamp === undefined) {
    return currentTimestamp;
  }
  if (currentTimestamp === undefined) {
    return pendingTimestamp;
  }

  return pendingTimestamp.localeCompare(currentTimestamp) >= 0
    ? pendingTimestamp
    : currentTimestamp;
}

export function normalizeWatcherCursorState(
  watcher: WatchSubscription,
  roomMessageIds: readonly MessageId[],
  messages: Record<MessageId, ChatMessage>,
): WatchSubscription {
  const normalizedLastConsumedMessageId = normalizeVisibleRoomMessageId(
    roomMessageIds,
    watcher.lastConsumedMessageId,
  );
  const normalizedPendingConsumedMessageId = normalizeVisibleRoomMessageId(
    roomMessageIds,
    watcher.pendingConsumedMessageId,
  );
  const normalizedPendingDigestMessageId = normalizePendingDigestMessageId(
    messages,
    watcher,
    watcher.pendingDigestMessageId,
  );

  if (
    normalizedPendingDigestMessageId === undefined
    && (
      watcher.pendingDigestMessageId !== undefined
      || watcher.pendingConsumedMessageId !== undefined
      || watcher.pendingConsumedStateAt !== undefined
    )
  ) {
    return {
      ...watcher,
      lastConsumedMessageId: pickLaterVisibleRoomMessageId(
        roomMessageIds,
        normalizedLastConsumedMessageId,
        normalizedPendingConsumedMessageId,
      ),
      lastConsumedStateAt: pickLaterTimestamp(
        watcher.lastConsumedStateAt,
        watcher.pendingConsumedStateAt,
      ),
      pendingDigestMessageId: undefined,
      pendingConsumedMessageId: undefined,
      pendingConsumedStateAt: undefined,
    };
  }

  return {
    ...watcher,
    lastConsumedMessageId: normalizedLastConsumedMessageId,
    lastConsumedStateAt: watcher.lastConsumedStateAt,
    pendingDigestMessageId: normalizedPendingDigestMessageId,
    pendingConsumedMessageId: normalizedPendingConsumedMessageId,
    pendingConsumedStateAt: watcher.pendingConsumedStateAt,
  };
}
