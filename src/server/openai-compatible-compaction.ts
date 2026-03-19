import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
  AssistantModelMessage,
  ModelMessage,
  ToolModelMessage,
  ToolResultOutput,
  ToolResultPart,
  UserModelMessage,
} from "@ai-sdk/provider-utils";
import { streamText } from "ai";

import type {
  OpenAICompatibleConversationState,
  OpenAICompatibleModelLimit,
  OpenAICompatibleProviderBinding,
} from "../domain/model";
import type { ExecutorCallbacks } from "./executor";
import {
  buildConversationSummaryMessage,
  toModelMessages,
} from "./openai-compatible-conversation";

const APPROXIMATE_CHARS_PER_TOKEN = 4;
const DEFAULT_TAIL_MESSAGE_COUNT = 10;
const DEFAULT_RESERVED_TOKENS = 20_000;
const DEFAULT_OFFLOAD_THRESHOLD_CHARS = 12_000;

type LanguageModelFactory = {
  languageModel(modelId: string): LanguageModelV3;
};

interface OffloadFlags {
  hasAnyOffloads: boolean;
  hasOlderToolOffloads: boolean;
  hasTailToolOffloads: boolean;
}

interface ToolResultOffload {
  path: string;
  chars: number;
}

export interface PreparedOpenAICompatibleConversation {
  conversation: OpenAICompatibleConversationState;
  modelMessages: ModelMessage[];
  compacted: boolean;
}

function normalizeToolOutputText(output: ToolResultOutput): string {
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

function buildOffloadPlaceholder(offload: ToolResultOffload): ToolResultOutput {
  return {
    type: "text",
    value: `[Tool result offloaded to file: ${offload.path} (${offload.chars} chars). Use oa_read_file to inspect the exact content if needed.]`,
  };
}

function slugifyToken(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized : "tool";
}

function buildOffloadFilePath(args: {
  workspaceRoot: string;
  memberId: string;
  part: ToolResultPart;
  content: string;
}): string {
  const hash = createHash("sha1").update(`${args.part.toolCallId}\n${args.part.toolName}\n${args.content}`).digest("hex").slice(0, 16);
  const extension = args.part.output.type === "text" || args.part.output.type === "error-text" ? "txt" : "json";

  return path.join(
    args.workspaceRoot,
    ".openaquarium",
    "openai-compatible",
    "offload",
    args.memberId,
    `${slugifyToken(args.part.toolName)}-${slugifyToken(args.part.toolCallId)}-${hash}.${extension}`,
  );
}

function resolveOffloadThresholdChars(binding: OpenAICompatibleProviderBinding): number {
  return binding.compactionOffloadThresholdChars ?? DEFAULT_OFFLOAD_THRESHOLD_CHARS;
}

function resolveReservedTokens(binding: OpenAICompatibleProviderBinding): number {
  return binding.compactionReservedTokens ?? DEFAULT_RESERVED_TOKENS;
}

async function ensureOffload(args: {
  workspaceRoot: string;
  memberId: string;
  part: ToolResultPart;
}): Promise<ToolResultOffload> {
  const content = normalizeToolOutputText(args.part.output);
  const filePath = buildOffloadFilePath({
    workspaceRoot: args.workspaceRoot,
    memberId: args.memberId,
    part: args.part,
    content,
  });
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return {
    path: filePath,
    chars: content.length,
  };
}

async function transformAssistantContent(args: {
  workspaceRoot: string;
  memberId: string;
  content: AssistantModelMessage["content"];
  olderThanTail: boolean;
  offloadThresholdChars: number;
}): Promise<{ content: AssistantModelMessage["content"]; offloaded: boolean }> {
  if (typeof args.content === "string") {
    return {
      content: args.content,
      offloaded: false,
    };
  }

  let offloaded = false;
  const nextContent = await Promise.all(args.content.map(async (part) => {
    if (part.type !== "tool-result") {
      return part;
    }

    const outputText = normalizeToolOutputText(part.output);
    const shouldOffload = args.olderThanTail || outputText.length > args.offloadThresholdChars;
    if (!shouldOffload) {
      return part;
    }

    offloaded = true;
    const offload = await ensureOffload({
      workspaceRoot: args.workspaceRoot,
      memberId: args.memberId,
      part,
    });

    return {
      ...part,
      output: buildOffloadPlaceholder(offload),
    };
  }));

  return {
    content: nextContent,
    offloaded,
  };
}

async function transformToolContent(args: {
  workspaceRoot: string;
  memberId: string;
  content: ToolModelMessage["content"];
  olderThanTail: boolean;
  offloadThresholdChars: number;
}): Promise<{ content: ToolModelMessage["content"]; offloaded: boolean }> {
  let offloaded = false;
  const nextContent = await Promise.all(args.content.map(async (part) => {
    if (part.type !== "tool-result") {
      return part;
    }

    const outputText = normalizeToolOutputText(part.output);
    const shouldOffload = args.olderThanTail || outputText.length > args.offloadThresholdChars;
    if (!shouldOffload) {
      return part;
    }

    offloaded = true;
    const offload = await ensureOffload({
      workspaceRoot: args.workspaceRoot,
      memberId: args.memberId,
      part,
    });

    return {
      ...part,
      output: buildOffloadPlaceholder(offload),
    };
  }));

  return {
    content: nextContent,
    offloaded,
  };
}

async function applyToolResultOffloads(args: {
  workspaceRoot: string;
  memberId: string;
  conversation: OpenAICompatibleConversationState;
  offloadThresholdChars: number;
  tailMessageCount?: number;
}): Promise<{ messages: ModelMessage[]; flags: OffloadFlags }> {
  const tailMessageCount = args.tailMessageCount ?? DEFAULT_TAIL_MESSAGE_COUNT;
  const tailStartIndex = Math.max(0, args.conversation.messages.length - tailMessageCount);
  const nextMessages: ModelMessage[] = [];
  const flags: OffloadFlags = {
    hasAnyOffloads: false,
    hasOlderToolOffloads: false,
    hasTailToolOffloads: false,
  };

  for (const [messageIndex, message] of args.conversation.messages.entries()) {
    const olderThanTail = messageIndex < tailStartIndex;

    if (message.role === "assistant") {
      const transformed = await transformAssistantContent({
        workspaceRoot: args.workspaceRoot,
        memberId: args.memberId,
        content: message.content,
        olderThanTail,
        offloadThresholdChars: args.offloadThresholdChars,
      });
      if (transformed.offloaded) {
        flags.hasAnyOffloads = true;
        if (olderThanTail) {
          flags.hasOlderToolOffloads = true;
        } else {
          flags.hasTailToolOffloads = true;
        }
      }
      nextMessages.push({
        ...message,
        content: transformed.content,
      });
      continue;
    }

    if (message.role === "tool") {
      const transformed = await transformToolContent({
        workspaceRoot: args.workspaceRoot,
        memberId: args.memberId,
        content: message.content,
        olderThanTail,
        offloadThresholdChars: args.offloadThresholdChars,
      });
      if (transformed.offloaded) {
        flags.hasAnyOffloads = true;
        if (olderThanTail) {
          flags.hasOlderToolOffloads = true;
        } else {
          flags.hasTailToolOffloads = true;
        }
      }
      nextMessages.push({
        ...message,
        content: transformed.content,
      });
      continue;
    }

    nextMessages.push(message);
  }

  return {
    messages: nextMessages,
    flags,
  };
}

function buildExecutionInstructions(args: {
  hasSummary: boolean;
  flags: OffloadFlags;
}): string[] {
  const instructions: string[] = [];

  if (args.flags.hasAnyOffloads) {
    instructions.push(
      "Some tool call results in the conversation below are replaced with offload file paths. Use oa_read_file to inspect an offloaded result only when its exact contents are needed.",
    );
  }

  if (args.flags.hasOlderToolOffloads) {
    instructions.push(
      "Earlier tool call results have been offloaded to files; if you need an exact earlier result, read the referenced file on demand instead of guessing.",
    );
  }

  if (args.hasSummary) {
    instructions.push(
      "The conversation begins with a compaction summary. The last 10 messages are included separately with more detail. Use those details, but do not restate them.",
    );
  }

  return instructions;
}

function resolveModelLimit(binding: OpenAICompatibleProviderBinding, modelId: string): OpenAICompatibleModelLimit | undefined {
  return binding.modelLimits?.[modelId];
}

function estimateMessageTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / APPROXIMATE_CHARS_PER_TOKEN);
}

function shouldCompactConversation(args: {
  binding: OpenAICompatibleProviderBinding;
  modelId: string;
  modelMessages: ModelMessage[];
  conversation: OpenAICompatibleConversationState;
}): boolean {
  const limit = resolveModelLimit(args.binding, args.modelId);
  if (!limit || args.conversation.messages.length <= DEFAULT_TAIL_MESSAGE_COUNT) {
    return false;
  }

  const effectiveLimit = limit.input ?? limit.context;
  const usableLimit = effectiveLimit - resolveReservedTokens(args.binding);
  if (usableLimit <= 0) {
    return false;
  }

  return estimateMessageTokens(args.modelMessages) >= usableLimit;
}

function buildCompactionPrompt(tailMessageCount: number): string {
  return [
    "Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.",
    "This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing development work without losing context.",
    "",
    "Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points.",
    "",
    "Your summary should include the following sections:",
    "",
    "1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail",
    "2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed.",
    "3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Pay special attention to the most recent messages and include full code snippets where applicable.",
    "4. Errors and fixes: List all errors that you ran into, and how you fixed them. Pay special attention to specific user feedback.",
    "5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.",
    "6. All user messages: List ALL user messages that are not tool results. These are critical for understanding the users' feedback and changing intent.",
    "7. Pending Tasks: Outline any pending tasks that you have explicitly been asked to work on.",
    "8. Current Work: Describe in detail precisely what was being worked on immediately before this summary request.",
    "",
    `The last ${tailMessageCount} messages will be included separately after compaction. Preserve the necessary detail about them in the summary, but do not restate them verbatim or duplicate them unnecessarily.`,
  ].join("\n");
}

async function compactConversation(args: {
  binding: OpenAICompatibleProviderBinding;
  provider: LanguageModelFactory;
  currentModelId: string;
  conversation: OpenAICompatibleConversationState;
  abortSignal: AbortSignal;
  callbacks: Pick<ExecutorCallbacks, "onStatus">;
  tailMessageCount?: number;
}): Promise<OpenAICompatibleConversationState> {
  const tailMessageCount = args.tailMessageCount ?? DEFAULT_TAIL_MESSAGE_COUNT;
  const compactionModelId = args.binding.compactionModelId?.trim() || args.currentModelId;
  await args.callbacks.onStatus("Compacting conversation history...");

  const compactionPrompt = buildCompactionPrompt(tailMessageCount);
  const result = streamText({
    abortSignal: args.abortSignal,
    model: args.provider.languageModel(compactionModelId),
    messages: [
      {
        role: "system",
        content: "[OA_COMPACTION_AGENT]\nYou are the dedicated conversation compaction agent. Summarize the conversation so the next turn can continue without losing important context. Do not call tools. Do not continue the task yourself.",
      },
      ...toModelMessages(args.conversation.messages),
      {
        role: "user",
        content: compactionPrompt,
      },
    ],
  });
  const summaryText = (await result.text).trim();
  const tailMessages = args.conversation.messages.slice(-tailMessageCount);
  const summary = {
    compactedAt: new Date().toISOString(),
    sourceMessageCount: args.conversation.messages.length,
    tailMessageCount: tailMessages.length,
    modelId: compactionModelId,
  };

  await args.callbacks.onStatus("Compaction completed.");

  return {
    messages: [
      buildConversationSummaryMessage({
        content: summaryText.length > 0 ? summaryText : "Summary unavailable.",
        summary,
      }),
      ...tailMessages,
    ],
    summary,
  };
}

export function isContextWindowErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("maximum context length")
    || normalized.includes("context length")
    || normalized.includes("context window")
    || normalized.includes("prompt is too long")
    || normalized.includes("too many tokens")
    || normalized.includes("maximum number of tokens")
  );
}

export async function prepareOpenAICompatibleConversation(args: {
  workspaceRoot: string;
  memberId: string;
  binding: OpenAICompatibleProviderBinding;
  provider: LanguageModelFactory;
  modelId: string;
  conversation: OpenAICompatibleConversationState;
  currentUserMessage: UserModelMessage;
  abortSignal: AbortSignal;
  callbacks: Pick<ExecutorCallbacks, "onStatus">;
  forceCompaction?: boolean;
  tailMessageCount?: number;
}): Promise<PreparedOpenAICompatibleConversation> {
  const tailMessageCount = args.tailMessageCount ?? DEFAULT_TAIL_MESSAGE_COUNT;
  let compacted = false;
  let preparedConversation = structuredClone(args.conversation);

  let visibleConversation = await applyToolResultOffloads({
    workspaceRoot: args.workspaceRoot,
    memberId: args.memberId,
    conversation: preparedConversation,
    offloadThresholdChars: resolveOffloadThresholdChars(args.binding),
    tailMessageCount,
  });

  let instructions = buildExecutionInstructions({
    hasSummary: Boolean(preparedConversation.summary),
    flags: visibleConversation.flags,
  });

  let modelMessages = [
    ...toModelMessages(visibleConversation.messages, {
      instructions,
    }),
    args.currentUserMessage as ModelMessage,
  ];

  const needsCompaction =
    args.forceCompaction
    || shouldCompactConversation({
      binding: args.binding,
      modelId: args.modelId,
      modelMessages,
      conversation: preparedConversation,
    });

  if (needsCompaction && preparedConversation.messages.length > tailMessageCount) {
    compacted = true;
    preparedConversation = await compactConversation({
      binding: args.binding,
      provider: args.provider,
      currentModelId: args.modelId,
      conversation: preparedConversation,
      abortSignal: args.abortSignal,
      callbacks: args.callbacks,
      tailMessageCount,
    });

    visibleConversation = await applyToolResultOffloads({
      workspaceRoot: args.workspaceRoot,
      memberId: args.memberId,
      conversation: preparedConversation,
      offloadThresholdChars: resolveOffloadThresholdChars(args.binding),
      tailMessageCount,
    });

    instructions = buildExecutionInstructions({
      hasSummary: true,
      flags: visibleConversation.flags,
    });

    modelMessages = [
      ...toModelMessages(visibleConversation.messages, {
        instructions,
      }),
      args.currentUserMessage as ModelMessage,
    ];
  }

  return {
    conversation: preparedConversation,
    modelMessages,
    compacted,
  };
}
