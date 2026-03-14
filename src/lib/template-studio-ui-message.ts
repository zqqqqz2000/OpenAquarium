import type { UIMessage } from "ai";

import type { GlobalWorkspaceConfig, WorkspaceSnapshot } from "@/domain/model";

export interface TemplateStudioChatDataParts {
  templateStudioSync: {
    snapshot: WorkspaceSnapshot;
    globalConfig: GlobalWorkspaceConfig;
    modelProfileId: string;
    modelId?: string;
  };
  [key: string]: unknown;
}

export type TemplateStudioUIMessage = UIMessage<unknown, TemplateStudioChatDataParts>;

export function getTemplateStudioMessageText(message: Pick<TemplateStudioUIMessage, "parts">): string {
  return message.parts
    .filter((part): part is Extract<TemplateStudioUIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function sanitizeTemplateStudioMessages(messages: TemplateStudioUIMessage[]): TemplateStudioUIMessage[] {
  const sanitized = messages.filter((message) => !(message.role === "assistant" && message.parts.length === 0));

  return sanitized.length === messages.length ? messages : sanitized;
}
