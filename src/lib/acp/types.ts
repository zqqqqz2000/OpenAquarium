import type { SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk";

import type { ProviderBinding } from "../../domain/model";

export interface NormalizedAcpEvent {
  kind: "message" | "thought" | "tool" | "plan";
  summary: string;
  rawUpdate: SessionUpdate;
}

export interface AcpProviderDescriptor extends ProviderBinding {
  supportsInterrupt: boolean;
}

export function normalizeAcpUpdate(notification: SessionNotification): NormalizedAcpEvent {
  const update = notification.update;

  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return {
        kind: "message",
        summary: update.content.type === "text" ? update.content.text : `[${update.content.type}]`,
        rawUpdate: update,
      };
    case "agent_thought_chunk":
      return {
        kind: "thought",
        summary: update.content.type === "text" ? update.content.text : "Agent thought",
        rawUpdate: update,
      };
    case "tool_call":
      return {
        kind: "tool",
        summary: `${update.title} (${update.status})`,
        rawUpdate: update,
      };
    case "tool_call_update":
      return {
        kind: "tool",
        summary: `Tool ${update.toolCallId} -> ${update.status}`,
        rawUpdate: update,
      };
    case "plan":
      return {
        kind: "plan",
        summary: `${update.entries.length} plan step(s)`,
        rawUpdate: update,
      };
    default:
      return {
        kind: "message",
        summary: "ACP update",
        rawUpdate: update,
      };
  }
}
