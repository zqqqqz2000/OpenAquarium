import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildPersistedUserTurnMessage } from "@/server/openai-compatible-conversation";
import { prepareOpenAICompatibleConversation } from "@/server/openai-compatible-compaction";

describe("prepareOpenAICompatibleConversation", () => {
  it("offloads earlier tool results and oversized tail tool results into files for prompt assembly", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "oa-openai-compaction-"));
    const onStatus = vi.fn(() => Promise.resolve());

    const prepared = await prepareOpenAICompatibleConversation({
      workspaceRoot,
      memberId: "member_1",
      binding: {
        kind: "openai-compatible",
        label: "OpenAI-Compatible API",
        baseURL: "https://example.test/v1",
        headersFormat: "kv",
        headers: {},
        extraBodyFormat: "json",
        extraBody: {},
        mcpServers: [],
        compactionOffloadThresholdChars: 5,
      },
      provider: {
        languageModel: () => {
          throw new Error("Compaction should not run in this test");
        },
      },
      modelId: "gpt-4.1-mini",
      conversation: {
        messages: [
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "old_tool",
                toolName: "old_tool",
                output: {
                  type: "text",
                  value: "tiny",
                },
              },
            ],
          },
          { role: "user", content: "message-1" },
          { role: "assistant", content: "message-2" },
          { role: "user", content: "message-3" },
          { role: "assistant", content: "message-4" },
          { role: "user", content: "message-5" },
          { role: "assistant", content: "message-6" },
          { role: "user", content: "message-7" },
          { role: "assistant", content: "message-8" },
          { role: "user", content: "message-9" },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tail_tool",
                toolName: "tail_tool",
                output: {
                  type: "text",
                  value: "this tail output is definitely too large",
                },
              },
            ],
          },
        ],
      },
      currentUserMessage: buildPersistedUserTurnMessage("continue"),
      abortSignal: new AbortController().signal,
      callbacks: {
        onStatus,
      },
    });

    expect(prepared.compacted).toBe(false);
    expect(onStatus).not.toHaveBeenCalled();

    const oldToolMessage = prepared.conversation.messages[0];
    const tailToolMessage = prepared.conversation.messages[10];
    if (oldToolMessage.role !== "tool" || tailToolMessage.role !== "tool") {
      throw new Error("Expected tool messages");
    }

    const persistedOldToolResult = oldToolMessage.content[0];
    const persistedTailToolResult = tailToolMessage.content[0];
    if (
      persistedOldToolResult?.type !== "tool-result"
      || persistedTailToolResult?.type !== "tool-result"
    ) {
      throw new Error("Expected persisted tool results");
    }

    expect(persistedOldToolResult.output).toEqual({
      type: "text",
      value: "tiny",
    });
    expect(persistedTailToolResult.output).toEqual({
      type: "text",
      value: "this tail output is definitely too large",
    });

    const visibleOldToolMessage = prepared.modelMessages[1];
    const visibleTailToolMessage = prepared.modelMessages[11];
    if (visibleOldToolMessage?.role !== "tool" || visibleTailToolMessage?.role !== "tool") {
      throw new Error("Expected visible tool messages");
    }

    const oldPlaceholder = visibleOldToolMessage.content[0];
    const tailPlaceholder = visibleTailToolMessage.content[0];
    if (
      oldPlaceholder?.type !== "tool-result"
      || tailPlaceholder?.type !== "tool-result"
      || oldPlaceholder.output.type !== "text"
      || tailPlaceholder.output.type !== "text"
    ) {
      throw new Error("Expected text placeholders");
    }

    const oldOffloadPath = oldPlaceholder.output.value.match(/\[Tool result offloaded to file: (.+) \(\d+ chars\)/u)?.[1];
    const tailOffloadPath = tailPlaceholder.output.value.match(/\[Tool result offloaded to file: (.+) \(\d+ chars\)/u)?.[1];
    if (typeof oldOffloadPath !== "string" || typeof tailOffloadPath !== "string") {
      throw new Error("Expected offload paths");
    }

    expect(await readFile(oldOffloadPath, "utf8")).toBe("tiny");
    expect(await readFile(tailOffloadPath, "utf8")).toBe("this tail output is definitely too large");

    expect(prepared.modelMessages[0]).toMatchObject({
      role: "system",
    });
    expect(JSON.stringify(prepared.modelMessages[0])).toContain("Earlier tool call results have been offloaded to files");
    expect(JSON.stringify(prepared.modelMessages[0])).toContain("Some tool call results");
    expect(JSON.stringify(prepared.modelMessages)).toContain(oldOffloadPath);
    expect(JSON.stringify(prepared.modelMessages)).toContain(tailOffloadPath);
    expect(JSON.stringify(prepared.modelMessages)).not.toContain("this tail output is definitely too large");
    expect(prepared.modelMessages.at(-1)).toMatchObject({
      role: "user",
      content: "continue",
    });
  });
});
