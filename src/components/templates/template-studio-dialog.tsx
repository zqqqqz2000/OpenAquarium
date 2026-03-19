import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatTransport } from "ai";
import { toast } from "sonner";

import { ArrowUp, LoaderCircle, MessageSquare, Plus, Save, Settings2, Sparkles, Star, Trash2, X } from "lucide-react";

import type {
  GlobalWorkspaceConfig,
  OpenAICompatibleMCPServer,
  OpenAICompatibleRemoteMCPServer,
  ProviderConnectionTestResult,
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { JsonEditor } from "@/components/ui/json-editor";
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
import { OPENAQUARIUM_PROVIDER_TEST_PROMPT } from "@/lib/provider-test";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

const ACCENT_TONES = ["paper", "postit", "blueprint", "correction"] as const;
const CODEX_THINKING_DEPTHS = ["low", "mid", "high", "extra-high"] as const;
function supportsCodexThinkingDepth(args: {
  modelProfileId?: string;
  globalConfig: GlobalWorkspaceConfig;
}): boolean {
  const selectedProfile = args.globalConfig.modelProfiles.find((profile) => profile.id === args.modelProfileId);
  return selectedProfile?.providerType === "acp" && selectedProfile.binding.kind === "codex-acp";
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
    case "openai-compatible":
      return "OpenAI-Compatible";
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

function buildTemplateSyncKey(template: TeamTemplate): string {
  return JSON.stringify(buildTemplateConfigInput(template, createTemplateConfigDraft(template)));
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

interface ValueRow {
  id: string;
  value: string;
}

interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

interface McpServerFormState {
  id: string;
  transport: OpenAICompatibleMCPServer["transport"];
  command: string;
  args: ValueRow[];
  env: KeyValueRow[];
  cwd: string;
  url: string;
  headersFormat: OpenAICompatibleRemoteMCPServer["headersFormat"];
  headers: KeyValueRow[];
}

function createValueRow(value = ""): ValueRow {
  return {
    id: crypto.randomUUID(),
    value,
  };
}

function createKeyValueRow(key = "", value = ""): KeyValueRow {
  return {
    id: crypto.randomUUID(),
    key,
    value,
  };
}

function createValueRows(values: string[]): ValueRow[] {
  if (values.length === 0) {
    return [createValueRow()];
  }

  return values.map((value) => createValueRow(value));
}

function createKeyValueRows(entries: Record<string, string>): KeyValueRow[] {
  const rows = Object.entries(entries).map(([key, value]) => createKeyValueRow(key, value));
  return rows.length > 0 ? rows : [createKeyValueRow()];
}

function buildValueList(rows: ValueRow[]): string[] {
  return rows.map((row) => row.value.trim()).filter(Boolean);
}

function buildKeyValueRecord(rows: KeyValueRow[]): Record<string, string> {
  return rows.reduce<Record<string, string>>((record, row) => {
    const key = row.key.trim();
    if (!key) {
      return record;
    }

    record[key] = row.value.trim();
    return record;
  }, {});
}

function createMcpServerFormState(server?: OpenAICompatibleMCPServer): McpServerFormState {
  if (!server) {
    return {
      id: "",
      transport: "stdio",
      command: "",
      args: [createValueRow()],
      env: [createKeyValueRow()],
      cwd: "",
      url: "",
      headersFormat: "kv",
      headers: [createKeyValueRow()],
    };
  }

  if (server.transport === "stdio") {
    return {
      id: server.id,
      transport: server.transport,
      command: server.command,
      args: createValueRows(server.args),
      env: createKeyValueRows(server.env),
      cwd: server.cwd ?? "",
      url: "",
      headersFormat: "kv",
      headers: [createKeyValueRow()],
    };
  }

  return {
    id: server.id,
    transport: server.transport,
    command: "",
    args: [createValueRow()],
    env: [createKeyValueRow()],
    cwd: "",
    url: server.url,
    headersFormat: server.headersFormat,
    headers: createKeyValueRows(server.headers),
  };
}

function buildMcpServerFromFormState(form: McpServerFormState): OpenAICompatibleMCPServer {
  if (form.transport === "stdio") {
    return {
      id: form.id.trim(),
      transport: "stdio",
      command: form.command.trim(),
      args: buildValueList(form.args),
      env: buildKeyValueRecord(form.env),
      cwd: form.cwd.trim() || undefined,
    };
  }

  return {
    id: form.id.trim(),
    transport: form.transport,
    url: form.url.trim(),
    headersFormat: form.headersFormat,
    headers: buildKeyValueRecord(form.headers),
  };
}

function describeMcpTransport(transport: OpenAICompatibleMCPServer["transport"]): string {
  switch (transport) {
    case "stdio":
      return "STDIO";
    case "http":
      return "Streamable HTTP";
    case "sse":
      return "SSE";
    default:
      return transport;
  }
}

function EditableValueList(props: {
  label: string;
  rows: ValueRow[];
  placeholder: string;
  addLabel: string;
  onChange: (rows: ValueRow[]) => void;
}) {
  const { addLabel, label, onChange, placeholder, rows } = props;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-3">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <Input
              value={row.value}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(rows.map((candidate) => (candidate.id === row.id ? { ...candidate, value: event.currentTarget.value } : candidate)))}
            />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${label}`}
              onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => onChange([...rows, createValueRow()])}
        >
          <Plus size={16} />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function EditableKeyValueList(props: {
  label: string;
  rows: KeyValueRow[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  onChange: (rows: KeyValueRow[]) => void;
}) {
  const { addLabel, keyPlaceholder, label, onChange, rows, valuePlaceholder } = props;

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/15 p-3">
        {rows.map((row) => (
          <div key={row.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(event) =>
                onChange(rows.map((candidate) => (candidate.id === row.id ? { ...candidate, key: event.currentTarget.value } : candidate)))}
            />
            <Input
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(event) =>
                onChange(rows.map((candidate) => (candidate.id === row.id ? { ...candidate, value: event.currentTarget.value } : candidate)))}
            />
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${label}`}
              onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={() => onChange([...rows, createKeyValueRow()])}
        >
          <Plus size={16} />
          {addLabel}
        </Button>
      </div>
    </div>
  );
}

function McpServerEditorDialog(props: {
  open: boolean;
  server?: OpenAICompatibleMCPServer;
  onOpenChange: (open: boolean) => void;
  onSave: (server: OpenAICompatibleMCPServer) => void;
}) {
  const { open, server, onOpenChange, onSave } = props;
  const [form, setForm] = useState(() => createMcpServerFormState(server));

  const isValid =
    form.id.trim().length > 0
    && (form.transport === "stdio" ? form.command.trim().length > 0 : form.url.trim().length > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,920px)] max-w-[920px] gap-0 overflow-hidden p-0 sm:max-w-[920px]">
        <div className="border-b border-border px-5 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              {server ? "Edit MCP server" : "Connect a custom MCP"}
            </DialogTitle>
            <DialogDescription>
              为当前 provider 配置外部工具连接。这里会直接生成 OpenAquarium 的 provider profile 配置。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-4 overflow-y-auto px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Server name</span>
            <Input value={form.id} placeholder="MCP server name" onChange={(event) => setForm((current) => ({ ...current, id: event.currentTarget.value }))} />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Transport</span>
            <Select
              value={form.transport}
              onValueChange={(value) => setForm((current) => ({ ...current, transport: value as OpenAICompatibleMCPServer["transport"] }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select transport" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stdio">STDIO</SelectItem>
                <SelectItem value="http">Streamable HTTP</SelectItem>
                <SelectItem value="sse">SSE</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {form.transport === "stdio" ? (
            <>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Command to launch</span>
                <Input
                  value={form.command}
                  placeholder="openai-dev-mcp serve-sqlite"
                  onChange={(event) => setForm((current) => ({ ...current, command: event.currentTarget.value }))}
                />
              </label>
              <EditableValueList
                label="Arguments"
                rows={form.args}
                placeholder="Argument"
                addLabel="Add argument"
                onChange={(args) => setForm((current) => ({ ...current, args }))}
              />
              <EditableKeyValueList
                label="Environment variables"
                rows={form.env}
                keyPlaceholder="Key"
                valuePlaceholder="Value"
                addLabel="Add environment variable"
                onChange={(env) => setForm((current) => ({ ...current, env }))}
              />
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Working directory</span>
                <Input
                  value={form.cwd}
                  placeholder="~/code"
                  onChange={(event) => setForm((current) => ({ ...current, cwd: event.currentTarget.value }))}
                />
              </label>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Server URL</span>
                <Input
                  value={form.url}
                  placeholder={form.transport === "http" ? "https://example.com/mcp" : "https://example.com/sse"}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.currentTarget.value }))}
                />
              </label>
              <EditableKeyValueList
                label="Headers"
                rows={form.headers}
                keyPlaceholder="Header"
                valuePlaceholder="Value"
                addLabel="Add header"
                onChange={(headers) => setForm((current) => ({ ...current, headers }))}
              />
            </>
          )}
        </div>

        <DialogFooter className="items-center justify-between">
          <p className="m-0 text-sm text-muted-foreground">
            保存后，这些 MCP tools 会跟随当前 provider profile 一起被 Team Builder 和成员继承。
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!isValid}
              onClick={() => {
                onSave(buildMcpServerFromFormState(form));
                onOpenChange(false);
              }}
            >
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function McpServersEditor(props: {
  servers: OpenAICompatibleMCPServer[];
  onChange: (servers: OpenAICompatibleMCPServer[]) => void;
}) {
  const { onChange, servers } = props;
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | undefined>(undefined);

  const activeServer = editingIndex === undefined ? undefined : servers[editingIndex];

  const saveServer = (server: OpenAICompatibleMCPServer): void => {
    const nextServers = [...servers];
    if (editingIndex === undefined) {
      nextServers.push(server);
    } else {
      nextServers[editingIndex] = server;
    }
    onChange(nextServers);
  };

  return (
    <>
      <Card className="rounded-2xl border-border/70 bg-background/70 shadow-none">
        <CardHeader className="gap-3">
          <div>
            <CardTitle className="text-lg tracking-tight">MCP servers</CardTitle>
            <CardDescription>把外部工具和数据源挂到当前 openai-compatible provider 上，不再手写 JSON 数组。</CardDescription>
          </div>
          <CardAction>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditingIndex(undefined);
                setEditorOpen(true);
              }}
            >
              <Plus size={16} />
              Add server
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {servers.length === 0 ? (
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-4">
              <div>
                <p className="m-0 text-sm font-medium">No MCP servers connected</p>
                <p className="m-0 mt-1 text-sm text-muted-foreground">添加后，模型侧会自动拿到这些 server 暴露出来的工具。</p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingIndex(undefined);
                  setEditorOpen(true);
                }}
              >
                <Plus size={16} />
                Add server
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {servers.map((server, index) => (
                <div key={`${server.id}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="m-0 text-sm font-semibold">{server.id}</p>
                      <Badge variant="outline">{describeMcpTransport(server.transport)}</Badge>
                    </div>
                    <p className="m-0 mt-2 truncate text-sm text-muted-foreground">
                      {server.transport === "stdio" ? `${server.command} ${server.args.join(" ")}`.trim() : server.url}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingIndex(index);
                        setEditorOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => onChange(servers.filter((_, serverIndex) => serverIndex !== index))}>
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {editorOpen ? (
        <McpServerEditorDialog
          open={editorOpen}
          server={activeServer}
          onOpenChange={setEditorOpen}
          onSave={saveServer}
        />
      ) : null}
    </>
  );
}

function ProviderTestDialog(props: {
  draft: ModelProfileDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { draft, open, onOpenChange } = props;
  const runtimeClient = useMemo(() => new WorkspaceRuntimeClient(), []);
  const [catalog, setCatalog] = useState<TemplateStudioModelCatalog | undefined>(undefined);
  const [catalogError, setCatalogError] = useState<string | undefined>(undefined);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [testResult, setTestResult] = useState<ProviderConnectionTestResult | undefined>(undefined);
  const [testError, setTestError] = useState<string | undefined>(undefined);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setLoadingCatalog(true);
      setCatalogError(undefined);
    });

    void runtimeClient.getProviderProfileModelCatalog({ draft }).then((nextCatalog) => {
      if (cancelled) {
        return;
      }

      setCatalog(nextCatalog);
      setSelectedModelId((current) =>
        current.trim()
        || nextCatalog.currentModelId
        || nextCatalog.availableModels[0]?.id
        || draft.providerCompactionModelId.trim()
        || "",
      );
    }).catch((error) => {
      if (cancelled) {
        return;
      }

      setCatalog(undefined);
      setCatalogError(error instanceof Error ? error.message : String(error));
      setSelectedModelId((current) => current.trim() || draft.providerCompactionModelId.trim() || "");
    }).finally(() => {
      if (!cancelled) {
        setLoadingCatalog(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [draft, open, runtimeClient]);

  const requiresModelId = draft.providerType === "openai-compatible";
  const canRunTest = !testing && (!requiresModelId || selectedModelId.trim().length > 0);

  const outputText =
    testing
      ? "Connecting to provider and sending the OpenAquarium probe prompt..."
      : testError
        ? testError
        : testResult?.responseText
          || "Ready to test. Click “Start Test” to send a short probe message.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,760px)] max-w-[760px] gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        <div className="border-b border-border px-5 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-2xl font-semibold tracking-tight">Test Provider Connection</DialogTitle>
            <DialogDescription>
              用当前草稿直接探活，不需要先保存 profile。这个测试会验证模型调用链路，以及已配置的 MCP server 是否能完成装配。
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="grid gap-4 px-5 py-4">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-muted/15 px-4 py-4">
            <div>
              <p className="m-0 text-xl font-semibold">{draft.name}</p>
              <p className="m-0 mt-1 text-sm text-muted-foreground">
                {draft.providerLabel} · {draft.providerKind}
              </p>
            </div>
            <Badge variant="secondary">{draft.providerType === "openai-compatible" ? "HTTP API" : "ACP session"}</Badge>
          </div>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Select test model</span>
            {catalog?.source === "runtime" && catalog.availableModels.length > 0 ? (
              <Select value={selectedModelId} onValueChange={setSelectedModelId} disabled={loadingCatalog || testing}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loadingCatalog ? "Loading models…" : "Select model"} />
                </SelectTrigger>
                <SelectContent>
                  {catalog.availableModels.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={selectedModelId}
                placeholder={requiresModelId ? "Enter model id" : "Optional model id"}
                disabled={testing}
                onChange={(event) => setSelectedModelId(event.currentTarget.value)}
              />
            )}
          </label>

          <div className="rounded-[1.5rem] border border-border/70 bg-slate-950 px-4 py-4 text-sm text-slate-200 shadow-sm">
            <pre className="m-0 min-h-40 whitespace-pre-wrap break-words font-mono leading-7 text-inherit">{outputText}</pre>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Probe prompt: “{OPENAQUARIUM_PROVIDER_TEST_PROMPT}”</span>
            {testResult ? <span>MCP tools loaded: {testResult.toolCount}</span> : null}
          </div>
          {catalog?.source === "unavailable" ? <p className="m-0 text-sm text-muted-foreground">{catalog.unavailableMessage}</p> : null}
          {catalogError ? <p className="m-0 text-sm text-destructive">{catalogError}</p> : null}
        </div>

        <DialogFooter className="items-center justify-between">
          <p className="m-0 text-sm text-muted-foreground">
            {requiresModelId ? "openai-compatible provider 需要明确的 model id 才能开始测试。" : "ACP provider 可直接使用默认模型，也可以手动指定 model id。"}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="button"
              disabled={!canRunTest}
              onClick={() => {
                setTesting(true);
                setTestError(undefined);
                setTestResult(undefined);
                void runtimeClient.testProviderProfile({
                  draft,
                  modelId: selectedModelId.trim() || undefined,
                }).then((result) => {
                  setTestResult(result);
                }).catch((error) => {
                  setTestError(error instanceof Error ? error.message : String(error));
                }).finally(() => {
                  setTesting(false);
                });
              }}
            >
              {testing ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Start Test
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModelProfileEditor(props: {
  draft: ModelProfileDraft;
  disableRemove: boolean;
  onChange: (patch: Partial<ModelProfileDraft>) => void;
  onRemove: () => void;
}) {
  const { draft, disableRemove, onChange, onRemove } = props;
  const [testDialogOpen, setTestDialogOpen] = useState(false);

  return (
    <>
    <Card className="rounded-2xl border-border/70 bg-background/70 shadow-none">
      <CardHeader className="gap-3">
        <div>
          <CardTitle className="text-lg tracking-tight">Provider profile</CardTitle>
          <CardDescription>Provider config lives here. Team templates still pick model profiles and thinking depth separately.</CardDescription>
        </div>
        <CardAction>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" type="button" onClick={() => setTestDialogOpen(true)}>
              <Sparkles size={16} />
              Test
            </Button>
            <Button size="sm" variant="ghost" disabled={disableRemove} onClick={onRemove}>
              <Trash2 size={16} />
              Remove
            </Button>
          </div>
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
            <Select
              value={draft.providerKind}
              onValueChange={(value) =>
                onChange({
                  providerKind: value as ModelProfileDraft["providerKind"],
                  providerType: value === "openai-compatible" ? "openai-compatible" : "acp",
                })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select provider kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="codex-acp">codex-acp</SelectItem>
                <SelectItem value="generic-acp">generic-acp</SelectItem>
                <SelectItem value="openai-compatible">openai-compatible</SelectItem>
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
          {draft.providerType === "acp" ? (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Provider command</span>
              <Input value={draft.providerCommand} onChange={(event) => onChange({ providerCommand: event.currentTarget.value })} />
            </label>
          ) : (
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Base URL</span>
              <Input value={draft.providerBaseUrl} onChange={(event) => onChange({ providerBaseUrl: event.currentTarget.value })} />
            </label>
          )}
        </div>

        {draft.providerType === "acp" ? (
          <>
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
          </>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">API key env var</span>
                <Input value={draft.providerApiKeyEnvVar} onChange={(event) => onChange({ providerApiKeyEnvVar: event.currentTarget.value })} />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Headers format</span>
                <Select
                  value={draft.providerHeadersFormat}
                  onValueChange={(value) => onChange({ providerHeadersFormat: value as ModelProfileDraft["providerHeadersFormat"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select headers format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kv">kv</SelectItem>
                    <SelectItem value="json">json</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Headers ({draft.providerHeadersFormat === "json" ? "JSON object" : "KEY=VALUE or KEY: VALUE"})
              </span>
              {draft.providerHeadersFormat === "json" ? (
                <JsonEditor value={draft.providerHeadersText} onChange={(value) => onChange({ providerHeadersText: value })} />
              ) : (
                <Textarea className="min-h-24" value={draft.providerHeadersText} onChange={(event) => onChange({ providerHeadersText: event.currentTarget.value })} />
              )}
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Extra body format</span>
                <Select
                  value={draft.providerExtraBodyFormat}
                  onValueChange={(value) => onChange({ providerExtraBodyFormat: value as ModelProfileDraft["providerExtraBodyFormat"] })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select extra body format" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kv">kv</SelectItem>
                    <SelectItem value="json">json</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">
                Extra body ({draft.providerExtraBodyFormat === "json" ? "JSON object" : "KEY=VALUE or KEY: VALUE"})
              </span>
              {draft.providerExtraBodyFormat === "json" ? (
                <JsonEditor value={draft.providerExtraBodyText} onChange={(value) => onChange({ providerExtraBodyText: value })} />
              ) : (
                <Textarea className="min-h-28" value={draft.providerExtraBodyText} onChange={(event) => onChange({ providerExtraBodyText: event.currentTarget.value })} />
              )}
            </label>
            <McpServersEditor
              servers={draft.providerMcpServers}
              onChange={(providerMcpServers) => onChange({ providerMcpServers })}
            />
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Model limits (JSON object keyed by model id)</span>
              <JsonEditor value={draft.providerModelLimitsText} onChange={(value) => onChange({ providerModelLimitsText: value })} />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Compaction model id</span>
                <Input
                  value={draft.providerCompactionModelId}
                  onChange={(event) => onChange({ providerCompactionModelId: event.currentTarget.value })}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Reserved tokens</span>
                <Input
                  inputMode="numeric"
                  value={draft.providerCompactionReservedTokens}
                  onChange={(event) => onChange({ providerCompactionReservedTokens: event.currentTarget.value })}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Offload threshold chars</span>
                <Input
                  inputMode="numeric"
                  value={draft.providerCompactionOffloadThresholdChars}
                  onChange={(event) => onChange({ providerCompactionOffloadThresholdChars: event.currentTarget.value })}
                />
              </label>
            </div>
          </>
        )}
      </CardContent>
    </Card>
    <ProviderTestDialog draft={draft} open={testDialogOpen} onOpenChange={setTestDialogOpen} />
    </>
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
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }

      setLoadingModelCatalog(true);
      setModelCatalogError(undefined);
    });

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
                    value={selectedModelValue ?? ""}
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
  const previousTemplateSyncKeyByIdRef = useRef<Record<string, string>>({});

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
    const nextTemplateSyncKeyById = Object.fromEntries(
      templates.map((template) => [template.id, buildTemplateSyncKey(template)]),
    );

    setTemplateDrafts((current) =>
      Object.fromEntries(
        templates.map((template) => {
          const existingDraft = current[template.id];
          const previousTemplateSyncKey = previousTemplateSyncKeyByIdRef.current[template.id];
          const nextTemplateSyncKey = nextTemplateSyncKeyById[template.id];

          if (existingDraft && previousTemplateSyncKey === nextTemplateSyncKey) {
            return [template.id, existingDraft];
          }

          return [template.id, createTemplateConfigDraft(template)];
        }),
      ),
    );
    previousTemplateSyncKeyByIdRef.current = nextTemplateSyncKeyById;
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

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 lg:grid lg:gap-0 lg:overflow-hidden lg:p-4 lg:[grid-template-columns:300px_minmax(0,1fr)]">
          <div className="flex shrink-0 min-h-0 flex-col overflow-visible border-b border-border/60 pb-3 lg:border-r lg:border-b-0 lg:overflow-hidden lg:pb-0 lg:pr-4">
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

            <section className="flex flex-col pt-4 lg:min-h-0 lg:flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-base font-semibold tracking-tight">Team templates</p>
                <Badge variant="outline">{templates.length}</Badge>
              </div>
              {templateDeleteError ? <p className="m-0 mt-3 text-sm text-destructive">{templateDeleteError}</p> : null}
              <ScrollArea className="mt-3 lg:min-h-0 lg:flex-1" data-testid="template-list-scroll">
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

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex shrink-0 min-h-0 flex-col overflow-visible lg:overflow-hidden lg:pl-4 lg:pt-0">
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

            <TabsContent value="templates" className="m-0 overflow-visible lg:min-h-0 lg:overflow-hidden">
              {!selectedTemplate || !selectedTemplateDraft ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a team template to edit.</div>
              ) : (
                <div className="grid gap-4 pt-4 lg:h-full lg:min-h-0 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <section className="overflow-visible rounded-2xl border border-border/70 bg-background/70 px-4 py-4 lg:min-h-0 lg:overflow-hidden">
                    <div className="flex flex-col gap-3 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
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

                  <div className="grid overflow-visible lg:min-h-0 lg:grid-rows-[minmax(0,1fr)_auto] lg:overflow-hidden">
                    <ScrollArea className="lg:min-h-0 lg:h-full" data-testid="template-detail-scroll">
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
                                allowedProviderTypes={["acp"]}
                                modelProfileId={activeMember.modelProfileId}
                                modelId={activeMember.modelId}
                                onProviderChange={(value) => {
                                  const selectedProfile = globalConfig.modelProfiles.find((profile) => profile.id === value);
                                  patchMemberDraft(selectedTemplate.id, activeMember.id, {
                                    modelProfileId: value,
                                    provider: selectedProfile?.providerType === "acp" ? {
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
                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-medium">Watcher prompt</span>
                              <Textarea
                                className="min-h-28"
                                value={activeMember.watchPrompt}
                                disabled={activeMember.isRole || !activeMember.watchEnabled}
                                onChange={(event) => patchMemberDraft(selectedTemplate.id, activeMember.id, { watchPrompt: event.currentTarget.value })}
                                placeholder="Optional extra instructions only for watcher-triggered turns."
                              />
                            </label>
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

            <TabsContent value="builder" forceMount className="m-0 overflow-visible data-[state=inactive]:hidden lg:min-h-0 lg:overflow-hidden">
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

            <TabsContent value="providers" className="m-0 overflow-visible lg:min-h-0 lg:overflow-hidden">
              <div className="grid gap-4 pt-4 lg:h-full lg:min-h-0 xl:grid-cols-[280px_minmax(0,1fr)]">
                <section className="overflow-visible rounded-2xl border border-border/70 bg-background/70 px-4 py-4 lg:min-h-0 lg:overflow-hidden">
                  <div className="flex flex-col gap-3 overflow-visible lg:h-full lg:min-h-0 lg:overflow-hidden">
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

                <ScrollArea className="lg:min-h-0 lg:h-full" data-testid="template-model-detail-scroll">
                  <div className="flex flex-col gap-4 pr-3 pb-4">
                    {activeModelProfile ? (
                      <ModelProfileEditor
                        key={activeModelProfile.id}
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
