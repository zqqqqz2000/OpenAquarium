import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
} from "@ai-sdk/provider-utils";

import type {
  OpenAICompatibleConversationState,
  PersistedOpenAICompatibleAssistantMessage,
  PersistedOpenAICompatibleAssistantPart,
  PersistedOpenAICompatibleMessage,
  PersistedOpenAICompatibleToolMessage,
  PersistedOpenAICompatibleToolResultPart,
  PersistedOpenAICompatibleUserMessage,
} from "../domain/model";
import type { JsonValue } from "../lib/json";

function sanitizeJsonValue(value: unknown): JsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonValue(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, sanitizeJsonValue(entryValue)]),
    );
  }

  return String(value);
}

function sanitizeAssistantMessage(message: AssistantModelMessage): PersistedOpenAICompatibleAssistantMessage | undefined {
  if (typeof message.content === "string") {
    return {
      role: "assistant",
      content: message.content,
    };
  }

  const content = message.content.reduce<PersistedOpenAICompatibleAssistantPart[]>((parts, part) => {
    switch (part.type) {
      case "text":
        parts.push({
          type: "text",
          text: part.text,
        });
        break;
      case "tool-call":
        parts.push({
          type: "tool-call",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: sanitizeJsonValue(part.input),
        });
        break;
      case "tool-result":
        parts.push({
          type: "tool-result",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: sanitizeJsonValue(part.output),
        });
        break;
      default:
        break;
    }

    return parts;
  }, []);

  return content.length > 0
    ? {
        role: "assistant",
        content,
      }
    : undefined;
}

function sanitizeToolMessage(message: ToolModelMessage): PersistedOpenAICompatibleToolMessage | undefined {
  const content = message.content.reduce<PersistedOpenAICompatibleToolResultPart[]>((parts, part) => {
    if (part.type !== "tool-result") {
      return parts;
    }

    parts.push({
      type: "tool-result",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      output: sanitizeJsonValue(part.output),
    });
    return parts;
  }, []);

  return content.length > 0
    ? {
        role: "tool",
        content,
      }
    : undefined;
}

export function buildPersistedUserTurnMessage(content: string): PersistedOpenAICompatibleUserMessage {
  return {
    role: "user",
    content,
  };
}

export function sanitizeResponseMessages(
  messages: Array<AssistantModelMessage | ToolModelMessage>,
): PersistedOpenAICompatibleMessage[] {
  return messages.reduce<PersistedOpenAICompatibleMessage[]>((sanitizedMessages, message) => {
    if (message.role === "assistant") {
      const sanitized = sanitizeAssistantMessage(message);
      if (sanitized) {
        sanitizedMessages.push(sanitized);
      }
      return sanitizedMessages;
    }

    const sanitized = sanitizeToolMessage(message);
    if (sanitized) {
      sanitizedMessages.push(sanitized);
    }
    return sanitizedMessages;
  }, []);
}

export function appendConversationTurn(args: {
  conversation: OpenAICompatibleConversationState;
  userMessage: PersistedOpenAICompatibleUserMessage;
  responseMessages: Array<AssistantModelMessage | ToolModelMessage>;
}): OpenAICompatibleConversationState {
  return {
    messages: [
      ...args.conversation.messages,
      args.userMessage,
      ...sanitizeResponseMessages(args.responseMessages),
    ],
  };
}

export function toModelMessages(messages: PersistedOpenAICompatibleMessage[]): ModelMessage[] {
  return messages as ModelMessage[];
}

function formatAssistantContent(content: PersistedOpenAICompatibleAssistantMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "tool-call":
        return `[Tool Call] ${part.toolName}(${JSON.stringify(part.input)})`;
      case "tool-result":
        return `[Tool Result] ${part.toolName}: ${JSON.stringify(part.output)}`;
    }
  }).join("\n");
}

function formatMessage(message: PersistedOpenAICompatibleMessage): string {
  switch (message.role) {
    case "user":
      return `User:\n${message.content}`;
    case "assistant":
      return `Assistant:\n${formatAssistantContent(message.content)}`;
    case "tool":
      return [
        "Tool:",
        ...message.content.map((part) => `${part.toolName} (${part.toolCallId}): ${JSON.stringify(part.output)}`),
      ].join("\n");
  }
}

export function formatConversationTrace(args: {
  messageHistory: PersistedOpenAICompatibleMessage[];
  currentUserMessage: PersistedOpenAICompatibleUserMessage;
}): string {
  const historyLines = args.messageHistory.length > 0
    ? args.messageHistory.map((message, index) => `[${index + 1}]\n${formatMessage(message)}`).join("\n\n")
    : "(none)";

  return [
    "[Conversation History]",
    historyLines,
    "",
    "[Current User Turn]",
    args.currentUserMessage.content,
  ].join("\n");
}
