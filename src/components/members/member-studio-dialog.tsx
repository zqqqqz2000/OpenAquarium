import { useState } from "react";

import { Clock3, Eye, Hammer, KeyRound, Plus, ScanSearch, Star, Trash2 } from "lucide-react";

import type { Room, TeamMember, UpdateMemberConfigInput, WorkspaceSnapshot } from "@/domain/model";
import { buildMemberCliCommands } from "@/domain/tooling";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MemberSessionPane } from "@/components/members/member-session-pane";
import {
  addEmptySkillDraft,
  buildMemberConfigInput,
  buildWatcherConfigInput,
  createMemberConfigDraft,
  createWatcherDraft,
  type MemberConfigDraft,
  type WatcherDraft,
} from "@/lib/member-config-draft";
import { MemberAvatar } from "@/components/members/member-avatar";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getMemberHistory } from "@/lib/message-feed";
import { badgeToneProps, surfaceToneClass } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

function FactTile(props: { label: string; value: string }) {
  const { label, value } = props;

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2">
      <p className="m-0 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="m-0 text-sm font-medium">{value}</p>
    </div>
  );
}

export function MemberStudioDialog(props: {
  snapshot: WorkspaceSnapshot;
  room?: Room;
  member?: TeamMember;
  connected?: boolean;
  error?: string;
  onClose: () => void;
  onToggleMonitor: (memberId: string) => void | Promise<void>;
  onSaveConfig: (input: UpdateMemberConfigInput) => void | Promise<void>;
  onSetEntryMember: (memberId: string) => void | Promise<void>;
  onSaveWatcher: (input: { memberId: string; enabled: boolean; intervalMinutes: number }) => void | Promise<void>;
  onRunWatcher: (watcherId: string) => void;
  onSendDirectMessage?: (content: string, directMemberId: string) => void | Promise<void>;
}) {
  const {
    snapshot,
    room,
    member,
    connected = true,
    error: runtimeError,
    onClose,
    onToggleMonitor,
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
  const isSessionTab = activeTab === "session";

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
                    {member.provider.label}
                  </Badge>
                  <Badge variant="secondary">{member.skills.length} skills</Badge>
                  {member.isEntryMember ? <Badge variant="outline">Entry member</Badge> : null}
                  {member.observeAllRoomMessages ? <Badge variant="outline">Monitor all</Badge> : null}
                  {watcher ? <Badge variant="outline">Watcher {watcher.intervalMinutes}m</Badge> : null}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-3 p-4">
                {!isSessionTab ? <p className="m-0 text-lg font-semibold tracking-tight">At a glance</p> : null}
                <div className="grid grid-cols-2 gap-2">
                  <FactTile label="Status" value={member.status} />
                  <FactTile label="Direct inbox" value={member.acceptsDirectMessages ? "Open" : "Closed"} />
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
              <Card className={surfaceToneClass("correction")}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <p className="m-0 text-base font-semibold tracking-tight">Current task</p>
                  <p className="m-0 text-sm">{activeTask.title}</p>
                  <p className="m-0 text-sm text-muted-foreground">status: {activeTask.status}</p>
                  <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">source message</p>
                  <p className="m-0 text-sm">{snapshot.messages[activeTask.sourceMessageId]?.content}</p>
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-col gap-2 overflow-hidden">
            <TabsList variant="line" className="h-auto w-full flex-wrap justify-start rounded-none border-b bg-transparent p-0">
              {[
                ["session", "Session"],
                ["history", "History"],
                ["behavior", "Behavior"],
                ["provider", "ACP"],
                ["skills", "Skills"],
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

              <TabsContent value="behavior" className="m-0">
                <Card>
                  <CardContent className="flex flex-col gap-4 p-4">
                    <p className="m-0 text-lg font-semibold tracking-tight">Behavior</p>
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
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <KeyRound size={18} />
                        Accept direct messages
                      </span>
                      <Switch
                        aria-label="Accept direct messages"
                        checked={configDraft.acceptsDirectMessages}
                        onCheckedChange={(checked) => patchConfigDraft({ acceptsDirectMessages: checked })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        <Eye size={18} />
                        Monitor all room messages
                      </span>
                      <Switch
                        aria-label="Monitor all room messages"
                        checked={member.observeAllRoomMessages}
                        onCheckedChange={() => void onToggleMonitor(member.id)}
                      />
                    </label>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="provider" className="m-0">
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-2">
                      <ScanSearch size={18} />
                      <p className="m-0 text-lg font-semibold tracking-tight">ACP provider</p>
                    </div>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Label</span>
                      <Input value={configDraft.providerLabel} onChange={(event) => patchConfigDraft({ providerLabel: event.currentTarget.value })} />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Command</span>
                      <Input value={configDraft.providerCommand} onChange={(event) => patchConfigDraft({ providerCommand: event.currentTarget.value })} />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Args (one per line)</span>
                      <Textarea
                        className="min-h-24"
                        value={configDraft.providerArgsText}
                        onChange={(event) => patchConfigDraft({ providerArgsText: event.currentTarget.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Capabilities (comma or newline separated)</span>
                      <Textarea
                        className="min-h-20"
                        value={configDraft.providerCapabilitiesText}
                        onChange={(event) => patchConfigDraft({ providerCapabilitiesText: event.currentTarget.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Working directory</span>
                      <Input
                        value={configDraft.providerWorkingDirectory}
                        onChange={(event) => patchConfigDraft({ providerWorkingDirectory: event.currentTarget.value })}
                        placeholder="/absolute/or/relative/path"
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Environment (KEY=VALUE per line)</span>
                      <Textarea
                        className="min-h-24"
                        value={configDraft.providerEnvText}
                        onChange={(event) => patchConfigDraft({ providerEnvText: event.currentTarget.value })}
                      />
                    </label>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="skills" className="m-0">
                <Card>
                  <CardContent className="flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-2">
                      <Hammer size={18} />
                      <p className="m-0 text-lg font-semibold tracking-tight">Skill commands</p>
                    </div>
                    {configDraft.skills.map((skill, index) => (
                      <div key={skill.id} className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3">
                        <div className="flex justify-between gap-3">
                          <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Skill {index + 1}</p>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            type="button"
                            onClick={() =>
                              patchConfigDraft({
                                skills: configDraft.skills.filter((candidate) => candidate.id !== skill.id),
                              })
                            }
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                        <Input
                          value={skill.name}
                          onChange={(event) =>
                            patchConfigDraft({
                              skills: configDraft.skills.map((candidate) =>
                                candidate.id === skill.id ? { ...candidate, name: event.currentTarget.value } : candidate,
                              ),
                            })
                          }
                          placeholder="Skill name"
                        />
                        <Input
                          value={skill.description}
                          onChange={(event) =>
                            patchConfigDraft({
                              skills: configDraft.skills.map((candidate) =>
                                candidate.id === skill.id ? { ...candidate, description: event.currentTarget.value } : candidate,
                              ),
                            })
                          }
                          placeholder="What this skill is for"
                        />
                        <Textarea
                          className="min-h-20"
                          value={skill.command}
                          onChange={(event) =>
                            patchConfigDraft({
                              skills: configDraft.skills.map((candidate) =>
                                candidate.id === skill.id ? { ...candidate, command: event.currentTarget.value } : candidate,
                              ),
                            })
                          }
                          placeholder="./bin/oa-room-send --scope group"
                        />
                      </div>
                    ))}
                    <div className="flex justify-start">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => patchConfigDraft({ skills: addEmptySkillDraft(configDraft.skills) })}
                      >
                        <Plus size={16} />
                        Add skill
                      </Button>
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
                    <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                      <span className="text-sm font-medium">Enable scheduled watcher</span>
                      <Switch
                        aria-label="Enable watcher"
                        checked={watcherDraft.enabled}
                        onCheckedChange={(checked) => patchWatcherDraft({ enabled: checked })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Interval minutes</span>
                      <Input
                        inputMode="numeric"
                        value={watcherDraft.intervalMinutes}
                        onChange={(event) => patchWatcherDraft({ intervalMinutes: event.currentTarget.value })}
                      />
                    </label>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button size="sm" variant="secondary" onClick={saveWatcher}>
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

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              {memberError ? (
                <p className="m-0 text-sm text-destructive">{memberError}</p>
              ) : null}
              <Button onClick={saveConfig}>Save member config</Button>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
