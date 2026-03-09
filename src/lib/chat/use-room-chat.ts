import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatStatus } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Room, TeamMember, WorkspaceSnapshot } from "@/domain/model";
import {
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

interface MemberChatState {
  status: ChatStatus;
  error?: Error;
  route?: RoomChatStatus;
}

interface MemberChatController {
  chat: Chat<WorkspaceUIMessage>;
  dispose(): void;
}

function isBusyStatus(status: ChatStatus): boolean {
  return status === "submitted" || status === "streaming";
}

function extractMentionHandles(content: string): Set<string> {
  return new Set([...content.matchAll(/@([\p{L}\p{N}_-]+)/gu)].map((match) => match[1]?.toLowerCase()).filter(Boolean));
}

export function resolvePrimaryMemberId(args: {
  room?: Room;
  membersById: Record<string, TeamMember>;
  content: string;
  directMemberId?: string;
}): string | undefined {
  const { room, membersById, content, directMemberId } = args;

  if (!room) {
    return undefined;
  }

  if (directMemberId && room.memberIds.includes(directMemberId)) {
    return directMemberId;
  }

  const mentionedHandles = extractMentionHandles(content);
  const mentionedMemberId = room.memberIds.find((memberId) => {
    const handle = membersById[memberId]?.handle.toLowerCase();
    return handle ? mentionedHandles.has(handle) : false;
  });

  return mentionedMemberId ?? room.entryMemberId;
}

export function describeActiveMemberStreams(activeRoutes: RoomChatStatus[]): string | undefined {
  if (activeRoutes.length === 0) {
    return undefined;
  }

  if (activeRoutes.length === 1) {
    const [route] = activeRoutes;
    if (!route) {
      return undefined;
    }

    return route.summary ? `@${route.memberHandle} 正在处理: ${route.summary}` : `@${route.memberHandle} 正在处理当前消息。`;
  }

  if (activeRoutes.length === 2) {
    return `@${activeRoutes[0]?.memberHandle ?? "member"} 和 @${activeRoutes[1]?.memberHandle ?? "member"} 正在并行处理消息。`;
  }

  return `${activeRoutes.length} 个成员正在并行处理消息。`;
}

export function useRoomChat(args: {
  room?: Room;
  members: TeamMember[];
  snapshot: WorkspaceSnapshot;
}) {
  const { room, members, snapshot } = args;
  const [memberChatStateById, setMemberChatStateById] = useState<Record<string, MemberChatState>>({});
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
  const activeMembersById = useMemo(
    () => Object.fromEntries(members.map((member) => [member.id, member])) as Record<string, TeamMember>,
    [members],
  );
  const controllerByMemberIdRef = useRef<Record<string, MemberChatController>>({});

  useEffect(() => {
    const updateMemberChatState = (memberId: string, patch: Partial<MemberChatState> | ((current: MemberChatState) => MemberChatState)): void => {
      setMemberChatStateById((current) => {
        const previous = current[memberId] ?? { status: "ready" satisfies ChatStatus };
        const next = typeof patch === "function" ? patch(previous) : { ...previous, ...patch };
        if (
          previous.status === next.status &&
          previous.error === next.error &&
          previous.route?.taskId === next.route?.taskId &&
          previous.route?.summary === next.route?.summary
        ) {
          return current;
        }

        return {
          ...current,
          [memberId]: next,
        };
      });
    };

    const nextControllerIds = new Set<string>();

    members.forEach((member) => {
      const expectedChatId = `${room?.id ?? "room-empty"}:${member.id}`;
      const existing = controllerByMemberIdRef.current[member.id];
      if (existing?.chat.id === expectedChatId) {
        nextControllerIds.add(member.id);
        return;
      }

      existing?.dispose();

      const chat = new Chat<WorkspaceUIMessage>({
        id: expectedChatId,
        messages: [],
        transport,
        onData(part) {
          if (part.type === "data-taskRoute") {
            const data = part.data as WorkspaceMessageDataParts["taskRoute"];
            updateMemberChatState(member.id, (current) => ({
              ...current,
              route: {
                roomId: room?.id ?? "",
                taskId: data.taskId,
                memberId: data.memberId,
                memberName: data.memberName,
                memberHandle: data.memberHandle,
              },
            }));
            return;
          }

          if (part.type === "data-taskStatus") {
            const data = part.data as WorkspaceMessageDataParts["taskStatus"];
            updateMemberChatState(member.id, (current) =>
              current.route && current.route.taskId === data.taskId
                ? {
                    ...current,
                    route: {
                      ...current.route,
                      summary: data.summary,
                    },
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

            updateMemberChatState(member.id, (current) => ({
              ...current,
              route: current.route
                ? {
                    ...current.route,
                    summary: data.message,
                  }
                : current.route,
            }));
          }
        },
        onFinish() {
          updateMemberChatState(member.id, (current) => ({
            ...current,
            route: undefined,
          }));
        },
      });

      const syncStatus = (): void => {
        updateMemberChatState(member.id, {
          status: chat.status,
          error: chat.error,
        });
      };

      const unsubscribeStatus = chat["~registerStatusCallback"](syncStatus);
      const unsubscribeError = chat["~registerErrorCallback"](syncStatus);

      syncStatus();

      controllerByMemberIdRef.current[member.id] = {
        chat,
        dispose() {
          void chat.stop();
          unsubscribeStatus();
          unsubscribeError();
        },
      };

      nextControllerIds.add(member.id);
    });

    Object.keys(controllerByMemberIdRef.current).forEach((memberId) => {
      if (nextControllerIds.has(memberId)) {
        return;
      }

      controllerByMemberIdRef.current[memberId]?.dispose();
      delete controllerByMemberIdRef.current[memberId];
    });

  }, [members, room?.id, transport]);

  useEffect(
    () => () => {
      Object.values(controllerByMemberIdRef.current).forEach((controller) => controller.dispose());
      controllerByMemberIdRef.current = {};
    },
    [],
  );

  const activeRoutes = useMemo(
    () =>
      members
        .map((member) => memberChatStateById[member.id]?.route)
        .filter((route): route is RoomChatStatus => Boolean(route)),
    [memberChatStateById, members],
  );
  const activeStreamSummary = useMemo(() => describeActiveMemberStreams(activeRoutes), [activeRoutes]);
  const hasActiveStreams = activeRoutes.length > 0;

  return {
    activeMembersById,
    hasActiveStreams,
    messages: seedMessages,
    roomStatus: activeRoutes[0],
    activeStreamSummary,
    sendMessage: async (content: string, directMemberId?: string): Promise<void> => {
      if (!room) {
        throw new Error("No room selected");
      }

      const targetMemberId = resolvePrimaryMemberId({
        room,
        membersById: activeMembersById,
        content,
        directMemberId,
      });

      if (!targetMemberId) {
        throw new Error("No target member resolved");
      }

      const controller = controllerByMemberIdRef.current[targetMemberId];
      if (!controller) {
        throw new Error(`No chat controller for member "${targetMemberId}"`);
      }

      if (isBusyStatus(controller.chat.status)) {
        await controller.chat.stop();
      }

      controller.chat.messages = seedMessages;
      controller.chat.clearError();

      await controller.chat.sendMessage(
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
