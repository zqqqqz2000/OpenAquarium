import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatTransport } from "ai";
import { toast } from "sonner";

import { ArrowUp, Bot, LoaderCircle, MessageSquare, Plus, Save, Settings2, Sparkles, Star, Trash2, X } from "lucide-react";

import type {
  GlobalWorkspaceConfig,
  TeamTemplate,
  TemplateStudioModelCatalog,
  UpdateGlobalConfigInput,
  UpdateTemplateInput,
} from "@/domain/model";
import { addEmptyModelProfileDraft, buildGlobalConfigInput, createGlobalConfigDraft, type GlobalConfigDraft, type ModelProfileDraft } from "@/lib/global-config-draft";
import { WorkspaceRuntimeClient, resolveWorkspaceRuntimeBaseUrl } from "@/lib/runtime-client";
import { AllowedSkillSelector } from "@/components/skills/allowed-skill-selector";
import {
  addEmptyTemplateMemberDraft,
  buildTemplateConfigInput,
  createTemplateConfigDraft,
  removeTemplateMemberDraft,
  type TemplateConfigDraft,
  type TemplateMemberDraft,
} from "@/lib/template-config-draft";
import type { TemplateStudioChatDataParts, TemplateStudioUIMessage } from "@/lib/template-studio-ui-message";
import { getTemplateStudioMessageText, sanitizeTemplateStudioMessages } from "@/lib/template-studio-ui-message";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ProviderModelSelects } from "@/components/members/provider-model-selects";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

const ACCENT_TONES = ["paper", "postit", "blueprint", "correction"] as const;
const CODEX_THINKING_DEPTHS = ["low", "mid", "high", "extra-high"] as const;

function supportsCodexThinkingDepth(args: {
  modelProfileId?: string;
  globalConfig: GlobalWorkspaceConfig;
}): boolean {
  return args.globalConfig.modelProfiles.find((profile) => profile.id === args.modelProfileId)?.binding.kind === "codex-acp";
}

function ScopeNote(props: { directory: string }) {
  return (
    <Card size="sm" className="rounded-2xl border-dashed bg-muted/25 shadow-none">
      <CardHeader className="gap-1">
        <CardTitle className="text-sm font-medium">Global team template config</CardTitle>
        <CardDescription className="text-sm leading-6">
          这里改的是 team template 本身，只影响之后新建的 room。当前 room 里的 member 实例不会被回写。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="m-0 text-xs text-muted-foreground">Config directory: {props.directory}</p>
      </CardContent>
    </Card>
  );
}

function TemplateDeleteTrigger(props: {
  deleting: boolean;
  template: TeamTemplate;
  onConfirm: () => void;
}) {
  const { deleting, template, onConfirm } = props;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${template.name}`}
          disabled={deleting}
        >
          {deleting ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{`Delete ${template.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the template from workspace defaults. Existing rooms keep their copied team config.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" size="sm" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MemberDeleteTrigger(props: {
  disabled: boolean;
  member: TemplateMemberDraft;
  onConfirm: () => void;
}) {
  const { disabled, member, onConfirm } = props;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Delete ${member.name}`}
          disabled={disabled}
        >
          <Trash2 size={14} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{`Delete ${member.name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the member defaults from the template. Existing rooms keep their current member config.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" size="sm" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function resolveProfileLabel(args: {
  modelProfileId?: string;
  providerLabel: string;
  globalConfig: GlobalWorkspaceConfig;
}): string {
  if (args.modelProfileId) {
    return args.globalConfig.modelProfiles.find((profile) => profile.id === args.modelProfileId)?.name ?? args.modelProfileId;
  }

  return `${args.providerLabel} (legacy)`;
}

function formatProviderTypeLabel(providerType: string): string {
  switch (providerType) {
    case "acp":
      return "ACP";
    default:
      return providerType;
  }
}

function isToastInteractionTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && Boolean(target.closest("[data-sonner-toaster], [data-sonner-toast], [data-close-button]"));
}

function isTemplateDraftDirty(template: TeamTemplate, draft: TemplateConfigDraft): boolean {
  return JSON.stringify(buildTemplateConfigInput(template, draft)) !== JSON.stringify(buildTemplateConfigInput(template, createTemplateConfigDraft(template)));
}

function isGlobalConfigDraftDirty(globalConfig: GlobalWorkspaceConfig, draft: GlobalConfigDraft): boolean {
  return JSON.stringify(buildGlobalConfigInput(globalConfig, draft)) !== JSON.stringify(buildGlobalConfigInput(globalConfig, createGlobalConfigDraft(globalConfig)));
}

function InlineHint(props: { content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border px-1 text-[11px] font-semibold leading-none text-muted-foreground"
          aria-label="Show help"
        >
          !!
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-72 text-sm leading-6">
        {props.content}
      </TooltipContent>
    </Tooltip>
  );
}

function ModelProfileEditor(props: {
  draft: ModelProfileDraft;
  disableRemove: boolean;
  onChange: (patch: Partial<ModelProfileDraft>) => void;
  onRemove: () => void;
}) {
  const { draft, disableRemove, onChange, onRemove } = props;

  return (
    <Card className="rounded-2xl border-border/70 bg-background/70 shadow-none">
      <CardHeader className="gap-3">
        <div>
          <CardTitle className="text-lg tracking-tight">Provider profile</CardTitle>
          <CardDescription>Provider config lives here. Team templates still pick model profiles and thinking depth separately.</CardDescription>
        </div>
        <CardAction>
          <Button size="sm" variant="ghost" disabled={disableRemove} onClick={onRemove}>
            <Trash2 size={16} />
            Remove
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Model name</span>
            <Input value={draft.name} onChange={(event) => onChange({ name: event.currentTarget.value })} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Provider kind</span>
            <Select value={draft.providerKind} onValueChange={(value) => onChange({ providerKind: value as ModelProfileDraft["providerKind"] })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="codex-acp">codex-acp</SelectItem>
                <SelectItem value="generic-acp">generic-acp</SelectItem>
              </SelectContent>
            </Select>
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Description</span>
          <Textarea className="min-h-20" value={draft.description} onChange={(event) => onChange({ description: event.currentTarget.value })} />
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Provider label</span>
            <Input value={draft.providerLabel} onChange={(event) => onChange({ providerLabel: event.currentTarget.value })} />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Provider command</span>
            <Input value={draft.providerCommand} onChange={(event) => onChange({ providerCommand: event.currentTarget.value })} />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Args (one per line)</span>
          <Textarea className="min-h-24" value={draft.providerArgsText} onChange={(event) => onChange({ providerArgsText: event.currentTarget.value })} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Capabilities (comma or newline separated)</span>
          <Textarea className="min-h-20" value={draft.providerCapabilitiesText} onChange={(event) => onChange({ providerCapabilitiesText: event.currentTarget.value })} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Working directory</span>
          <Input value={draft.providerWorkingDirectory} onChange={(event) => onChange({ providerWorkingDirectory: event.currentTarget.value })} />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Environment (KEY=VALUE per line)</span>
          <Textarea className="min-h-24" value={draft.providerEnvText} onChange={(event) => onChange({ providerEnvText: event.currentTarget.value })} />
        </label>
      </CardContent>
    </Card>
  );
}

function TemplateStudioChatPanel(props: {
  template: TeamTemplate;
  globalConfig: GlobalWorkspaceConfig;
  input: string;
  initialMessages: TemplateStudioUIMessage[];
  modelProfileId?: string;
  modelId?: string;
  stoppedMessageId?: string;
  chatTransport?: ChatTransport<TemplateStudioUIMessage>;
  onInputChange: (value: string) => void;
  onMessagesChange: (messages: TemplateStudioUIMessage[]) => void;
  onModelProfileChange: (modelProfileId: string) => void;
  onModelIdChange: (modelId?: string) => void;
  onStoppedMessageChange: (messageId?: string) => void;
  onSync: (payload: TemplateStudioChatDataParts["templateStudioSync"]) => void;
}) {
  const {
    template,
    globalConfig,
    input,
    initialMessages,
    modelProfileId,
    modelId,
    stoppedMessageId,
    chatTransport,
    onInputChange,
    onMessagesChange,
    onModelProfileChange,
    onModelIdChange,
    onStoppedMessageChange,
    onSync,
  } = props;
  const chatLogRootRef = useRef<HTMLDivElement | null>(null);
  const onMessagesChangeRef = useRef(onMessagesChange);
  const onModelProfileChangeRef = useRef(onModelProfileChange);
  const onModelIdChangeRef = useRef(onModelIdChange);
  const runtimeClient = useMemo(() => new WorkspaceRuntimeClient(), []);
  const normalizedInitialMessages = useMemo(
    () => sanitizeTemplateStudioMessages(initialMessages),
    [initialMessages],
  );
  const messagesRef = useRef(normalizedInitialMessages);
  const resolvedTransport = useMemo<ChatTransport<TemplateStudioUIMessage>>(
    () =>
      chatTransport
      ?? new DefaultChatTransport<TemplateStudioUIMessage>({
        api: `${resolveWorkspaceRuntimeBaseUrl()}/api/template-studio/chat`,
      }),
    [chatTransport],
  );

  const {
    messages,
    setMessages,
    status,
    error,
    sendMessage,
    stop,
  } = useChat<TemplateStudioUIMessage>({
    id: `template-studio-${template.id}`,
    messages: normalizedInitialMessages,
    transport: resolvedTransport,
    onData(part) {
      if (part.type !== "data-templateStudioSync") {
        return;
      }

      onStoppedMessageChange(undefined);
      onSync(part.data as TemplateStudioChatDataParts["templateStudioSync"]);
    },
    onFinish({ message, isAbort }) {
      const messageText = getTemplateStudioMessageText(message).trim();
      if (isAbort && message.parts.length === 0) {
        const sanitizedMessages = sanitizeTemplateStudioMessages(messagesRef.current);
        if (sanitizedMessages !== messagesRef.current) {
          setMessages(sanitizedMessages);
        }
        onStoppedMessageChange(undefined);
        return;
      }

      if (isAbort && messageText.length > 0) {
        onStoppedMessageChange(message.id);
        return;
      }

      if (!isAbort) {
        onStoppedMessageChange(undefined);
      }
    },
  });

  const isBusy = status === "submitted" || status === "streaming";
  const [modelCatalog, setModelCatalog] = useState<TemplateStudioModelCatalog | undefined>(undefined);
  const [modelCatalogError, setModelCatalogError] = useState<string | undefined>(undefined);
  const [loadingModelCatalog, setLoadingModelCatalog] = useState(false);
  const pendingWithoutAssistant = isBusy && messages[messages.length - 1]?.role !== "assistant";
  const latestMessage = messages.at(-1);
  const waitingForFirstAssistantToken =
    isBusy
    && latestMessage?.role === "assistant"
    && getTemplateStudioMessageText(latestMessage).trim().length === 0
    && stoppedMessageId !== latestMessage.id;

  useEffect(() => {
    onMessagesChangeRef.current = onMessagesChange;
  }, [onMessagesChange]);

  useEffect(() => {
    onModelProfileChangeRef.current = onModelProfileChange;
    onModelIdChangeRef.current = onModelIdChange;
  }, [onModelIdChange, onModelProfileChange]);

  useEffect(() => {
    messagesRef.current = messages;
    onMessagesChangeRef.current(messages);
  }, [messages]);

  useEffect(() => {
    const viewport = chatLogRootRef.current?.querySelector<HTMLDivElement>("[data-slot='scroll-area-viewport']");
    if (!viewport) {
      return;
    }

    viewport.scrollTop = viewport.scrollHeight;
  }, [messages, pendingWithoutAssistant]);

  useEffect(() => {
    let cancelled = false;
    setLoadingModelCatalog(true);
    setModelCatalogError(undefined);

    void runtimeClient.getTemplateStudioModels({ modelProfileId }).then((catalog) => {
      if (cancelled) {
        return;
      }

      setModelCatalog(catalog);

      if (catalog.source === "runtime") {
        if (!modelId) {
          onModelIdChangeRef.current(catalog.currentModelId ?? catalog.availableModels[0]?.id);
        }
        return;
      }

      if (modelId) {
        onModelIdChangeRef.current(undefined);
      }
    }).catch((error) => {
      if (!cancelled) {
        setModelCatalog(undefined);
        setModelCatalogError(error instanceof Error ? error.message : String(error));
      }
    }).finally(() => {
      if (!cancelled) {
        setLoadingModelCatalog(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [modelId, modelProfileId, runtimeClient]);

  const selectedModelValue =
    modelCatalog?.source === "runtime"
      ? (modelId ?? modelCatalog.currentModelId ?? modelCatalog.availableModels[0]?.id)
      : undefined;

  const submit = async (): Promise<void> => {
    const nextInput = input.trim();
    if (nextInput.length === 0 || isBusy) {
      return;
    }

    onInputChange("");
    onStoppedMessageChange(undefined);
    try {
      const sanitizedMessages = sanitizeTemplateStudioMessages(messages);
      if (sanitizedMessages !== messages) {
        setMessages(sanitizedMessages);
      }

      await sendMessage(
        { text: nextInput },
        {
          body: {
            templateId: template.id,
            modelProfileId,
            modelId: modelCatalog?.source === "runtime" ? selectedModelValue : undefined,
          },
        },
      );
    } catch (caughtError) {
      void caughtError;
      onInputChange(nextInput);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void submit();
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 pt-4">
      <section className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Bot size={18} />
            <p className="m-0 text-base font-semibold tracking-tight">Team Builder</p>
          </div>
          <p className="m-0 text-sm leading-6 text-muted-foreground">
            默认修改 <span className="font-medium">{template.name}</span>。要新建 template，直接说。
          </p>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
        <div ref={chatLogRootRef} className="min-h-0 flex-1">
          <ScrollArea className="h-full pr-1" data-testid="template-chat-log" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex min-h-[16rem] items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                直接说要改什么就行，比如“把 checker 改成 QA reviewer”或“新建一个 incident template”。
              </div>
            ) : (
              <div className="flex flex-col gap-3 pr-3">
                {messages.map((message) => {
                  const content = getTemplateStudioMessageText(message);
                  const showStoppedBadge = message.role === "assistant" && stoppedMessageId === message.id;
                  const showFirstTokenPlaceholder =
                    waitingForFirstAssistantToken
                    && latestMessage?.id === message.id
                    && message.role === "assistant";

                  if (content.trim().length === 0 && !showStoppedBadge && !showFirstTokenPlaceholder) {
                    return null;
                  }

                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm",
                        message.role === "user"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      )}
                    >
                      {showFirstTokenPlaceholder ? (
                        <Skeleton
                          className="h-6 min-w-16 rounded-full bg-foreground/10"
                          data-testid="template-chat-first-token-placeholder"
                        />
                      ) : (
                        content
                      )}
                      {showStoppedBadge ? <p className="m-0 mt-2 text-xs text-muted-foreground">Stopped before completion.</p> : null}
                    </div>
                  );
                })}
              </div>
            )}
            {pendingWithoutAssistant ? (
              <div className="mt-3 max-w-[85%] rounded-2xl border border-border/70 bg-muted/60 px-4 py-3 text-sm text-foreground shadow-sm" data-testid="template-chat-pending">
                <div className="flex items-start gap-3">
                  <LoaderCircle size={16} className="mt-0.5 animate-spin text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="m-0 font-medium">Updating team template…</p>
                    <p className="m-0 text-sm text-muted-foreground">
                      Codex ACP may take around 30 seconds while it reads and edits the config files.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </ScrollArea>
        </div>

        {error ? <p className="m-0 text-sm text-destructive">{error.message}</p> : null}

        <div className="overflow-visible rounded-[1.75rem] border border-border/70 bg-card/95 shadow-sm">
          <div className="flex flex-col gap-2 p-3 md:p-3.5">
            <Textarea
              aria-label="Template chat input"
              className="min-h-20 resize-none border-0 bg-transparent px-0 py-0 text-[1.05rem] leading-7 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0"
              placeholder="默认修改当前 template；要新建直接说。"
              value={input}
              onChange={(event) => onInputChange(event.currentTarget.value)}
              onKeyDown={handleComposerKeyDown}
            />
            <div className="flex flex-col gap-3 border-t border-border/50 pt-2 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-row md:items-center">
                <label className="flex min-w-0 flex-1 flex-col gap-2 md:max-w-[12rem]">
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Provider</span>
                  <Select value="acp" disabled>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="acp">{formatProviderTypeLabel("acp")}</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex min-w-0 flex-1 flex-col gap-2 md:max-w-[16rem]">
                  <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Model</span>
                  <Select
                    value={selectedModelValue}
                    onValueChange={(value) => {
                      if (modelCatalog?.source === "runtime") {
                        onModelIdChange(value);
                      }
                    }}
                    disabled={isBusy || loadingModelCatalog || !modelCatalog || modelCatalog.source !== "runtime" || modelCatalog.availableModels.length === 0}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={loadingModelCatalog ? "Loading models…" : modelCatalog?.source === "unavailable" ? "Runtime models unavailable" : "Select model"} />
                    </SelectTrigger>
                    <SelectContent>
                      {modelCatalog?.availableModels.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                          {modelCatalog.source === "runtime" && modelCatalog.currentModelId === option.id ? " (Current)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <Button
                aria-label={isBusy ? "Stop" : "Send change request"}
                className="size-10 shrink-0 rounded-full bg-primary text-primary-foreground hover:bg-primary/88 disabled:bg-muted disabled:text-muted-foreground"
                disabled={!isBusy && input.trim().length === 0}
                size="icon"
                type="button"
                onClick={() => {
                  if (isBusy) {
                    void stop();
                    return;
                  }
                  void submit();
                }}
              >
                {isBusy ? <X size={18} /> : <ArrowUp size={18} />}
                <span className="sr-only">{isBusy ? "Stop" : "Send change request"}</span>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                Provider profile: {globalConfig.modelProfiles.find((profile) => profile.id === modelProfileId)?.name ?? "Not set"}
              </span>
              {loadingModelCatalog ? <span>Checking runtime models…</span> : null}
              {!loadingModelCatalog && modelCatalog?.source === "runtime" ? (
                <span>Model list comes from the current {modelCatalog.providerLabel} session.</span>
              ) : null}
              {!loadingModelCatalog && modelCatalog?.source === "unavailable" ? (
                <span className="text-destructive">{modelCatalog.unavailableMessage ?? "Runtime model capability unavailable."}</span>
              ) : null}
              {modelCatalogError ? <span className="text-destructive">{modelCatalogError}</span> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function TemplateStudioDialog(props: {
  open: boolean;
  templates: TeamTemplate[];
  selectedTemplateId?: string;
  globalConfig?: GlobalWorkspaceConfig;
  onClose: () => void;
  deletingTemplateId?: string;
  onDeleteTemplate: (templateId: string) => void | Promise<void>;
  onSaveConfig: (input: UpdateTemplateInput) => void | Promise<void>;
  onSaveGlobalConfig: (input: UpdateGlobalConfigInput) => void | Promise<void>;
  onApplyChatSync?: (payload: TemplateStudioChatDataParts["templateStudioSync"]) => void;
  chatTransport?: ChatTransport<TemplateStudioUIMessage>;
}) {
  const {
    open,
    templates,
    selectedTemplateId,
    globalConfig: incomingGlobalConfig,
    onClose,
    deletingTemplateId,
    onDeleteTemplate,
    onSaveConfig,
    onSaveGlobalConfig,
    onApplyChatSync,
    chatTransport,
  } = props;
  const globalConfig = incomingGlobalConfig ?? createDefaultGlobalWorkspaceConfig();
  const templatesById = useMemo(() => Object.fromEntries(templates.map((template) => [template.id, template])), [templates]);
  const [activeTab, setActiveTab] = useState("templates");
  const [activeTemplateId, setActiveTemplateId] = useState<string | undefined>(selectedTemplateId ?? templates[0]?.id);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplateConfigDraft>>({});
  const [activeMemberIds, setActiveMemberIds] = useState<Record<string, string>>({});
  const [templateErrorById, setTemplateErrorById] = useState<Record<string, string | undefined>>({});
  const [globalConfigDraft, setGlobalConfigDraft] = useState(() => createGlobalConfigDraft(globalConfig));
  const [activeModelProfileId, setActiveModelProfileId] = useState<string | undefined>(globalConfig.modelProfiles[0]?.id);
  const [globalConfigError, setGlobalConfigError] = useState<string | undefined>(undefined);
  const [chatMessagesByTemplate, setChatMessagesByTemplate] = useState<Record<string, TemplateStudioUIMessage[]>>({});
  const [chatInputByTemplate, setChatInputByTemplate] = useState<Record<string, string>>({});
  const [chatModelProfileIdByTemplate, setChatModelProfileIdByTemplate] = useState<Record<string, string | undefined>>({});
  const [chatModelIdByTemplate, setChatModelIdByTemplate] = useState<Record<string, string | undefined>>({});
  const [stoppedChatMessageIdByTemplate, setStoppedChatMessageIdByTemplate] = useState<Record<string, string | undefined>>({});
  const [templateDeleteError, setTemplateDeleteError] = useState<string | undefined>(undefined);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingGlobalConfig, setSavingGlobalConfig] = useState(false);
  const wasOpenRef = useRef(false);
  const previousSelectedTemplateIdRef = useRef<string | undefined>(undefined);

  const resetTemplateStudioState = (): void => {
    setActiveTab("templates");
    setTemplateDrafts({});
    setActiveMemberIds({});
    setTemplateErrorById({});
    setTemplateDeleteError(undefined);
    setSavingTemplate(false);
    setChatInputByTemplate({});
    setChatMessagesByTemplate({});
    setChatModelIdByTemplate({});
    setStoppedChatMessageIdByTemplate({});
  };

  useEffect(() => {
    const openedNow = open && !wasOpenRef.current;
    const selectedTemplateChanged = selectedTemplateId !== previousSelectedTemplateIdRef.current;

    wasOpenRef.current = open;
    previousSelectedTemplateIdRef.current = selectedTemplateId;

    if (!open) {
      resetTemplateStudioState();
      return;
    }

    if ((openedNow || selectedTemplateChanged) && selectedTemplateId && templatesById[selectedTemplateId]) {
      setActiveTemplateId(selectedTemplateId);
      return;
    }

    if (!activeTemplateId || !templatesById[activeTemplateId]) {
      setActiveTemplateId((selectedTemplateId && templatesById[selectedTemplateId]) ? selectedTemplateId : templates[0]?.id);
    }
  }, [activeTemplateId, open, selectedTemplateId, templates, templatesById]);

  useEffect(() => {
    setTemplateDrafts(Object.fromEntries(templates.map((template) => [template.id, createTemplateConfigDraft(template)])));
  }, [templates]);

  useEffect(() => {
    setGlobalConfigDraft(createGlobalConfigDraft(globalConfig));
    setActiveModelProfileId((current) => current ?? globalConfig.modelProfiles[0]?.id);
  }, [globalConfig]);

  useEffect(() => {
    if (!activeTemplateId || chatModelProfileIdByTemplate[activeTemplateId]) {
      return;
    }

    setChatModelProfileIdByTemplate((current) => ({
      ...current,
      [activeTemplateId]: globalConfig.templateChatModelProfileId ?? globalConfig.modelProfiles[0]?.id,
    }));
  }, [activeTemplateId, chatModelProfileIdByTemplate, globalConfig.modelProfiles, globalConfig.templateChatModelProfileId]);

  const selectedTemplate = activeTemplateId ? templatesById[activeTemplateId] : undefined;
  const selectedTemplateDraft = selectedTemplate ? templateDrafts[selectedTemplate.id] ?? createTemplateConfigDraft(selectedTemplate) : undefined;
  const activeMemberId = selectedTemplate ? activeMemberIds[selectedTemplate.id] ?? selectedTemplateDraft?.members[0]?.id : undefined;
  const activeMember =
    selectedTemplateDraft?.members.find((member) => member.id === activeMemberId) ?? selectedTemplateDraft?.members[0];
  const templateBadge = selectedTemplateDraft ? badgeToneProps(selectedTemplateDraft.accentTone) : undefined;
  const activeChatInput = selectedTemplate ? chatInputByTemplate[selectedTemplate.id] ?? "" : "";
  const activeChatModelProfileId = selectedTemplate
    ? chatModelProfileIdByTemplate[selectedTemplate.id] ?? globalConfig.templateChatModelProfileId ?? globalConfig.modelProfiles[0]?.id
    : undefined;
  const activeChatModelId = selectedTemplate ? chatModelIdByTemplate[selectedTemplate.id] : undefined;
  const activeModelProfile = globalConfigDraft.modelProfiles.find((profile) => profile.id === activeModelProfileId) ?? globalConfigDraft.modelProfiles[0];
  const selectedTemplateDirty = selectedTemplate && selectedTemplateDraft
    ? isTemplateDraftDirty(selectedTemplate, selectedTemplateDraft)
    : false;
  const globalConfigDirty = isGlobalConfigDraftDirty(globalConfig, globalConfigDraft);

  if (!open) {
    return null;
  }

  const patchTemplateDraft = (templateId: string, patch: Partial<TemplateConfigDraft>): void => {
    const template = templatesById[templateId];
    if (!template) {
      return;
    }

    setTemplateDrafts((current) => {
      const base = current[templateId] ?? createTemplateConfigDraft(template);
      return {
        ...current,
        [templateId]: {
          ...base,
          ...patch,
        },
      };
    });
  };

  const patchMemberDraft = (templateId: string, memberId: string, patch: Partial<TemplateMemberDraft>): void => {
    const template = templatesById[templateId];
    if (!template) {
      return;
    }

    setTemplateDrafts((current) => {
      const base = current[templateId] ?? createTemplateConfigDraft(template);
      return {
        ...current,
        [templateId]: {
          ...base,
          members: base.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member)),
        },
      };
    });
  };

  const setEntryMember = (templateId: string, memberId: string): void => {
    const template = templatesById[templateId];
    if (!template) {
      return;
    }

    setTemplateDrafts((current) => {
      const base = current[templateId] ?? createTemplateConfigDraft(template);
      return {
        ...current,
        [templateId]: {
          ...base,
          members: base.members.map((member) => ({
            ...member,
            isEntryMember: member.id === memberId,
          })),
        },
      };
    });
  };

  const setRoleEnabled = (templateId: string, memberId: string, checked: boolean): void => {
    const template = templatesById[templateId];
    if (!template) {
      return;
    }

    const base = templateDrafts[templateId] ?? createTemplateConfigDraft(template);
    const member = base.members.find((candidate) => candidate.id === memberId);
    if (!member) {
      return;
    }

    patchMemberDraft(templateId, memberId, {
      isRole: checked,
      watchEnabled: checked ? false : member.watchEnabled,
      watchPersistent: checked ? false : member.watchPersistent,
    });
  };

  const addMemberDraft = (templateId: string): void => {
    const template = templatesById[templateId];
    if (!template) {
      return;
    }

    const baseDraft = templateDrafts[templateId] ?? createTemplateConfigDraft(template);
    const baseMemberId = activeMemberIds[templateId] ?? baseDraft.members[0]?.id;
    const baseMember = baseDraft.members.find((member) => member.id === baseMemberId) ?? baseDraft.members[0];
    const nextMembers = addEmptyTemplateMemberDraft(baseDraft.members, {
      templateAccentTone: baseDraft.accentTone,
      baseMember,
    });
    const nextMember = nextMembers.at(-1);
    if (!nextMember) {
      return;
    }

    setTemplateDrafts((current) => ({
      ...current,
      [templateId]: {
        ...baseDraft,
        defaultVisibleMemberBlueprintIds: [...baseDraft.defaultVisibleMemberBlueprintIds, nextMember.id],
        members: nextMembers,
      },
    }));
    setActiveMemberIds((current) => ({
      ...current,
      [templateId]: nextMember.id,
    }));
  };

  const deleteMemberDraft = (templateId: string, memberId: string): void => {
    const template = templatesById[templateId];
    if (!template) {
      return;
    }

    const baseDraft = templateDrafts[templateId] ?? createTemplateConfigDraft(template);
    const nextMembers = removeTemplateMemberDraft(baseDraft.members, memberId);
    const nextActiveMember = nextMembers.find((member) => member.id === activeMemberIds[templateId]) ?? nextMembers[0];

    setTemplateDrafts((current) => ({
      ...current,
      [templateId]: {
        ...baseDraft,
        defaultVisibleMemberBlueprintIds: baseDraft.defaultVisibleMemberBlueprintIds.filter((visibleMemberId) => visibleMemberId !== memberId),
        members: nextMembers,
      },
    }));
    setActiveMemberIds((current) => ({
      ...current,
      [templateId]: nextActiveMember?.id,
    }));
  };

  const saveTemplateConfig = async (): Promise<void> => {
    if (!selectedTemplate || !selectedTemplateDraft) {
      return;
    }

    try {
      setSavingTemplate(true);
      setTemplateErrorById((current) => ({
        ...current,
        [selectedTemplate.id]: undefined,
      }));
      await onSaveConfig(buildTemplateConfigInput(selectedTemplate, selectedTemplateDraft));
      toast.success("Saved", {
        description: `${selectedTemplateDraft.name} updated.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTemplateErrorById((current) => ({
        ...current,
        [selectedTemplate.id]: message,
      }));
      toast.error("Save failed", {
        description: message,
      });
    } finally {
      setSavingTemplate(false);
    }
  };

  const saveGlobalConfig = async (): Promise<void> => {
    try {
      setSavingGlobalConfig(true);
      setGlobalConfigError(undefined);
      await onSaveGlobalConfig(buildGlobalConfigInput(globalConfig, globalConfigDraft));
      toast.success("Saved", {
        description: "Global model settings updated.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setGlobalConfigError(message);
      toast.error("Save failed", {
        description: message,
      });
    } finally {
      setSavingGlobalConfig(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string): Promise<void> => {
    const templateName = templatesById[templateId]?.name ?? templateId;
    try {
      setTemplateDeleteError(undefined);
      await onDeleteTemplate(templateId);
      toast.success("Deleted", {
        description: `${templateName} removed.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTemplateDeleteError(message);
      toast.error("Delete failed", {
        description: message,
      });
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetTemplateStudioState();
          onClose();
        }
      }}
    >
      <DialogContent
        className="grid h-[94vh] w-[min(96vw,1360px)] max-w-[1360px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[1360px]"
        showCloseButton={false}
        onFocusOutside={(event) => {
          if (isToastInteractionTarget(event.target)) {
            event.preventDefault();
          }
        }}
        onInteractOutside={(event) => {
          if (isToastInteractionTarget(event.target)) {
            event.preventDefault();
          }
        }}
      >
        <div className="border-b border-border px-5 py-4">
          <DialogHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-2xl font-semibold tracking-tight">Team Template Studio</DialogTitle>
              <DialogDescription className="sr-only">Edit global team templates, provider profiles, and Team Builder instructions.</DialogDescription>
              <p className="m-0 text-sm text-muted-foreground">Global config lives in {globalConfig.directory}.</p>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close template studio">
                <span aria-hidden>×</span>
              </Button>
            </DialogClose>
          </DialogHeader>
        </div>

        <div className="grid min-h-0 gap-0 overflow-hidden p-3 lg:grid-cols-[300px_minmax(0,1fr)] lg:p-4">
          <div className="flex min-h-0 flex-col overflow-hidden border-b border-border/60 pb-3 lg:border-r lg:border-b-0 lg:pb-0 lg:pr-4">
            <section className="shrink-0 border-b border-border/60 pb-4" data-testid="template-summary-card">
              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Settings2 size={18} />
                    <p className="m-0 text-lg font-semibold tracking-tight">Workspace defaults</p>
                  </div>
                  <p className="m-0 text-sm leading-6 text-muted-foreground">
                    这里统一管理 team templates、Team Builder 和全局 provider profiles。
                  </p>
                </div>
                <ScopeNote directory={globalConfig.directory} />
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-base font-semibold tracking-tight">Team templates</p>
                <Badge variant="outline">{templates.length}</Badge>
              </div>
              {templateDeleteError ? <p className="m-0 mt-3 text-sm text-destructive">{templateDeleteError}</p> : null}
              <ScrollArea className="mt-3 min-h-0 flex-1" data-testid="template-list-scroll">
                <div className="flex flex-col gap-2 pr-3">
                  {templates.map((template) => {
                    const tone = badgeToneProps(template.accentTone);
                    const isActive = template.id === selectedTemplate?.id;

                    return (
                      <div
                        key={template.id}
                        className={cn(
                          "flex items-start gap-2 rounded-xl border border-border/70 px-3 py-3 transition-colors",
                          isActive && "border-ring bg-accent/10",
                        )}
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left"
                          onClick={() => {
                            setTemplateDeleteError(undefined);
                            setActiveTemplateId(template.id);
                          }}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="m-0 text-sm font-semibold">{template.name}</p>
                            <Badge variant={tone.variant} className={tone.className}>
                              {template.members.length}
                            </Badge>
                          </div>
                          <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{template.description}</p>
                        </button>
                        <TemplateDeleteTrigger
                          deleting={deletingTemplateId === template.id}
                          template={template}
                          onConfirm={() => void handleDeleteTemplate(template.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </section>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-col overflow-hidden lg:pl-4">
            <TabsList variant="line" className="h-auto w-full justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger value="templates" className="rounded-none px-3 py-2">
                <Settings2 size={16} />
                Team templates
              </TabsTrigger>
              <TabsTrigger value="builder" className="rounded-none px-3 py-2">
                <MessageSquare size={16} />
                Team Builder
              </TabsTrigger>
              <TabsTrigger value="providers" className="rounded-none px-3 py-2">
                <Sparkles size={16} />
                Providers
              </TabsTrigger>
            </TabsList>

            <TabsContent value="templates" className="m-0 min-h-0 overflow-hidden">
              {!selectedTemplate || !selectedTemplateDraft ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a team template to edit.</div>
              ) : (
                <div className="grid h-full min-h-0 gap-4 pt-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <section className="min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="m-0 text-base font-semibold tracking-tight">Team template members</p>
                          <Badge variant="outline">{selectedTemplateDraft.members.length}</Badge>
                        </div>
                        <Button size="sm" variant="secondary" type="button" onClick={() => addMemberDraft(selectedTemplate.id)}>
                          <Plus size={16} />
                          Add member
                        </Button>
                      </div>
                      <ScrollArea className="min-h-0 flex-1" data-testid="template-members-scroll">
                        <div className="flex flex-col gap-2 pr-3">
                          {selectedTemplateDraft.members.map((member) => {
                            const memberBadge = badgeToneProps(member.accentTone);
                            const sourceMember = selectedTemplate.members.find((candidate) => candidate.id === member.id);
                            const modelProfileLabel = resolveProfileLabel({
                              modelProfileId: member.modelProfileId,
                              providerLabel: sourceMember?.provider.label ?? "Provider",
                              globalConfig,
                            });
                            const canDeleteMember = selectedTemplateDraft.members.length > 1;

                            return (
                              <div
                                key={member.id}
                                className={cn(
                                  "flex items-start gap-2 rounded-xl border border-border/70 px-3 py-3 transition-colors",
                                  member.id === activeMember?.id && "border-ring bg-accent/10",
                                )}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left"
                                  onClick={() => {
                                    setActiveMemberIds((current) => ({ ...current, [selectedTemplate.id]: member.id }));
                                  }}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="m-0 text-sm font-semibold">{member.name}</p>
                                    <Badge variant="outline">@{member.handle}</Badge>
                                    {member.isEntryMember ? <Badge variant="secondary">Entry</Badge> : null}
                                    <Badge variant={memberBadge.variant} className={memberBadge.className}>
                                      {modelProfileLabel}
                                    </Badge>
                                  </div>
                                  <p className="m-0 mt-2 text-sm text-muted-foreground">{member.summary}</p>
                                </button>
                                <MemberDeleteTrigger
                                  disabled={!canDeleteMember}
                                  member={member}
                                  onConfirm={() => deleteMemberDraft(selectedTemplate.id, member.id)}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>
                  </section>

                  <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
                    <ScrollArea className="min-h-0 h-full" data-testid="template-detail-scroll">
                      <div className="flex flex-col gap-4 pr-3 pb-4">
                      <section className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                        <div className="flex flex-col gap-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="m-0 text-lg font-semibold tracking-tight">{selectedTemplateDraft.name}</p>
                            {templateBadge ? (
                              <Badge variant={templateBadge.variant} className={templateBadge.className}>
                                {selectedTemplateDraft.members.length} members
                              </Badge>
                            ) : null}
                            {selectedTemplateDirty ? <Badge variant="secondary">Unsaved changes</Badge> : <Badge variant="outline">Saved to file</Badge>}
                          </div>
                          <label className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Team template name</span>
                            <Input value={selectedTemplateDraft.name} onChange={(event) => patchTemplateDraft(selectedTemplate.id, { name: event.currentTarget.value })} />
                          </label>
                          <label className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Description</span>
                            <Textarea
                              className="min-h-24"
                              value={selectedTemplateDraft.description}
                              onChange={(event) => patchTemplateDraft(selectedTemplate.id, { description: event.currentTarget.value })}
                            />
                          </label>
                          <label className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Accent tone</span>
                            <Select value={selectedTemplateDraft.accentTone} onValueChange={(value) => patchTemplateDraft(selectedTemplate.id, { accentTone: value as TeamTemplate["accentTone"] })}>
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select accent tone" />
                              </SelectTrigger>
                              <SelectContent>
                                {ACCENT_TONES.map((accentTone) => (
                                  <SelectItem key={accentTone} value={accentTone}>
                                    {accentTone}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </label>
                          <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Default visible members in new rooms</span>
                            <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-3">
                              {selectedTemplateDraft.members.map((member) => {
                                const visibleByDefault = selectedTemplateDraft.defaultVisibleMemberBlueprintIds.includes(member.id);

                                return (
                                  <label key={member.id} className="flex items-center justify-between gap-3 rounded-xl bg-background/80 px-3 py-2">
                                    <div className="min-w-0">
                                      <p className="m-0 truncate text-sm font-medium">{`@${member.handle}`}</p>
                                      <p className="m-0 truncate text-xs text-muted-foreground">{member.name}</p>
                                    </div>
                                    <Switch
                                      checked={visibleByDefault}
                                      onCheckedChange={(checked) =>
                                        patchTemplateDraft(selectedTemplate.id, {
                                          defaultVisibleMemberBlueprintIds: checked
                                            ? [...selectedTemplateDraft.defaultVisibleMemberBlueprintIds, member.id]
                                            : selectedTemplateDraft.defaultVisibleMemberBlueprintIds.filter((memberId) => memberId !== member.id),
                                        })}
                                      aria-label={`Toggle @${member.handle} default visibility`}
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </section>

                      {activeMember ? (
                        <section className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                          <div className="flex flex-col gap-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="m-0 text-lg font-semibold tracking-tight">Member defaults</p>
                                <p className="m-0 text-sm text-muted-foreground">Template members point at global model profiles instead of inline provider config.</p>
                              </div>
                              {activeMember.isEntryMember ? (
                                <Badge variant="secondary">Entry member</Badge>
                              ) : (
                                <Button size="sm" variant="secondary" onClick={() => setEntryMember(selectedTemplate.id, activeMember.id)}>
                                  <Star size={16} />
                                  Set as entry member
                                </Button>
                              )}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="flex flex-col gap-2">
                                <span className="text-sm font-medium">Name</span>
                                <Input value={activeMember.name} onChange={(event) => patchMemberDraft(selectedTemplate.id, activeMember.id, { name: event.currentTarget.value })} />
                              </label>
                              <label className="flex flex-col gap-2">
                                <span className="text-sm font-medium">Handle</span>
                                <Input value={activeMember.handle} onChange={(event) => patchMemberDraft(selectedTemplate.id, activeMember.id, { handle: event.currentTarget.value })} />
                              </label>
                            </div>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-medium">Summary</span>
                              <Input value={activeMember.summary} onChange={(event) => patchMemberDraft(selectedTemplate.id, activeMember.id, { summary: event.currentTarget.value })} />
                            </label>

                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-medium">Prompt</span>
                              <Textarea
                                className="min-h-36"
                                value={activeMember.prompt}
                                onChange={(event) => patchMemberDraft(selectedTemplate.id, activeMember.id, { prompt: event.currentTarget.value })}
                              />
                            </label>

                            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                              <span className="text-sm font-medium">Role owner</span>
                              <Switch
                                aria-label="Template role owner"
                                checked={activeMember.isRole}
                                onCheckedChange={(checked) => setRoleEnabled(selectedTemplate.id, activeMember.id, checked)}
                              />
                            </label>
                            <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                              {activeMember.isRole
                                ? "Role owner 会在新建 room 时成为可挂员工的岗位模板；同时不能带默认 Watch。"
                                : "关闭后，这个模板成员会变成普通成员，新建 room 时不能作为岗位 owner 扩编。"}
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <ProviderModelSelects
                                globalConfig={globalConfig}
                                modelProfileId={activeMember.modelProfileId}
                                modelId={activeMember.modelId}
                                onProviderChange={(value) => {
                                  const selectedProfile = globalConfig.modelProfiles.find((profile) => profile.id === value);
                                  patchMemberDraft(selectedTemplate.id, activeMember.id, {
                                    modelProfileId: value,
                                    provider: selectedProfile ? {
                                      ...selectedProfile.binding,
                                      args: [...selectedProfile.binding.args],
                                      env: { ...selectedProfile.binding.env },
                                      capabilities: [...selectedProfile.binding.capabilities],
                                    } : activeMember.provider,
                                  });
                                }}
                                onModelChange={(value) => patchMemberDraft(selectedTemplate.id, activeMember.id, { modelId: value })}
                              />
                            </div>
                            {supportsCodexThinkingDepth({
                              modelProfileId: activeMember.modelProfileId,
                              globalConfig,
                            }) ? (
                              <label className="flex flex-col gap-2">
                                <span className="text-sm font-medium">Codex thinking depth</span>
                                <Select
                                  value={activeMember.codexThinkingDepth ?? "high"}
                                  onValueChange={(value) => patchMemberDraft(selectedTemplate.id, activeMember.id, { codexThinkingDepth: value as (typeof CODEX_THINKING_DEPTHS)[number] })}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Select thinking depth" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CODEX_THINKING_DEPTHS.map((depth) => (
                                      <SelectItem key={depth} value={depth}>
                                        {depth}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </label>
                            ) : null}

                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                                <span className="flex items-center gap-2 text-sm font-medium">
                                  <span>Watch</span>
                                  <InlineHint content="新建 room 时，默认是否为这个模板成员创建常规 watcher。" />
                                </span>
                                <Switch
                                  aria-label="Template watcher enabled"
                                  checked={activeMember.watchEnabled}
                                  disabled={activeMember.isRole}
                                  onCheckedChange={(checked) =>
                                    patchMemberDraft(selectedTemplate.id, activeMember.id, {
                                      watchEnabled: checked,
                                      watchPersistent: checked ? activeMember.watchPersistent : false,
                                    })}
                                />
                              </label>
                              <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                                <span className="flex items-center gap-2 text-sm font-medium">
                                  <span>Persistent watch</span>
                                  <InlineHint content="新建 room 后，即使没有新变化，这个 watcher 也会按周期持续触发。" />
                                </span>
                                <Switch
                                  aria-label="Template persistent watch"
                                  checked={activeMember.watchPersistent}
                                  disabled={activeMember.isRole || !activeMember.watchEnabled}
                                  onCheckedChange={(checked) => patchMemberDraft(selectedTemplate.id, activeMember.id, { watchPersistent: checked })}
                                />
                              </label>
                              <label className="flex flex-col gap-2">
                                <span className="text-sm font-medium">Watcher interval</span>
                                <Input
                                  inputMode="numeric"
                                  value={activeMember.watchIntervalMinutes}
                                  disabled={activeMember.isRole || !activeMember.watchEnabled}
                                  onChange={(event) => patchMemberDraft(selectedTemplate.id, activeMember.id, { watchIntervalMinutes: event.currentTarget.value })}
                                />
                              </label>
                            </div>
                            <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                              {activeMember.isRole
                                ? "Role owner 不允许带默认 Watch。先关闭 Role owner，才能为这个模板成员配置 watcher。"
                                : "Watcher 默认值会在基于这个模板新建 room 时复制到成员实例。"}
                            </div>

                            <div className="flex flex-col gap-2">
                              <span className="text-sm font-medium">Allowed skill ids</span>
                              <AllowedSkillSelector
                                valueText={activeMember.allowedSkillIdsText}
                                onChangeText={(allowedSkillIdsText) =>
                                  patchMemberDraft(selectedTemplate.id, activeMember.id, {
                                    allowedSkillIdsText,
                                  })}
                                description="通过下拉选择成员可用 skill；运行时只暴露 skill id 和 `skills/<skill-id>/SKILL.md` 入口。"
                              />
                            </div>
                          </div>
                        </section>
                      ) : null}

                      </div>
                    </ScrollArea>
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-background/95 px-1 pt-4">
                      <div>
                        {templateErrorById[selectedTemplate.id] ? (
                          <p className="m-0 text-sm text-destructive">{templateErrorById[selectedTemplate.id]}</p>
                        ) : (
                          <p className="m-0 text-sm text-muted-foreground">
                            {selectedTemplateDirty ? "Unsaved changes are local until you save." : "This view matches the file on disk."}
                          </p>
                        )}
                      </div>
                      <Button onClick={() => void saveTemplateConfig()} disabled={savingTemplate || !selectedTemplateDirty}>
                        <Save size={16} />
                        Save
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="builder" forceMount className="m-0 min-h-0 overflow-hidden data-[state=inactive]:hidden">
              {!selectedTemplate ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a team template to open Team Builder.</div>
              ) : (
                <TemplateStudioChatPanel
                  key={selectedTemplate.id}
                  template={selectedTemplate}
                  globalConfig={globalConfig}
                  input={activeChatInput}
                  initialMessages={chatMessagesByTemplate[selectedTemplate.id] ?? []}
                  modelProfileId={activeChatModelProfileId}
                  modelId={activeChatModelId}
                  stoppedMessageId={stoppedChatMessageIdByTemplate[selectedTemplate.id]}
                  chatTransport={chatTransport}
                  onInputChange={(nextValue) =>
                    setChatInputByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: nextValue,
                    }))}
                  onMessagesChange={(messages) =>
                    setChatMessagesByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: messages,
                    }))}
                  onModelProfileChange={(value) =>
                    setChatModelProfileIdByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: value,
                    }))}
                  onModelIdChange={(value) =>
                    setChatModelIdByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: value,
                    }))}
                  onStoppedMessageChange={(messageId) =>
                    setStoppedChatMessageIdByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: messageId,
                    }))}
                  onSync={(payload) => {
                    onApplyChatSync?.(payload);
                    setChatModelProfileIdByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: payload.modelProfileId,
                    }));
                    setChatModelIdByTemplate((current) => ({
                      ...current,
                      [selectedTemplate.id]: payload.modelId,
                    }));
                  }}
                />
              )}
            </TabsContent>

            <TabsContent value="providers" className="m-0 min-h-0 overflow-hidden">
              <div className="grid h-full min-h-0 gap-4 pt-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                <section className="min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                  <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                    <div className="flex items-center justify-between gap-3">
                      <p className="m-0 text-base font-semibold tracking-tight">Provider profiles</p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const draft = addEmptyModelProfileDraft();
                          setGlobalConfigDraft((current) => ({
                            ...current,
                            modelProfiles: [...current.modelProfiles, draft],
                          }));
                          setActiveModelProfileId(draft.id);
                        }}
                      >
                        <Plus size={16} />
                        Add provider
                      </Button>
                    </div>

                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Default Team Builder provider profile</span>
                      <Select
                        value={globalConfigDraft.templateChatModelProfileId ?? globalConfigDraft.modelProfiles[0]?.id}
                        onValueChange={(value) => setGlobalConfigDraft((current) => ({ ...current, templateChatModelProfileId: value }))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select default provider profile" />
                        </SelectTrigger>
                        <SelectContent>
                          {globalConfigDraft.modelProfiles.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {profile.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>

                    <ScrollArea className="min-h-0 flex-1" data-testid="template-models-scroll">
                      <div className="flex flex-col gap-2 pr-3">
                        {globalConfigDraft.modelProfiles.map((profile) => (
                          <button
                            key={profile.id}
                            type="button"
                            className={cn(
                              "rounded-xl border border-border/70 px-3 py-3 text-left transition-colors hover:bg-muted/60",
                              profile.id === activeModelProfile?.id && "border-ring bg-accent/10",
                            )}
                            onClick={() => setActiveModelProfileId(profile.id)}
                          >
                            <p className="m-0 text-sm font-semibold">{profile.name}</p>
                            <p className="m-0 mt-1 text-xs uppercase tracking-[0.12em] text-muted-foreground">{profile.providerKind}</p>
                            <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">{profile.description}</p>
                          </button>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </section>

                <ScrollArea className="min-h-0 h-full" data-testid="template-model-detail-scroll">
                  <div className="flex flex-col gap-4 pr-3 pb-4">
                    {activeModelProfile ? (
                      <ModelProfileEditor
                        draft={activeModelProfile}
                        disableRemove={globalConfigDraft.modelProfiles.length <= 1}
                        onChange={(patch) =>
                          setGlobalConfigDraft((current) => ({
                            ...current,
                            modelProfiles: current.modelProfiles.map((profile) =>
                              profile.id === activeModelProfile.id ? { ...profile, ...patch } : profile,
                            ),
                          }))}
                        onRemove={() => {
                          const nextProfiles = globalConfigDraft.modelProfiles.filter((profile) => profile.id !== activeModelProfile.id);
                          setGlobalConfigDraft((current) => ({
                            ...current,
                            modelProfiles: nextProfiles,
                            templateChatModelProfileId:
                              current.templateChatModelProfileId === activeModelProfile.id
                                ? nextProfiles[0]?.id
                                : current.templateChatModelProfileId,
                          }));
                          setActiveModelProfileId(nextProfiles[0]?.id);
                        }}
                      />
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                      <div>
                        {globalConfigError ? (
                          <p className="m-0 text-sm text-destructive">{globalConfigError}</p>
                        ) : (
                          <p className="m-0 text-sm text-muted-foreground">
                            {globalConfigDirty ? "Unsaved provider changes are local until you save." : "Provider settings match the file on disk."}
                          </p>
                        )}
                      </div>
                      <Button onClick={() => void saveGlobalConfig()} disabled={savingGlobalConfig || !globalConfigDirty}>
                        <Save size={16} />
                        Save
                      </Button>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
