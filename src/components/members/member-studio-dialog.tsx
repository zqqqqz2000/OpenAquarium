import { useState } from "react";

import { Clock3, Settings2, Star } from "lucide-react";

import type { GlobalWorkspaceConfig, Room, TeamMember, UpdateMemberConfigInput, WorkspaceSnapshot } from "@/domain/model";
import { buildMemberCliCommands } from "@/domain/tooling";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MemberSessionPane } from "@/components/members/member-session-pane";
import { AllowedSkillSelector } from "@/components/skills/allowed-skill-selector";
import {
  buildMemberConfigInput,
  buildWatcherConfigInput,
  createMemberConfigDraft,
  createWatcherDraft,
  type MemberConfigDraft,
  type WatcherDraft,
} from "@/lib/member-config-draft";
import { MemberAvatar } from "@/components/members/member-avatar";
import { ProviderModelSelects } from "@/components/members/provider-model-selects";
import { getWatcherForMember } from "@/components/members/member-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createDefaultGlobalWorkspaceConfig } from "@/lib/provider-model-profiles";
import { getMemberHistory } from "@/lib/message-feed";
import { badgeToneProps, surfaceToneClass } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

const CODEX_THINKING_DEPTHS = ["low", "mid", "high", "extra-high"] as const;

function FactTile(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2">
      <p className="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="m-0 text-sm font-medium">{value}</p>
    </div>
  );
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

export function MemberStudioDialog(props: {
  snapshot: WorkspaceSnapshot;
  globalConfig?: GlobalWorkspaceConfig;
  room?: Room;
  member?: TeamMember;
  connected?: boolean;
  error?: string;
  onClose: () => void;
  onSaveConfig: (input: UpdateMemberConfigInput) => void | Promise<void>;
  onSetEntryMember: (memberId: string) => void | Promise<void>;
  onSaveWatcher: (input: { memberId: string; enabled: boolean; intervalMinutes: number; persistent?: boolean }) => void | Promise<void>;
  onRunWatcher: (watcherId: string) => void;
  onSendDirectMessage?: (content: string, directMemberId: string) => void | Promise<void>;
}) {
  const {
    snapshot,
    globalConfig: incomingGlobalConfig,
    room,
    member,
    connected = true,
    error: runtimeError,
    onClose,
    onSaveConfig,
    onSetEntryMember,
    onSaveWatcher,
    onRunWatcher,
    onSendDirectMessage,
  } = props;
  const [configDrafts, setConfigDrafts] = useState<Record<string, MemberConfigDraft>>({});
  const [watcherDrafts, setWatcherDrafts] = useState<Record<string, WatcherDraft>>({});
  const [errorByMember, setErrorByMember] = useState<Record<string, string | undefined>>({});
  const [activeTab, setActiveTab] = useState("session");
  const globalConfig = incomingGlobalConfig ?? createDefaultGlobalWorkspaceConfig();

  if (!room || !member) {
    return null;
  }

  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
  const watcher = getWatcherForMember(room, snapshot, member.id);
  const cliCommands = buildMemberCliCommands(room, member);
  const memberHistory = getMemberHistory(snapshot, room, member);
  const configDraft = configDrafts[member.id] ?? createMemberConfigDraft(member);
  const watcherDraft = watcherDrafts[member.id] ?? createWatcherDraft(watcher);
  const memberError = errorByMember[member.id];
  const memberToneBadge = badgeToneProps(member.accentTone);
  const skillCount = member.allowedSkillIds?.length ?? 0;
  const isSessionTab = activeTab === "session";
  const activeModelProfileName =
    globalConfig.modelProfiles.find((profile) => profile.id === (configDraft.modelProfileId ?? member.modelProfileId))?.name
    ?? member.provider.label;
  const selectedModelProfile = globalConfig.modelProfiles.find((profile) => profile.id === (configDraft.modelProfileId ?? member.modelProfileId));
  const supportsCodexThinkingDepth = (selectedModelProfile?.binding.kind ?? member.provider.kind) === "codex-acp";

  const patchConfigDraft = (patch: Partial<MemberConfigDraft>): void => {
    setConfigDrafts((current) => ({
      ...current,
      [member.id]: {
        ...configDraft,
        ...patch,
      },
    }));
  };

  const patchWatcherDraft = (patch: Partial<WatcherDraft>): void => {
    setWatcherDrafts((current) => ({
      ...current,
      [member.id]: {
        ...watcherDraft,
        ...patch,
      },
    }));
  };

  const setRoleEnabled = (checked: boolean): void => {
    patchConfigDraft({ isRole: checked });
    if (checked) {
      patchWatcherDraft({
        enabled: false,
        persistent: false,
      });
    }
  };

  const saveConfig = (): void => {
    try {
      setErrorByMember((current) => ({
        ...current,
        [member.id]: undefined,
      }));
      void onSaveConfig(buildMemberConfigInput(member, configDraft));
    } catch (caughtError) {
      setErrorByMember((current) => ({
        ...current,
        [member.id]: caughtError instanceof Error ? caughtError.message : String(caughtError),
      }));
    }
  };

  const saveWatcher = (): void => {
    try {
      setErrorByMember((current) => ({
        ...current,
        [member.id]: undefined,
      }));
      void onSaveWatcher(buildWatcherConfigInput(member.id, watcherDraft));
    } catch (caughtError) {
      setErrorByMember((current) => ({
        ...current,
        [member.id]: caughtError instanceof Error ? caughtError.message : String(caughtError),
      }));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="grid h-[92vh] w-[min(96vw,1160px)] max-w-[1160px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[1160px]" showCloseButton={false}>
        <div className="border-b border-border px-5 py-4">
          <DialogHeader className="flex-row items-start justify-between gap-4">
            <div className="space-y-1">
              <DialogTitle className="text-2xl font-semibold tracking-tight">Member Studio</DialogTitle>
              <DialogDescription className="sr-only">Inspect session history and update member configuration.</DialogDescription>
            </div>
            <DialogClose asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close member studio">
                <span aria-hidden>×</span>
              </Button>
            </DialogClose>
          </DialogHeader>
        </div>

        <div className={cn("grid min-h-0 gap-3 overflow-hidden p-3 lg:p-4", isSessionTab ? "lg:grid-cols-[220px_minmax(0,1fr)]" : "lg:grid-cols-[272px_minmax(0,1fr)]")}>
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                <MemberAvatar member={member} active />
                {!isSessionTab ? <p className="m-0 text-sm leading-6 text-muted-foreground">{member.summary}</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Badge variant={memberToneBadge.variant} className={memberToneBadge.className}>
                    {activeModelProfileName}
                  </Badge>
                  <Badge variant="secondary">{skillCount} skills</Badge>
                  {member.isEntryMember ? <Badge variant="outline">Entry member</Badge> : null}
                  {watcher ? <Badge variant="outline">Watcher {watcher.intervalMinutes}m</Badge> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                {!isSessionTab ? <p className="m-0 text-lg font-semibold tracking-tight">At a glance</p> : null}
                <div className="grid grid-cols-1 gap-2">
                  <FactTile label="Status" value={member.status} />
                </div>
                <div className="flex flex-wrap gap-2">
                  {!member.isEntryMember ? (
                    <Button size="sm" variant="secondary" onClick={() => void onSetEntryMember(member.id)}>
                      <Star size={16} />
                      Make entry member
                    </Button>
                  ) : null}
                  {watcher ? (
                    <Button size="sm" onClick={() => onRunWatcher(watcher.id)}>
                      Run watcher now
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {activeTask ? (
              <Card className={cn(surfaceToneClass("correction"), "max-h-[min(20rem,38vh)]")} data-testid="current-task-card">
                <CardContent className="flex min-h-0 flex-col gap-2 overflow-hidden p-4">
                  <p className="m-0 text-base font-semibold tracking-tight">Current task</p>
                  <p className="m-0 text-sm">{activeTask.title}</p>
                  <p className="m-0 text-sm text-muted-foreground">status: {activeTask.status}</p>
                  <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">source message</p>
                  <div
                    className="min-h-0 overflow-y-auto rounded-lg border border-border/50 bg-background/55 p-3"
                    data-testid="current-task-source-message"
                  >
                    <p className="m-0 whitespace-pre-wrap break-words text-sm">
                      {snapshot.messages[activeTask.sourceMessageId]?.content}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-col gap-2 overflow-hidden">
            <TabsList variant="line" className="h-auto w-full flex-wrap justify-start rounded-none border-b bg-transparent p-0">
              {[
                ["session", "Session"],
                ["history", "History"],
                ["config", "Config"],
                ["watcher", "Watcher"],
                ["cli", "CLI"],
              ].map(([value, label]) => (
                <TabsTrigger key={value} value={value} className="rounded-none px-3 py-2">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className={activeTab === "session" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto pr-1"}>
              <TabsContent value="session" className="m-0 h-full">
                <MemberSessionPane
                  snapshot={snapshot}
                  room={room}
                  member={member}
                  connected={connected}
                  error={runtimeError}
                  onSendDirectMessage={onSendDirectMessage ? (content) => onSendDirectMessage(content, member.id) : undefined}
                />
              </TabsContent>

              <TabsContent value="history" className="m-0">
                <Card className="border-none bg-transparent py-0 ring-0 shadow-none">
                  <CardContent className="flex flex-col gap-3 p-0">
                    <p className="m-0 text-lg font-semibold tracking-tight">Processing history</p>
                    <div className="flex flex-col gap-3">
                      {memberHistory.map((entry) => {
                        const historyAuthor =
                          entry.message.author.kind === "member" ? snapshot.members[entry.message.author.id] : undefined;

                        return (
                          <MessageBubble
                            key={entry.message.id}
                            message={entry.message}
                            authorMember={historyAuthor}
                            mentionedHandles={entry.mentionedHandles}
                            quotedHandles={entry.quotedHandles}
                            recipientHandles={entry.recipientHandles}
                            handlerSummaries={entry.handlers}
                            contextBadges={entry.contextBadges}
                          />
                        );
                      })}
                      {memberHistory.length === 0 ? (
                        <Card className="border-dashed shadow-none">
                          <CardContent className="p-5">
                            <p className="m-0 text-sm text-muted-foreground">
                              这个成员还没有接到过消息，也没有留下处理痕迹。
                            </p>
                          </CardContent>
                        </Card>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="config" className="m-0">
                <Card>
                  <CardContent className="flex flex-col gap-4 p-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Settings2 size={18} />
                        <p className="m-0 text-lg font-semibold tracking-tight">Room config</p>
                      </div>
                      <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3">
                        <p className="m-0 text-sm font-medium">Room-scoped member config</p>
                        <p className="m-0 mt-1 text-sm leading-6 text-muted-foreground">
                          这里改的是当前 room 下这个 member 的实例配置，不会同步回 team template。
                        </p>
                      </div>
                    </div>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Summary</span>
                      <Input value={configDraft.summary} onChange={(event) => patchConfigDraft({ summary: event.currentTarget.value })} />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Prompt</span>
                      <Textarea
                        className="min-h-40"
                        value={configDraft.prompt}
                        onChange={(event) => patchConfigDraft({ prompt: event.currentTarget.value })}
                      />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <ProviderModelSelects
                        globalConfig={globalConfig}
                        modelProfileId={configDraft.modelProfileId}
                        modelId={configDraft.modelId}
                        onProviderChange={(value) => patchConfigDraft({ modelProfileId: value })}
                        onModelChange={(value) => patchConfigDraft({ modelId: value })}
                      />
                    </div>
                    {supportsCodexThinkingDepth ? (
                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Codex thinking depth</span>
                        <Select
                          value={configDraft.codexThinkingDepth ?? "high"}
                          onValueChange={(value) => patchConfigDraft({ codexThinkingDepth: value as (typeof CODEX_THINKING_DEPTHS)[number] })}
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
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                      <span className="text-sm font-medium">Role</span>
                      <Switch
                        aria-label="Role"
                        checked={configDraft.isRole}
                        onCheckedChange={setRoleEnabled}
                      />
                    </label>
                    {configDraft.isRole ? (
                      <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                        Role 成员不能同时开启 Watch；保存后会移除这个成员当前 room 的 watcher 配置。
                      </div>
                    ) : null}

                    <div className="border-t border-border pt-4">
                      <p className="m-0 mb-2 text-lg font-semibold tracking-tight">Allowed skill ids</p>
                      <AllowedSkillSelector
                        valueText={configDraft.allowedSkillIdsText}
                        onChangeText={(allowedSkillIdsText) => patchConfigDraft({ allowedSkillIdsText })}
                        description="通过下拉选择成员可用 skill；运行时只暴露 skill id 和 `skills/<skill-id>/SKILL.md` 入口。"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                      {memberError ? (
                        <p className="m-0 text-sm text-destructive">{memberError}</p>
                      ) : (
                        <p className="m-0 text-sm text-muted-foreground">保存后只更新当前 room 里的这个 member 实例。</p>
                      )}
                      <Button onClick={saveConfig}>Save member config</Button>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="watcher" className="m-0">
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-2">
                      <Clock3 size={18} />
                      <p className="m-0 text-lg font-semibold tracking-tight">Watcher</p>
                    </div>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Interval minutes</span>
                      <Input
                        inputMode="numeric"
                        value={watcherDraft.intervalMinutes}
                        onChange={(event) => patchWatcherDraft({ intervalMinutes: event.currentTarget.value })}
                      />
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span>Watch</span>
                          <InlineHint content="开启后，这个成员会按设定间隔执行常规 watcher 轮询。" />
                        </span>
                        <Switch
                          aria-label="Watch"
                          checked={watcherDraft.enabled}
                          disabled={configDraft.isRole}
                          onCheckedChange={(checked) => patchWatcherDraft({ enabled: checked, persistent: checked ? watcherDraft.persistent : false })}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span>Persistent watch</span>
                          <InlineHint content="开启后，即使没有新消息或状态变化，watcher 也会按周期持续触发；直到成员主动停止。" />
                        </span>
                        <Switch
                          aria-label="Persistent watch"
                          checked={watcherDraft.persistent}
                          disabled={configDraft.isRole || !watcherDraft.enabled}
                          onCheckedChange={(checked) => patchWatcherDraft({ persistent: checked })}
                        />
                      </label>
                    </div>
                    <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                      {configDraft.isRole
                        ? "Role 成员不允许配置 Watch。先关闭 Role，才能在当前 room 为这个成员保存 watcher。"
                        : "Persistent watch 会等首个 interval 到达后才触发；之后即使没有新房间消息，也会产出 heartbeat digest。若期间出现新消息或成员状态变化，digest 会带上这些增量。"}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={saveWatcher} disabled={configDraft.isRole}>
                        Save watcher
                      </Button>
                      {watcher ? (
                        <Button size="sm" onClick={() => onRunWatcher(watcher.id)}>
                          Run now
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="cli" className="m-0">
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <p className="m-0 text-lg font-semibold tracking-tight">CLI preview</p>
                    {cliCommands.map((command) => (
                      <div key={command.id} className="rounded-lg border border-dashed border-border bg-background px-3 py-2">
                        <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{command.label}</p>
                        <p className="m-0 break-all font-mono text-xs">{command.command}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </TabsContent>
            </div>

          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
