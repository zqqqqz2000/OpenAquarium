import type { ReactElement } from "react";
import type { ChatTransport, UIMessageChunk } from "ai";
import { simulateReadableStream } from "ai";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { TemplateStudioDialog } from "@/components/templates/template-studio-dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { WorkspaceSnapshot } from "@/domain/model";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";
import type { TemplateStudioChatDataParts, TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

interface SavedTemplatePayload {
  templateId: string;
  name: string;
  members: Array<{
    handle: string;
    summary: string;
  }>;
}

type TemplateStudioSyncPayload = TemplateStudioChatDataParts["templateStudioSync"];

function createSyncPayload(snapshot: WorkspaceSnapshot = createSeedWorkspace()): TemplateStudioSyncPayload {
  return {
    snapshot,
    globalConfig: createDefaultGlobalWorkspaceConfig("/tmp/openaquarium"),
    modelProfileId: "model-codex-acp-default",
  };
}

function createAssistantChunks(args: {
  messageId: string;
  text: string;
  syncPayload?: TemplateStudioSyncPayload;
}): UIMessageChunk<unknown, TemplateStudioChatDataParts>[] {
  const textPartId = `${args.messageId}-text`;
  const deltas = args.text.match(/.{1,12}/g) ?? [args.text];

  return [
    { type: "start", messageId: args.messageId },
    { type: "text-start", id: textPartId },
    ...deltas.map((delta) => ({ type: "text-delta" as const, id: textPartId, delta })),
    { type: "text-end", id: textPartId },
    ...(args.syncPayload
      ? [{ type: "data-templateStudioSync" as const, transient: true, data: args.syncPayload }]
      : []),
    { type: "finish", finishReason: "stop" as const },
  ];
}

function createAbortableStream(
  chunks: UIMessageChunk<unknown, TemplateStudioChatDataParts>[],
  abortSignal?: AbortSignal,
  chunkDelayInMs = 10,
): ReadableStream<UIMessageChunk<unknown, TemplateStudioChatDataParts>> {
  return new ReadableStream({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };

      abortSignal?.addEventListener("abort", close, { once: true });

      const reader = simulateReadableStream({
        chunks,
        initialDelayInMs: chunkDelayInMs,
        chunkDelayInMs,
      }).getReader();

      const pump = async (): Promise<void> => {
        while (!closed) {
          const { done, value } = await reader.read();
          if (done || abortSignal?.aborted) {
            close();
            return;
          }
          controller.enqueue(value);
        }
      };

      void pump();
    },
  });
}

function createStartOnlyAbortableStream(
  messageId: string,
  abortSignal?: AbortSignal,
  finishDelayInMs = 250,
): ReadableStream<UIMessageChunk<unknown, TemplateStudioChatDataParts>> {
  return new ReadableStream({
    start(controller) {
      let closed = false;

      const close = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.close();
      };

      controller.enqueue({ type: "start", messageId });

      const finishTimer = setTimeout(() => {
        if (closed || abortSignal?.aborted) {
          close();
          return;
        }
        controller.enqueue({ type: "finish", finishReason: "stop" });
        close();
      }, finishDelayInMs);

      abortSignal?.addEventListener(
        "abort",
        () => {
          clearTimeout(finishTimer);
          close();
        },
        { once: true },
      );
    },
  });
}

class MockTemplateStudioChatTransport implements ChatTransport<TemplateStudioUIMessage> {
  readonly requests: Array<{ messages: TemplateStudioUIMessage[]; abortSignal?: AbortSignal }> = [];

  constructor(
    private readonly handlers: Array<(options: {
      messages: TemplateStudioUIMessage[];
      abortSignal?: AbortSignal;
    }) => ReadableStream<UIMessageChunk<unknown, TemplateStudioChatDataParts>>>,
  ) {}

  sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: TemplateStudioUIMessage[];
    abortSignal: AbortSignal | undefined;
  }): Promise<ReadableStream<UIMessageChunk<unknown, TemplateStudioChatDataParts>>> {
    this.requests.push({
      messages: structuredClone(options.messages),
      abortSignal: options.abortSignal,
    });
    const handler = this.handlers.shift();
    if (!handler) {
      throw new Error("No mock transport handler available");
    }

    return Promise.resolve(
      handler({
        messages: options.messages,
        abortSignal: options.abortSignal,
      }),
    );
  }

  reconnectToStream(): Promise<null> {
    return Promise.resolve(null);
  }
}

function getMessageTexts(messages: TemplateStudioUIMessage[]): string[] {
  return messages.map((message) =>
    message.parts
      .filter((part): part is Extract<TemplateStudioUIMessage["parts"][number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join(""),
  );
}

function renderTemplateStudio(element: ReactElement) {
  return render(<TooltipProvider>{element}</TooltipProvider>);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("TemplateStudioDialog", () => {
  it("saves global template defaults and explains template scope", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const template = templates[0];
    const onSaveConfig = vi.fn();

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={template.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={onSaveConfig}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Team Template Studio" })).toHaveClass("fixed");
    expect(screen.getByRole("dialog", { name: "Team Template Studio" })).not.toHaveClass("relative");
    expect(screen.getByText("Global team template config")).toBeInTheDocument();
    expect(screen.getByText("这里改的是 team template 本身，只影响之后新建的 room。当前 room 里的 member 实例不会被回写。")).toBeInTheDocument();
    expect(screen.getByText("Config directory: /tmp/openaquarium")).toBeInTheDocument();
    expect(screen.getByText("Saved to file")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeDisabled();

    await user.clear(screen.getByRole("textbox", { name: /Template name/i }));
    await user.type(screen.getByRole("textbox", { name: /Template name/i }), "Product Pod v2");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByText("Unsaved changes are local until you save.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeEnabled();
    const forgeCrabTrigger = screen.getAllByRole("button", { name: /Forge Crab/i })[0];
    if (!forgeCrabTrigger) {
      throw new Error("Expected Forge Crab trigger");
    }
    await user.click(forgeCrabTrigger);
    await user.clear(screen.getByRole("textbox", { name: /^Summary$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Summary$/i }), "新的全局 builder summary");
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    expect(onSaveConfig).toHaveBeenCalledTimes(1);
    const savedPayload = onSaveConfig.mock.calls[0]?.[0] as SavedTemplatePayload | undefined;

    expect(savedPayload).toMatchObject({
      templateId: template.id,
      name: "Product Pod v2",
    });
    expect(savedPayload?.members.find((member) => member.handle === "builder")?.summary).toBe("新的全局 builder summary");
    expect(toast.success).toHaveBeenCalledWith("Saved", {
      description: "Product Pod v2 updated.",
    });
    expect(screen.getByTestId("template-summary-card")).toHaveClass("border-b");
    expect(screen.getByTestId("template-list-scroll").parentElement).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
    expect(screen.getByTestId("template-members-scroll").querySelector("[data-slot='scroll-area-viewport']")).toBeTruthy();
  });

  it("lets template members toggle role-owner state and disables default watcher controls when enabled", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const template = templates[0];

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={template.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    const roleSwitch = screen.getByRole("switch", { name: "Template role owner" });
    expect(roleSwitch).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Template watcher enabled" })).not.toBeDisabled();

    await user.click(roleSwitch);

    expect(roleSwitch).toBeChecked();
    expect(screen.getByText("Role owner 会在新建 room 时成为可挂员工的岗位模板；同时不能带默认 Watch。")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Template watcher enabled" })).toBeDisabled();
  });

  it("preserves unsaved role-owner toggles across parent rerenders with equivalent templates", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const template = templates[0];

    const view = renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={template.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("switch", { name: "Template role owner" }));

    expect(screen.getByRole("switch", { name: "Template role owner" })).toBeChecked();

    view.rerender(
      <TooltipProvider>
        <TemplateStudioDialog
          open
          templates={[...templates]}
          selectedTemplateId={template.id}
          globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
          onClose={vi.fn()}
          onDeleteTemplate={vi.fn()}
          onSaveConfig={vi.fn()}
          onSaveGlobalConfig={vi.fn()}
        />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("switch", { name: "Template role owner" })).toBeChecked();
    });
  });

  it("supports template chat and global model editing surfaces", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const syncPayload = createSyncPayload(snapshot);
    const onApplyChatSync = vi.fn();
    const transport = new MockTemplateStudioChatTransport([
      () => simulateReadableStream({
        chunks: createAssistantChunks({
          messageId: "assistant-1",
          text: "Builder switched to a QA-focused prompt.",
          syncPayload,
        }),
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    ]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onApplyChatSync={onApplyChatSync}
        chatTransport={transport}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    expect(screen.queryByText("Team Builder")).not.toBeInTheDocument();
    expect(screen.getByText(/直接说要改什么就行/i)).toBeInTheDocument();
    expect(screen.queryByText(/The model can read/i)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "Make builder more QA focused");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(await screen.findByText("Builder switched to a QA-focused prompt.")).toBeInTheDocument();
    expect(onApplyChatSync).toHaveBeenCalledWith(syncPayload);
    expect(getMessageTexts(transport.requests[0]?.messages ?? [])).toEqual(["Make builder more QA focused"]);

    await user.click(screen.getByRole("tab", { name: /Models/i }));
    expect(screen.getByRole("button", { name: /Add model/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/i })).toBeInTheDocument();
    expect(screen.getByTestId("template-models-scroll").querySelector("[data-slot='scroll-area-viewport']")).toBeTruthy();
  });

  it("streams assistant output and supports stop", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const transport = new MockTemplateStudioChatTransport([
      ({ abortSignal }) =>
        createAbortableStream(
          createAssistantChunks({
            messageId: "assistant-stop",
            text: "Builder now leans QA and review coverage.",
          }),
          abortSignal,
          25,
        ),
    ]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        chatTransport={transport}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "把 builder 改成 QA lead");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(screen.getByTestId("template-chat-pending")).toBeInTheDocument();
    expect(screen.getByText("Updating team template…")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(await screen.findByText(/Builder now leans QA/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(screen.getByText("Stopped before completion.")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Send change request/i })).toBeDisabled();

    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "继续改一下描述");
    expect(screen.getByRole("button", { name: /Send change request/i })).toBeEnabled();
  });

  it("drops an empty aborted assistant turn before the next request", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const transport = new MockTemplateStudioChatTransport([
      ({ abortSignal }) => createStartOnlyAbortableStream("assistant-empty", abortSignal),
      () =>
        simulateReadableStream({
          chunks: createAssistantChunks({
            messageId: "assistant-follow-up",
            text: "Follow-up change applied.",
          }),
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
    ]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        chatTransport={transport}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "你好");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));
    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByTestId("template-chat-first-token-placeholder")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
    });

    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "hai");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(getMessageTexts(transport.requests[1]?.messages ?? [])).toEqual(["你好", "hai"]);
    expect(await screen.findByText("Follow-up change applied.")).toBeInTheDocument();
  });

  it("lets users switch away from the room template and chat about another template", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const transport = new MockTemplateStudioChatTransport([
      () => simulateReadableStream({
        chunks: createAssistantChunks({
          messageId: "assistant-incident",
          text: "Updated incident pod.",
        }),
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    ]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        chatTransport={transport}
      />,
    );

    const incidentTemplate = templates.find((template) => template.name === "Incident Pod");
    expect(incidentTemplate).toBeDefined();
    if (!incidentTemplate) {
      throw new Error("Expected incident template");
    }

    const incidentTrigger = screen.getAllByText("Incident Pod")[0]?.closest("button");
    expect(incidentTrigger).toBeTruthy();
    if (!incidentTrigger) {
      throw new Error("Expected incident template trigger");
    }

    await user.click(incidentTrigger);
    expect(screen.getByRole("textbox", { name: /Template name/i })).toHaveValue("Incident Pod");

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    expect(screen.queryByText("Team Builder")).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "Tighten the incident workflow");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(getMessageTexts(transport.requests[0]?.messages ?? [])).toEqual(["Tighten the incident workflow"]);
    expect(await screen.findByText("Updated incident pod.")).toBeInTheDocument();
  });

  it("keeps template chat input stable while typing before send", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    const input = screen.getByRole("textbox", { name: /Template chat input/i });
    await user.type(input, "把 builder 改成 QA lead");

    expect(input).toHaveValue("把 builder 改成 QA lead");
    expect(screen.getByRole("button", { name: /Send change request/i })).toBeEnabled();
  });

  it("sends prior chat turns back on later template chat requests", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const transport = new MockTemplateStudioChatTransport([
      () => simulateReadableStream({
        chunks: createAssistantChunks({
          messageId: "assistant-first",
          text: "First change applied.",
        }),
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
      () => simulateReadableStream({
        chunks: createAssistantChunks({
          messageId: "assistant-second",
          text: "Second change applied.",
        }),
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    ]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        chatTransport={transport}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "把 builder 改成 QA lead");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));
    expect(await screen.findByText("First change applied.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "再把描述缩短");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(getMessageTexts(transport.requests[1]?.messages ?? [])).toEqual([
      "把 builder 改成 QA lead",
      "First change applied.",
      "再把描述缩短",
    ]);
    expect(await screen.findByText("Second change applied.")).toBeInTheDocument();
  });

  it("keeps chat histories isolated per template when switching away and back", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const transport = new MockTemplateStudioChatTransport([
      () => simulateReadableStream({
        chunks: createAssistantChunks({
          messageId: "assistant-product",
          text: "Product pod updated.",
        }),
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
      () => simulateReadableStream({
        chunks: createAssistantChunks({
          messageId: "assistant-incident-2",
          text: "Incident pod updated.",
        }),
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    ]);

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        chatTransport={transport}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "更新当前产品模板");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));
    expect(await screen.findByText("Product pod updated.")).toBeInTheDocument();

    const incidentTrigger = screen.getAllByText("Incident Pod")[0]?.closest("button");
    expect(incidentTrigger).toBeTruthy();
    if (!incidentTrigger) {
      throw new Error("Expected incident template trigger");
    }

    await user.click(incidentTrigger);
    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "更新 incident 模板");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));
    expect(await screen.findByText("Incident pod updated.")).toBeInTheDocument();

    const productTrigger = screen.getAllByText("Product Pod")[0]?.closest("button");
    expect(productTrigger).toBeTruthy();
    if (!productTrigger) {
      throw new Error("Expected product template trigger");
    }

    await user.click(productTrigger);
    await user.click(screen.getByRole("tab", { name: /Chat/i }));

    expect(screen.getByText("Product pod updated.")).toBeInTheDocument();
    expect(screen.queryByText("Incident pod updated.")).not.toBeInTheDocument();
  });

  it("confirms and triggers template deletion from the list", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const onDeleteTemplate = vi.fn(() => Promise.resolve());

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={onDeleteTemplate}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Incident Pod" }));
    const deleteDialog = await screen.findByRole("alertdialog", { name: "Delete Incident Pod?" });
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete" }));

    expect(onDeleteTemplate).toHaveBeenCalledWith("template-incident-pod");
  });

  it("lets users manually add and remove template members", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const template = templates[0];
    const deletedMember = template.members.at(-1);
    const onSaveConfig = vi.fn();

    if (!deletedMember) {
      throw new Error("Expected a member to delete");
    }

    renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={template.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={onSaveConfig}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: `Delete ${deletedMember.name}` }));
    const deleteMemberDialog = await screen.findByRole("alertdialog", { name: `Delete ${deletedMember.name}?` });
    await user.click(within(deleteMemberDialog).getByRole("button", { name: "Delete" }));

    await user.click(screen.getByRole("button", { name: /Add member/i }));
    await user.clear(screen.getByRole("textbox", { name: /^Name$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Name$/i }), "QA Reviewer");
    await user.clear(screen.getByRole("textbox", { name: /^Handle$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Handle$/i }), "qa-review");
    await user.clear(screen.getByRole("textbox", { name: /^Summary$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Summary$/i }), "Reviews changes before handoff.");
    await user.clear(screen.getByRole("textbox", { name: /^Prompt$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Prompt$/i }), "Review changes and send short visible progress updates.");
    await user.click(screen.getByRole("button", { name: /^Save$/i }));

    const savedPayload = onSaveConfig.mock.calls[0]?.[0] as SavedTemplatePayload | undefined;

    expect(savedPayload?.members.some((member) => member.handle === deletedMember.handle)).toBe(false);
    expect(savedPayload?.members.some((member) => member.handle === "qa-review")).toBe(true);
  });

  it("reopens from the latest template props instead of stale local drafts", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const template = templates[0];

    const { rerender } = renderTemplateStudio(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={template.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
      />,
    );

    const promptInput = screen.getByRole("textbox", { name: /^Prompt$/i });
    await user.clear(promptInput);
    await user.type(promptInput, "stale local draft");
    expect(promptInput).toHaveValue("stale local draft");

    rerender(
      <TooltipProvider>
        <TemplateStudioDialog
          open={false}
          templates={templates}
          selectedTemplateId={template.id}
          globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
          onClose={vi.fn()}
          onDeleteTemplate={vi.fn()}
          onSaveConfig={vi.fn()}
          onSaveGlobalConfig={vi.fn()}
        />
      </TooltipProvider>,
    );

    const reloadedTemplates = templates.map((candidate) =>
      candidate.id === template.id
        ? {
            ...candidate,
            members: candidate.members.map((member, index) =>
              index === 0
                ? {
                    ...member,
                    prompt: "prompt from latest template props",
                  }
                : member,
            ),
          }
        : candidate,
    );

    rerender(
      <TooltipProvider>
        <TemplateStudioDialog
          open
          templates={reloadedTemplates}
          selectedTemplateId={template.id}
          globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
          onClose={vi.fn()}
          onDeleteTemplate={vi.fn()}
          onSaveConfig={vi.fn()}
          onSaveGlobalConfig={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(screen.getByRole("textbox", { name: /^Prompt$/i })).toHaveValue("prompt from latest template props");
  });
});
