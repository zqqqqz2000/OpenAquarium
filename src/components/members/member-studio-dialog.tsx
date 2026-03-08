import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";

import { Clock3, Eye, Hammer, KeyRound, Plus, ScanSearch, Star, Trash2, X } from "lucide-react";

import type { Room, TeamMember, UpdateMemberConfigInput, WorkspaceSnapshot } from "@/domain/model";
import { buildMemberCliCommands } from "@/domain/tooling";
import { MessageBubble } from "@/components/chat/message-bubble";
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
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getMemberHistory } from "@/lib/message-feed";
import { wobbly } from "@/lib/utils";

export function MemberStudioDialog(props: {
  snapshot: WorkspaceSnapshot;
  room?: Room;
  member?: TeamMember;
  onClose: () => void;
  onToggleMonitor: (memberId: string) => void | Promise<void>;
  onSaveConfig: (input: UpdateMemberConfigInput) => void | Promise<void>;
  onSetEntryMember: (memberId: string) => void | Promise<void>;
  onSaveWatcher: (input: { memberId: string; enabled: boolean; intervalMinutes: number }) => void | Promise<void>;
  onRunWatcher: (watcherId: string) => void;
}) {
  const { snapshot, room, member, onClose, onToggleMonitor, onSaveConfig, onSetEntryMember, onSaveWatcher, onRunWatcher } = props;
  const [configDrafts, setConfigDrafts] = useState<Record<string, MemberConfigDraft>>({});
  const [watcherDrafts, setWatcherDrafts] = useState<Record<string, WatcherDraft>>({});
  const [errorByMember, setErrorByMember] = useState<Record<string, string | undefined>>({});

  if (!room || !member) {
    return null;
  }

  const activeTask = member.activeTaskId ? snapshot.tasks[member.activeTaskId] : undefined;
  const watcher = getWatcherForMember(room, snapshot, member.id);
  const cliCommands = buildMemberCliCommands(room, member);
  const memberHistory = getMemberHistory(snapshot, room, member);
  const configDraft = configDrafts[member.id] ?? createMemberConfigDraft(member);
  const watcherDraft = watcherDrafts[member.id] ?? createWatcherDraft(watcher);
  const error = errorByMember[member.id];

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
    <Dialog.Root open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed inset-x-3 top-4 z-50 mx-auto w-[min(96vw,1160px)] max-w-[1160px] outline-none md:inset-x-6">
          <Card className="max-h-[92vh] overflow-hidden p-4 md:p-5" tone="paper" tack>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="m-0 text-4xl">Member Studio</Dialog.Title>
                <Dialog.Description className="m-0 text-xl opacity-72">
                  深配置收进这里。主聊天页只保留概览和入口动作。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button className="rounded-none text-[var(--ink)]" type="button" aria-label="Close member studio">
                  <X size={24} />
                </button>
              </Dialog.Close>
            </div>

            <div className="grid max-h-[calc(92vh-88px)] gap-4 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
              <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
                <Card className="flex flex-col gap-4 p-4" tone={member.accentTone}>
                  <MemberAvatar member={member} active />
                  <p className="m-0 text-lg leading-6">{member.summary}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="paper">{member.provider.label}</Badge>
                    <Badge tone="blueprint">{member.skills.length} skills</Badge>
                    {member.isEntryMember ? <Badge tone="postit">Entry member</Badge> : null}
                    {member.observeAllRoomMessages ? <Badge tone="blueprint">Monitor all</Badge> : null}
                    {watcher ? <Badge tone="correction">Watcher {watcher.intervalMinutes}m</Badge> : null}
                  </div>
                </Card>

                <Card className="flex flex-col gap-3 p-4" tone="postit">
                  <p className="m-0 text-2xl">At a glance</p>
                  <div className="grid grid-cols-2 gap-2 text-lg">
                    <div className="rough-dashed-frame bg-white px-3 py-2" style={wobbly.note}>
                      <p className="m-0 text-sm uppercase tracking-[0.18em] opacity-55">Status</p>
                      <p className="m-0">{member.status}</p>
                    </div>
                    <div className="rough-dashed-frame bg-white px-3 py-2" style={wobbly.note}>
                      <p className="m-0 text-sm uppercase tracking-[0.18em] opacity-55">Direct inbox</p>
                      <p className="m-0">{member.acceptsDirectMessages ? "Open" : "Closed"}</p>
                    </div>
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
                </Card>

                {activeTask ? (
                  <Card className="flex flex-col gap-2 p-4" tone="correction">
                    <p className="m-0 text-2xl">Current task</p>
                    <p className="m-0 text-xl">{activeTask.title}</p>
                    <p className="m-0 text-lg opacity-70">status: {activeTask.status}</p>
                    <p className="m-0 text-base uppercase tracking-[0.16em] opacity-60">source message</p>
                    <p className="m-0 text-lg">{snapshot.messages[activeTask.sourceMessageId]?.content}</p>
                  </Card>
                ) : null}
              </div>

              <Tabs.Root defaultValue="history" className="flex min-h-0 flex-col gap-4 overflow-hidden">
                <Tabs.List className="flex flex-wrap gap-2">
                  {[
                    ["history", "History"],
                    ["behavior", "Behavior"],
                    ["provider", "ACP"],
                    ["skills", "Skills"],
                    ["watcher", "Watcher"],
                    ["cli", "CLI"],
                  ].map(([value, label]) => (
                    <Tabs.Trigger
                      key={value}
                      value={value}
                      className="rough-button min-h-11 px-4 py-2 text-lg data-[state=active]:bg-[var(--accent)] data-[state=active]:text-white"
                      style={wobbly.pill}
                    >
                      {label}
                    </Tabs.Trigger>
                  ))}
                </Tabs.List>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <Tabs.Content value="history" className="m-0">
                    <Card className="flex flex-col gap-4 p-4" tone="paper">
                      <div>
                        <p className="m-0 text-2xl">Processing history</p>
                        <p className="m-0 text-lg opacity-70">这里不是全量群聊，而是当前成员真正接收、处理、回复过的消息链。</p>
                      </div>
                      <div className="flex flex-col gap-4">
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
                          <Card className="p-5" tone="postit">
                            <p className="m-0 text-xl">这个成员还没有接到过消息，也没有留下处理痕迹。</p>
                          </Card>
                        ) : null}
                      </div>
                    </Card>
                  </Tabs.Content>

                  <Tabs.Content value="behavior" className="m-0">
                    <Card className="flex flex-col gap-4 p-4" tone="paper">
                      <div>
                        <p className="m-0 text-2xl">Behavior</p>
                        <p className="m-0 text-lg opacity-70">职责由 prompt、skills 和 provider 组合出来，不写死在系统里。</p>
                      </div>
                      <label className="flex flex-col gap-2">
                        <span className="text-xl">Summary</span>
                        <Input value={configDraft.summary} onChange={(event) => patchConfigDraft({ summary: event.currentTarget.value })} />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-xl">Prompt</span>
                        <Textarea
                          value={configDraft.prompt}
                          onChange={(event) => patchConfigDraft({ prompt: event.currentTarget.value })}
                          minRows={10}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2 text-xl">
                          <KeyRound size={18} />
                          Accept direct messages
                        </span>
                        <Switch
                          aria-label="Accept direct messages"
                          checked={configDraft.acceptsDirectMessages}
                          onCheckedChange={(checked) => patchConfigDraft({ acceptsDirectMessages: checked })}
                        />
                      </label>
                      <label className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-2 text-xl">
                          <Eye size={18} />
                          Monitor all room messages
                        </span>
                        <Switch
                          aria-label="Monitor all room messages"
                          checked={member.observeAllRoomMessages}
                          onCheckedChange={() => void onToggleMonitor(member.id)}
                        />
                      </label>
                    </Card>
                  </Tabs.Content>

                  <Tabs.Content value="provider" className="m-0">
                    <Card className="flex flex-col gap-3 p-4" tone="blueprint">
                      <div className="flex items-center gap-2">
                        <ScanSearch size={18} />
                        <p className="m-0 text-2xl">ACP provider</p>
                      </div>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Label</span>
                        <Input value={configDraft.providerLabel} onChange={(event) => patchConfigDraft({ providerLabel: event.currentTarget.value })} />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Command</span>
                        <Input value={configDraft.providerCommand} onChange={(event) => patchConfigDraft({ providerCommand: event.currentTarget.value })} />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Args (one per line)</span>
                        <Textarea
                          value={configDraft.providerArgsText}
                          onChange={(event) => patchConfigDraft({ providerArgsText: event.currentTarget.value })}
                          minRows={4}
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Capabilities (comma or newline separated)</span>
                        <Textarea
                          value={configDraft.providerCapabilitiesText}
                          onChange={(event) => patchConfigDraft({ providerCapabilitiesText: event.currentTarget.value })}
                          minRows={3}
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Working directory</span>
                        <Input
                          value={configDraft.providerWorkingDirectory}
                          onChange={(event) => patchConfigDraft({ providerWorkingDirectory: event.currentTarget.value })}
                          placeholder="/absolute/or/relative/path"
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Environment (KEY=VALUE per line)</span>
                        <Textarea
                          value={configDraft.providerEnvText}
                          onChange={(event) => patchConfigDraft({ providerEnvText: event.currentTarget.value })}
                          minRows={4}
                        />
                      </label>
                    </Card>
                  </Tabs.Content>

                  <Tabs.Content value="skills" className="m-0">
                    <Card className="flex flex-col gap-3 p-4" tone="postit">
                      <div className="flex items-center gap-2">
                        <Hammer size={18} />
                        <p className="m-0 text-2xl">Skill commands</p>
                      </div>
                      {configDraft.skills.map((skill, index) => (
                        <div
                          key={skill.id}
                          className="rough-dashed-frame flex flex-col gap-2 bg-white px-3 py-3"
                          style={wobbly.note}
                        >
                          <div className="flex justify-between gap-3">
                            <p className="m-0 text-base uppercase tracking-[0.16em] opacity-60">Skill {index + 1}</p>
                            <button
                              className="text-[var(--ink)]"
                              type="button"
                              onClick={() =>
                                patchConfigDraft({
                                  skills: configDraft.skills.filter((candidate) => candidate.id !== skill.id),
                                })
                              }
                            >
                              <Trash2 size={16} />
                            </button>
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
                            value={skill.command}
                            onChange={(event) =>
                              patchConfigDraft({
                                skills: configDraft.skills.map((candidate) =>
                                  candidate.id === skill.id ? { ...candidate, command: event.currentTarget.value } : candidate,
                                ),
                              })
                            }
                            minRows={2}
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
                    </Card>
                  </Tabs.Content>

                  <Tabs.Content value="watcher" className="m-0">
                    <Card className="flex flex-col gap-3 p-4" tone="paper">
                      <div className="flex items-center gap-2">
                        <Clock3 size={18} />
                        <p className="m-0 text-2xl">Watcher</p>
                      </div>
                      <label className="flex items-center justify-between gap-4">
                        <span className="text-xl">Enable scheduled watcher</span>
                        <Switch
                          aria-label="Enable watcher"
                          checked={watcherDraft.enabled}
                          onCheckedChange={(checked) => patchWatcherDraft({ enabled: checked })}
                        />
                      </label>
                      <label className="flex flex-col gap-2">
                        <span className="text-lg">Interval minutes</span>
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
                    </Card>
                  </Tabs.Content>

                  <Tabs.Content value="cli" className="m-0">
                    <Card className="flex flex-col gap-3 p-4" tone="blueprint">
                      <p className="m-0 text-2xl">CLI preview</p>
                      {cliCommands.map((command) => (
                        <div
                          key={command.id}
                          className="rough-dashed-frame bg-white px-3 py-2"
                          style={wobbly.note}
                        >
                          <p className="m-0 text-base uppercase tracking-[0.16em] opacity-60">{command.label}</p>
                          <p className="m-0 break-all text-lg">{command.command}</p>
                        </div>
                      ))}
                    </Card>
                  </Tabs.Content>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t-[3px] border-dashed border-[var(--ink)] pt-4">
                  {error ? <p className="m-0 text-lg text-[var(--accent)]">{error}</p> : <span className="text-lg opacity-65">修改只在这里集中保存，不再挤在主页面右栏。</span>}
                  <Button onClick={saveConfig}>Save member config</Button>
                </div>
              </Tabs.Root>
            </div>
          </Card>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
