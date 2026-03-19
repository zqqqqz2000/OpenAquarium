import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
  ToolResultOutput,
  ToolResultPart,
  UserModelMessage,
} from "@ai-sdk/provider-utils";

import type {
  OpenAICompatibleConversationState,
  OpenAICompatibleConversationSummary,
} from "../domain/model";

export interface OpenAICompatibleModelMessageOptions {
  instructions?: string[];
  transformToolResult?: (part: ToolResultPart) => ToolResultPart;
}

function formatToolResultOutput(output: ToolResultOutput): string {
  switch (output.type) {
    case "text":
    case "error-text":
      return output.value;
    case "json":
    case "error-json":
      return JSON.stringify(output.value, null, 2);
    case "execution-denied":
      return output.reason ?? "execution denied";
    case "content":
      return output.value.map((part) => {
        switch (part.type) {
          case "text":
            return part.text;
          case "file-data":
            return `[File ${part.mediaType}]`;
          case "file-url":
            return "[File]";
          case "media":
            return `[Media ${part.mediaType}]`;
        }
      }).join("\n");
  }
}

function transformAssistantMessage(
  message: AssistantModelMessage,
  transformToolResult?: (part: ToolResultPart) => ToolResultPart,
): AssistantModelMessage {
  if (!transformToolResult || typeof message.content === "string") {
    return message;
  }

  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool-result"
        ? transformToolResult(part)
        : part),
  };
}

function transformToolMessage(
  message: ToolModelMessage,
  transformToolResult?: (part: ToolResultPart) => ToolResultPart,
): ToolModelMessage {
  if (!transformToolResult) {
    return message;
  }

  return {
    ...message,
    content: message.content.map((part) =>
      part.type === "tool-result"
        ? transformToolResult(part)
        : part),
  };
}

function transformMessageToolResults(
  message: ModelMessage,
  transformToolResult?: (part: ToolResultPart) => ToolResultPart,
): ModelMessage {
  switch (message.role) {
    case "assistant":
      return transformAssistantMessage(message, transformToolResult);
    case "tool":
      return transformToolMessage(message, transformToolResult);
    default:
      return message;
  }
}

function formatUserContent(message: UserModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content.map((part) => (
    part.type === "text"
      ? part.text
      : `[File ${part.mediaType}]`
  )).join("\n");
}

function formatAssistantContent(message: AssistantModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content.map((part) => {
    switch (part.type) {
      case "text":
        return part.text;
      case "reasoning":
        return `[Reasoning] ${part.text}`;
      case "file":
        return `[File ${part.mediaType}]`;
      case "tool-call":
        return `[Tool Call] ${part.toolName}(${JSON.stringify(part.input)})`;
      case "tool-result":
        return `[Tool Result] ${part.toolName}: ${formatToolResultOutput(part.output)}`;
      case "tool-approval-request":
        return `[Tool Approval Request] ${part.toolCallId}`;
    }
  }).join("\n");
}

function formatToolContent(message: ToolModelMessage): string {
  return message.content.map((part) => {
    switch (part.type) {
      case "tool-result":
        return `${part.toolName} (${part.toolCallId}): ${formatToolResultOutput(part.output)}`;
      case "tool-approval-response":
        return `${part.approvalId}: ${part.approved ? "approved" : "rejected"}`;
    }
  }).join("\n");
}

function formatMessage(
  message: ModelMessage,
  summary: OpenAICompatibleConversationSummary | undefined,
  index: number,
): string {
  switch (message.role) {
    case "system":
      return `System:\n${message.content}`;
    case "user":
      return `User:\n${formatUserContent(message)}`;
    case "assistant":
      return [
        index === 0 && summary ? `[Compaction Summary ${summary.compactedAt}]` : "Assistant:",
        formatAssistantContent(message),
      ].join("\n");
    case "tool":
      return [
        "Tool:",
        formatToolContent(message),
      ].join("\n");
  }
}

export function buildPersistedUserTurnMessage(content: string): UserModelMessage {
  return {
    role: "user",
    content,
  };
}

export function buildConversationSummaryMessage(args: {
  content: string;
  summary: OpenAICompatibleConversationSummary;
}): AssistantModelMessage {
  void args.summary;
  return {
    role: "assistant",
    content: args.content,
  };
}

export function appendConversationTurn(args: {
  conversation: OpenAICompatibleConversationState;
  userMessage: UserModelMessage;
  responseMessages: Array<AssistantModelMessage | ToolModelMessage>;
}): OpenAICompatibleConversationState {
  return {
    ...args.conversation,
    messages: [
      ...args.conversation.messages,
      args.userMessage,
      ...structuredClone(args.responseMessages),
    ],
  };
}

export function toModelMessages(
  messages: ModelMessage[],
  options: OpenAICompatibleModelMessageOptions = {},
): ModelMessage[] {
  const modelMessages: ModelMessage[] = [];
  const instructionLines = options.instructions?.map((instruction) => instruction.trim()).filter(Boolean) ?? [];

  if (instructionLines.length > 0) {
    modelMessages.push({
      role: "system",
      content: instructionLines.join("\n"),
    });
  }

  modelMessages.push(
    ...messages.map((message) => transformMessageToolResults(message, options.transformToolResult)),
  );

  return modelMessages;
}

export function formatConversationTrace(args: {
  conversation?: OpenAICompatibleConversationState;
  currentUserMessage: UserModelMessage;
}): string {
  const history = args.conversation?.messages ?? [];
  const historyLines = history.length > 0
    ? history.map((message, index) => (
      `[${index + 1}]\n${formatMessage(message, args.conversation?.summary, index)}`
    )).join("\n\n")
    : "(none)";

  return [
    "[Conversation History]",
    historyLines,
    "",
    "[Current User Turn]",
    formatUserContent(args.currentUserMessage),
  ].join("\n");
}
