import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TemplateStudioDialog } from "@/components/templates/template-studio-dialog";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { createSeedWorkspace } from "@/lib/sample-data/workspace";

interface SavedTemplatePayload {
  templateId: string;
  name: string;
  members: Array<{
    handle: string;
    summary: string;
  }>;
}

describe("TemplateStudioDialog", () => {
  it("saves global template defaults and explains template scope", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const template = templates[0];
    const onSaveConfig = vi.fn();

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={template.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={onSaveConfig}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={vi.fn(() => Promise.resolve({
          assistantMessage: "updated template",
          modelProfileId: "model-codex-acp-default",
        }))}
      />,
    );

    expect(screen.getByText("Global team template config")).toBeInTheDocument();
    expect(screen.getByText("这里改的是 team template 本身，只影响之后新建的 room。当前 room 里的 member 实例不会被回写。")).toBeInTheDocument();
    expect(screen.getByText("Config directory: /tmp/openaquarium")).toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: /Template name/i }));
    await user.type(screen.getByRole("textbox", { name: /Template name/i }), "Product Pod v2");
    await user.click(screen.getByRole("button", { name: /Forge Crab/i }));
    await user.clear(screen.getByRole("textbox", { name: /^Summary$/i }));
    await user.type(screen.getByRole("textbox", { name: /^Summary$/i }), "新的全局 builder summary");
    await user.click(screen.getByRole("button", { name: /Save team template config/i }));

    expect(onSaveConfig).toHaveBeenCalledTimes(1);
    const savedPayload = onSaveConfig.mock.calls[0]?.[0] as SavedTemplatePayload | undefined;

    expect(savedPayload).toMatchObject({
      templateId: template.id,
      name: "Product Pod v2",
    });
    expect(savedPayload?.members.find((member) => member.handle === "builder")?.summary).toBe("新的全局 builder summary");
    expect(screen.getByTestId("template-summary-card")).toHaveClass("border-b");
    expect(screen.getByTestId("template-members-scroll")).toHaveClass("overflow-y-auto");
  });

  it("supports template chat and global model editing surfaces", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const onSendChat = vi.fn(() => Promise.resolve({
      assistantMessage: "Builder switched to a QA-focused prompt.",
      modelProfileId: "model-codex-acp-default",
    }));

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={onSendChat}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    expect(
      screen.getAllByText((_, node) => node?.textContent?.includes("By default, the model edits the selected team template, Product Pod.") ?? false).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/新建一个只包含 lead 和 builder 的 team template/i)).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "Make builder more QA focused");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(onSendChat).toHaveBeenCalledWith({
      templateId: templates[0]?.id,
      messages: [{ role: "user", content: "Make builder more QA focused" }],
      modelProfileId: "model-codex-acp-default",
    });
    expect(await screen.findByText("Builder switched to a QA-focused prompt.")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /Models/i }));
    expect(screen.getByRole("button", { name: /Add model/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save global config/i })).toBeInTheDocument();
    expect(screen.getByTestId("template-models-scroll")).toHaveClass("overflow-y-auto");
  });

  it("shows a pending state while team template chat is running", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    let resolveChat: ((value: { assistantMessage: string; modelProfileId: string }) => void) | undefined;
    const onSendChat = vi.fn(
      () =>
        new Promise<{ assistantMessage: string; modelProfileId: string }>((resolve) => {
          resolveChat = resolve;
        }),
    );

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={onSendChat}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "把 builder 改成 QA lead");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(screen.getByTestId("template-chat-pending")).toBeInTheDocument();
    expect(screen.getByText("Updating team template…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Updating team template/i })).toBeDisabled();

    resolveChat?.({
      assistantMessage: "Builder now leans QA.",
      modelProfileId: "model-codex-acp-default",
    });

    expect(await screen.findByText("Builder now leans QA.")).toBeInTheDocument();
  });

  it("lets users switch away from the room template and chat about another template", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const onSendChat = vi.fn(() => Promise.resolve({
      assistantMessage: "Updated incident pod.",
      modelProfileId: "model-codex-acp-default",
    }));

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={onSendChat}
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
    expect(
      screen.getAllByText((_, node) => node?.textContent?.includes("By default, the model edits the selected team template, Incident Pod.") ?? false).length,
    ).toBeGreaterThan(0);

    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "Tighten the incident workflow");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(onSendChat).toHaveBeenCalledWith({
      templateId: incidentTemplate.id,
      messages: [{ role: "user", content: "Tighten the incident workflow" }],
      modelProfileId: "model-codex-acp-default",
    });
    expect(await screen.findByText("Updated incident pod.")).toBeInTheDocument();
  });

  it("keeps template chat input stable while typing before send", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={vi.fn(() => Promise.resolve({
          assistantMessage: "ack",
          modelProfileId: "model-codex-acp-default",
        }))}
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
    const onSendChat = vi.fn()
      .mockResolvedValueOnce({
        assistantMessage: "First change applied.",
        modelProfileId: "model-codex-acp-default",
      })
      .mockResolvedValueOnce({
        assistantMessage: "Second change applied.",
        modelProfileId: "model-codex-acp-default",
      });

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={onSendChat}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /Chat/i }));
    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "把 builder 改成 QA lead");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));
    expect(await screen.findByText("First change applied.")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: /Template chat input/i }), "再把描述缩短");
    await user.click(screen.getByRole("button", { name: /Send change request/i }));

    expect(onSendChat.mock.calls[1]?.[0]).toEqual({
      templateId: templates[0]?.id,
      messages: [
        { role: "user", content: "把 builder 改成 QA lead" },
        { role: "assistant", content: "First change applied." },
        { role: "user", content: "再把描述缩短" },
      ],
      modelProfileId: "model-codex-acp-default",
    });
    expect(await screen.findByText("Second change applied.")).toBeInTheDocument();
  });

  it("confirms and triggers template deletion from the list", async () => {
    const user = userEvent.setup();
    const snapshot = createSeedWorkspace();
    const templates = snapshot.templateOrder.map((templateId) => snapshot.templates[templateId]);
    const onDeleteTemplate = vi.fn(() => Promise.resolve());

    render(
      <TemplateStudioDialog
        open
        templates={templates}
        selectedTemplateId={templates[0]?.id}
        globalConfig={createDefaultGlobalWorkspaceConfig("/tmp/openaquarium")}
        onClose={vi.fn()}
        onDeleteTemplate={onDeleteTemplate}
        onSaveConfig={vi.fn()}
        onSaveGlobalConfig={vi.fn()}
        onSendChat={vi.fn(() => Promise.resolve({
          assistantMessage: "ack",
          modelProfileId: "model-codex-acp-default",
        }))}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Delete Incident Pod" }));
    expect(screen.getByRole("button", { name: "Cancel deleting Incident Pod" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Incident Pod" }));

    expect(onDeleteTemplate).toHaveBeenCalledWith("template-incident-pod");
  });
});
