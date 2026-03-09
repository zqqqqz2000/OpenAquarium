import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";

import type { Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import {
  areWorkspaceUIMessagesEqual,
  mapRoomMessagesToUIMessages,
  type WorkspaceMessageDataParts,
  type WorkspaceUIMessage,
} from "@/lib/chat/workspace-ui-message";
import { resolveWorkspaceRuntimeBaseUrl } from "@/lib/runtime-client";

export interface RoomChatStatus {
  roomId: string;
  taskId: string;
  memberId: string;
  memberName: string;
  memberHandle: string;
  summary?: string;
}

export function useRoomChat(args: {
  room?: Room;
  members: TeamMember[];
  snapshot: WorkspaceSnapshot;
}) {
  const { room, members, snapshot } = args;
  const [status, setStatus] = useState<RoomChatStatus | undefined>(undefined);
  const transport = useMemo(
    () =>
      new DefaultChatTransport<WorkspaceUIMessage>({
        api: `${resolveWorkspaceRuntimeBaseUrl()}/api/chat`,
      }),
    [],
  );
  const seedMessages = useMemo(
    () => (room ? mapRoomMessagesToUIMessages(snapshot, room) : []),
    [room, snapshot],
  );
  const chat = useChat<WorkspaceUIMessage>({
    id: room?.id ?? "room-empty",
    messages: seedMessages,
    transport,
    experimental_throttle: 48,
    onData(part) {
      if (part.type === "data-taskRoute") {
        const data = part.data as WorkspaceMessageDataParts["taskRoute"];
        setStatus({
          roomId: room?.id ?? "",
          taskId: data.taskId,
          memberId: data.memberId,
          memberName: data.memberName,
          memberHandle: data.memberHandle,
        });
        return;
      }

      if (part.type === "data-taskStatus") {
        const data = part.data as WorkspaceMessageDataParts["taskStatus"];
        setStatus((current) =>
          current && current.taskId === data.taskId
            ? {
                ...current,
                summary: data.summary,
              }
            : current,
        );
        return;
      }

      if (part.type === "data-notification") {
        const data = part.data as WorkspaceMessageDataParts["notification"];
        if (data.level !== "error") {
          return;
        }

        setStatus((current) =>
          current
            ? {
                ...current,
                summary: data.message,
              }
            : current,
        );
      }
    },
    onFinish() {
      setStatus(undefined);
    },
  });

  useEffect(() => {
    if (chat.status === "streaming" || chat.status === "submitted") {
      return;
    }

    if (!areWorkspaceUIMessagesEqual(chat.messages, seedMessages)) {
      chat.setMessages(seedMessages);
    }
  }, [chat, chat.status, seedMessages]);

  const activeMembersById = useMemo(
    () => Object.fromEntries(members.map((member) => [member.id, member])) as Record<string, TeamMember>,
    [members],
  );

  return {
    activeMembersById,
    chat,
    messages: chat.messages,
    roomStatus: status?.roomId === room?.id ? status : undefined,
    sendMessage: async (content: string, directMemberId?: string): Promise<void> => {
      if (!room) {
        throw new Error("No room selected");
      }

      await chat.sendMessage(
        {
          text: content,
        },
        {
          body: {
            roomId: room.id,
            directMemberId,
          },
        },
      );
    },
  };
}
