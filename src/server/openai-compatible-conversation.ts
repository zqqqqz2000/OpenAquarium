import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
} from "@ai-sdk/provider-utils";

import type {
  OpenAICompatibleConversationState,
  PersistedOpenAICompatibleAssistantMessage,
  PersistedOpenAICompatibleAssistantPart,
  PersistedOpenAICompatibleConversationSummary,
  PersistedOpenAICompatibleMessage,
  PersistedOpenAICompatibleToolMessage,
  PersistedOpenAICompatibleToolResultPart,
  PersistedOpenAICompatibleUserMessage,
} from "../domain/model";
import type { JsonValue } from "../lib/json";

export interface OpenAICompatibleModelMessageOptions {
  instructions?: string[];
  useOffloadedToolResults?: boolean;
}

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

  if (typeof value === "undefined") {
    return "undefined";
  }

  if (typeof value === "bigint") {
    return value.toString(10);
  }

  if (typeof value === "symbol") {
    return value.description ?? "symbol";
  }

  return "[unsupported]";
}

function toToolOutputText(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function buildOffloadPlaceholder(part: PersistedOpenAICompatibleToolResultPart): string {
  if (!part.offload) {
    return toToolOutputText(part.output);
  }

  return `[Tool result offloaded to file: ${part.offload.path} (${part.offload.chars} chars). Use oa_read_file to inspect the exact content if needed.]`;
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

function toAssistantContent(
  content: PersistedOpenAICompatibleAssistantMessage["content"],
  options: Pick<OpenAICompatibleModelMessageOptions, "useOffloadedToolResults">,
): string | PersistedOpenAICompatibleAssistantPart[] {
  if (typeof content === "string") {
    return content;
  }

  return content.map((part) => {
    if (part.type !== "tool-result" || !options.useOffloadedToolResults) {
      return part;
    }

    return {
      ...part,
      output: buildOffloadPlaceholder(part),
    };
  });
}

function toToolContent(
  content: PersistedOpenAICompatibleToolMessage["content"],
  options: Pick<OpenAICompatibleModelMessageOptions, "useOffloadedToolResults">,
): PersistedOpenAICompatibleToolResultPart[] {
  return content.map((part) =>
    !options.useOffloadedToolResults
      ? part
      : {
          ...part,
          output: buildOffloadPlaceholder(part),
        });
}

export function buildPersistedUserTurnMessage(content: string): PersistedOpenAICompatibleUserMessage {
  return {
    role: "user",
    content,
  };
}

export function buildConversationSummaryMessage(args: {
  content: string;
  summary: PersistedOpenAICompatibleConversationSummary;
}): PersistedOpenAICompatibleAssistantMessage {
  return {
    role: "assistant",
    content: args.content,
    summary: args.summary,
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

export function toModelMessages(
  messages: PersistedOpenAICompatibleMessage[],
  options: OpenAICompatibleModelMessageOptions = {},
): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];

  const instructionLines = options.instructions?.map((instruction) => instruction.trim()).filter(Boolean) ?? [];
  if (instructionLines.length > 0) {
    modelMessages.push({
      role: "system",
      content: instructionLines.join("\n"),
    } as ModelMessage);
  }

  for (const message of messages) {
    switch (message.role) {
      case "user":
        modelMessages.push({
          role: "user",
          content: message.content,
        } as ModelMessage);
        break;
      case "assistant":
        modelMessages.push({
          role: "assistant",
          content: toAssistantContent(message.content, options),
        } as ModelMessage);
        break;
      case "tool":
        modelMessages.push({
          role: "tool",
          content: toToolContent(message.content, options),
        } as ModelMessage);
        break;
    }
  }

  return modelMessages;
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
        return part.offload
          ? `[Tool Result] ${part.toolName}: ${buildOffloadPlaceholder(part)}`
          : `[Tool Result] ${part.toolName}: ${JSON.stringify(part.output)}`;
    }
  }).join("\n");
}

function formatMessage(message: PersistedOpenAICompatibleMessage): string {
  switch (message.role) {
    case "user":
      return `User:\n${message.content}`;
    case "assistant":
      return [
        message.summary ? `[Compaction Summary ${message.summary.compactedAt}]` : "Assistant:",
        formatAssistantContent(message.content),
      ].join("\n");
    case "tool":
      return [
        "Tool:",
        ...message.content.map((part) =>
          `${part.toolName} (${part.toolCallId}): ${
            part.offload ? buildOffloadPlaceholder(part) : JSON.stringify(part.output)
          }`),
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
