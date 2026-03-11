import { useEffect, useMemo, useState } from "react";

import { LoaderCircle, Plus, Save, Settings2, Star, Trash2, Users } from "lucide-react";

import type { GlobalWorkspaceConfig, Room, TeamMember, UpdateRoomTeamInput, WorkspaceSnapshot } from "@/domain/model";
import { addEmptySkillDraft, type SkillDraft } from "@/lib/member-config-draft";
import {
  addEmptyRoomTeamMemberDraft,
  buildRoomTeamInput,
  createRoomTeamDraft,
  removeRoomTeamMemberDraft,
  type RoomTeamDraft,
  type RoomTeamMemberDraft,
} from "@/lib/room-team-draft";
import { resolveRoomTeamSummary } from "@/lib/room-team";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const ACCENT_TONES = ["paper", "postit", "blueprint", "correction"] as const;

function resolveProfileLabel(args: {
  modelProfileId?: string;
  providerLabel: string;
  globalConfig: GlobalWorkspaceConfig;
}): string {
  return args.globalConfig.modelProfiles.find((profile) => profile.id === args.modelProfileId)?.name ?? args.providerLabel;
}

function RoomMemberDeleteTrigger(props: {
  disabled: boolean;
  member: RoomTeamMemberDraft;
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
          <AlertDialogTitle>{`Remove ${member.name} from this room?`}</AlertDialogTitle>
          <AlertDialogDescription>
            This only changes the current room team. Existing history stays in the room transcript.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel size="sm">Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" size="sm" onClick={onConfirm}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SkillEditor(props: {
  skill: SkillDraft;
  index: number;
  onChange: (nextSkill: SkillDraft) => void;
  onRemove: () => void;
}) {
  const { skill, index, onChange, onRemove } = props;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-muted/35 px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Skill {index + 1}</p>
        <Button variant="ghost" size="icon-sm" type="button" onClick={onRemove}>
          <Trash2 size={16} />
        </Button>
      </div>
      <Input value={skill.name} onChange={(event) => onChange({ ...skill, name: event.currentTarget.value })} placeholder="Skill name" />
      <Input
        value={skill.description}
        onChange={(event) => onChange({ ...skill, description: event.currentTarget.value })}
        placeholder="What this skill is for"
      />
      <Textarea
        className="min-h-20"
        value={skill.command}
        onChange={(event) => onChange({ ...skill, command: event.currentTarget.value })}
        placeholder="./bin/oa-room-send --scope group"
      />
    </div>
  );
}

export function RoomTeamDialog(props: {
  open: boolean;
  snapshot: WorkspaceSnapshot;
  room?: Room;
  globalConfig: GlobalWorkspaceConfig;
  onClose: () => void;
  onSave: (input: UpdateRoomTeamInput) => void | Promise<void>;
}) {
  const { open, snapshot, room, globalConfig, onClose, onSave } = props;
  const [draft, setDraft] = useState<RoomTeamDraft | undefined>(undefined);
  const [activeMemberId, setActiveMemberId] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const roomSeedKey = room
    ? [
        room.id,
        room.memberIds.join(","),
        room.teamName ?? "",
        room.teamDescription ?? "",
        room.teamAccentTone ?? "",
      ].join(":")
    : "no-room";

  useEffect(() => {
    if (!open || !room) {
      return;
    }

    const nextDraft = createRoomTeamDraft(snapshot, room);
    setDraft(nextDraft);
    setActiveMemberId((current) => current && nextDraft.members.some((member) => member.id === current) ? current : nextDraft.members[0]?.id);
    setError(undefined);
  }, [open, room, roomSeedKey, snapshot]);

  const activeMember = draft?.members.find((member) => member.id === activeMemberId) ?? draft?.members[0];
  const roomTeam = room ? resolveRoomTeamSummary(snapshot, room) : undefined;
  const teamBadge = badgeToneProps(draft?.accentTone ?? roomTeam?.accentTone ?? "paper");

  const patchDraft = (patch: Partial<RoomTeamDraft>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const patchMemberDraft = (memberId: string, patch: Partial<RoomTeamMemberDraft>): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member)),
          }
        : current,
    );
  };

  const setEntryMember = (memberId: string): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) => ({
              ...member,
              isEntryMember: member.id === memberId,
            })),
          }
        : current,
    );
  };

  const addMemberDraft = (): void => {
    if (!draft) {
      return;
    }

    const nextMembers = addEmptyRoomTeamMemberDraft(draft.members, {
      teamAccentTone: draft.accentTone,
      baseMember: activeMember ?? draft.members[0],
    });
    const nextMember = nextMembers.at(-1);
    setDraft({
      ...draft,
      members: nextMembers,
    });
    setActiveMemberId(nextMember?.id);
  };

  const deleteMemberDraft = (memberId: string): void => {
    if (!draft) {
      return;
    }

    const nextMembers = removeRoomTeamMemberDraft(draft.members, memberId);
    setDraft({
      ...draft,
      members: nextMembers,
    });
    setActiveMemberId((current) => (current === memberId ? nextMembers[0]?.id : current));
  };

  const saveRoomTeam = async (): Promise<void> => {
    if (!room || !draft) {
      return;
    }

    try {
      setSaving(true);
      setError(undefined);
      await onSave(buildRoomTeamInput(room, draft));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSaving(false);
    }
  };

  const memberCountBadge = useMemo(
    () => draft?.members.length ?? room?.memberIds.length ?? 0,
    [draft?.members.length, room?.memberIds.length],
  );

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent className="h-[min(92vh,72rem)] max-w-[min(96vw,88rem)] p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <DialogTitle className="flex items-center gap-2 text-2xl tracking-tight">
                <Users size={20} />
                Room Team
              </DialogTitle>
              <DialogDescription className="max-w-3xl text-sm leading-6">
                这里改的是当前 room 里的团队结构和成员实例配置，不会同步回 team template。
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={teamBadge.variant} className={teamBadge.className}>
                {memberCountBadge} members
              </Badge>
              <Button onClick={() => void saveRoomTeam()} disabled={!room || !draft || saving}>
                {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                Save room team
              </Button>
            </div>
          </div>
        </DialogHeader>

        {!room || !draft ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a room to edit its team.</div>
        ) : (
          <div className="grid h-full min-h-0 gap-4 px-6 py-5 xl:grid-cols-[300px_minmax(0,1fr)]">
            <section className="min-h-0 overflow-hidden rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
              <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
                <div className="space-y-2 rounded-2xl border border-dashed border-border/80 bg-muted/20 px-4 py-4">
                  <div className="flex items-center gap-2">
                    <Settings2 size={16} />
                    <p className="m-0 text-sm font-medium">Room-scoped team</p>
                  </div>
                  <p className="m-0 text-sm leading-6 text-muted-foreground">
                    当前 room 会保留自己的 team name、tone、成员构成和 watcher 配置。
                  </p>
                  <p className="m-0 text-xs text-muted-foreground">Source template: {roomTeam?.sourceTemplateId ?? room.templateId}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-base font-semibold tracking-tight">Room members</p>
                    <Badge variant="outline">{draft.members.length}</Badge>
                  </div>
                  <Button size="sm" variant="secondary" type="button" onClick={addMemberDraft}>
                    <Plus size={16} />
                    Add member
                  </Button>
                </div>

                <ScrollArea className="min-h-0 flex-1" data-testid="room-team-members-scroll">
                  <div className="flex flex-col gap-2 pr-3">
                    {draft.members.map((member) => {
                      const memberBadge = badgeToneProps(member.accentTone);
                      const profileLabel = resolveProfileLabel({
                        modelProfileId: member.modelProfileId,
                        providerLabel: member.provider.label,
                        globalConfig,
                      });

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
                            onClick={() => setActiveMemberId(member.id)}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="m-0 text-sm font-semibold">{member.name}</p>
                              <Badge variant="outline">@{member.handle}</Badge>
                              {member.isEntryMember ? <Badge variant="secondary">Entry</Badge> : null}
                              <Badge variant={memberBadge.variant} className={memberBadge.className}>
                                {profileLabel}
                              </Badge>
                            </div>
                            <p className="m-0 mt-2 text-sm text-muted-foreground">{member.summary}</p>
                          </button>
                          <RoomMemberDeleteTrigger
                            disabled={draft.members.length <= 1}
                            member={member}
                            onConfirm={() => deleteMemberDraft(member.id)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </section>

            <ScrollArea className="min-h-0 h-full" data-testid="room-team-detail-scroll">
              <div className="flex flex-col gap-4 pr-3 pb-4">
                <section className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="m-0 text-lg font-semibold tracking-tight">{draft.name}</p>
                      <Badge variant={teamBadge.variant} className={teamBadge.className}>
                        {draft.members.length} members
                      </Badge>
                    </div>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Team name</span>
                      <Input value={draft.name} onChange={(event) => patchDraft({ name: event.currentTarget.value })} />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Description</span>
                      <Textarea
                        className="min-h-24"
                        value={draft.description}
                        onChange={(event) => patchDraft({ description: event.currentTarget.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Accent tone</span>
                      <Select value={draft.accentTone} onValueChange={(value) => patchDraft({ accentTone: value as RoomTeamDraft["accentTone"] })}>
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
                  </div>
                </section>

                {activeMember ? (
                  <section className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="m-0 text-lg font-semibold tracking-tight">Member config</p>
                          <p className="m-0 text-sm text-muted-foreground">These settings only affect the current room team.</p>
                        </div>
                        {activeMember.isEntryMember ? (
                          <Badge variant="secondary">Entry member</Badge>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => setEntryMember(activeMember.id)}>
                            <Star size={16} />
                            Set as entry member
                          </Button>
                        )}
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="flex flex-col gap-2">
                          <span className="text-sm font-medium">Name</span>
                          <Input value={activeMember.name} onChange={(event) => patchMemberDraft(activeMember.id, { name: event.currentTarget.value })} />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-sm font-medium">Handle</span>
                          <Input value={activeMember.handle} onChange={(event) => patchMemberDraft(activeMember.id, { handle: event.currentTarget.value })} />
                        </label>
                      </div>

                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Summary</span>
                        <Input value={activeMember.summary} onChange={(event) => patchMemberDraft(activeMember.id, { summary: event.currentTarget.value })} />
                      </label>

                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Prompt</span>
                        <Textarea
                          className="min-h-36"
                          value={activeMember.prompt}
                          onChange={(event) => patchMemberDraft(activeMember.id, { prompt: event.currentTarget.value })}
                        />
                      </label>

                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Model profile</span>
                        <Select
                          value={activeMember.modelProfileId ?? globalConfig.modelProfiles[0]?.id}
                          onValueChange={(value) => patchMemberDraft(activeMember.id, { modelProfileId: value })}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select a global model profile" />
                          </SelectTrigger>
                          <SelectContent>
                            {globalConfig.modelProfiles.map((profile) => (
                              <SelectItem key={profile.id} value={profile.id}>
                                {profile.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </label>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                          <span className="text-sm font-medium">Accept direct messages</span>
                          <Switch
                            aria-label="Room team accept direct messages"
                            checked={activeMember.acceptsDirectMessages}
                            onCheckedChange={(checked) => patchMemberDraft(activeMember.id, { acceptsDirectMessages: checked })}
                          />
                        </label>
                        <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                          <span className="text-sm font-medium">Monitor all room messages</span>
                          <Switch
                            aria-label="Room team monitor all room messages"
                            checked={activeMember.observeAllRoomMessages}
                            onCheckedChange={(checked) => patchMemberDraft(activeMember.id, { observeAllRoomMessages: checked })}
                          />
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                          <span className="text-sm font-medium">Watcher configured</span>
                          <Switch
                            aria-label="Room team watcher configured"
                            checked={activeMember.watchConfigured}
                            onCheckedChange={(checked) =>
                              patchMemberDraft(activeMember.id, {
                                watchConfigured: checked,
                                watchEnabled: checked ? activeMember.watchEnabled : false,
                              })}
                          />
                        </label>
                        <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                          <span className="text-sm font-medium">Watcher enabled</span>
                          <Switch
                            aria-label="Room team watcher enabled"
                            checked={activeMember.watchEnabled}
                            disabled={!activeMember.watchConfigured}
                            onCheckedChange={(checked) => patchMemberDraft(activeMember.id, { watchEnabled: checked })}
                          />
                        </label>
                        <label className="flex flex-col gap-2">
                          <span className="text-sm font-medium">Watcher interval</span>
                          <Input
                            inputMode="numeric"
                            value={activeMember.watchIntervalMinutes}
                            disabled={!activeMember.watchConfigured}
                            onChange={(event) => patchMemberDraft(activeMember.id, { watchIntervalMinutes: event.currentTarget.value })}
                          />
                        </label>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="m-0 text-sm font-medium">Skills</p>
                          <Button
                            size="sm"
                            variant="secondary"
                            type="button"
                            onClick={() =>
                              patchMemberDraft(activeMember.id, {
                                skills: addEmptySkillDraft(activeMember.skills),
                              })}
                          >
                            <Plus size={16} />
                            Add skill
                          </Button>
                        </div>
                        <div className="flex flex-col gap-3">
                          {activeMember.skills.map((skill, index) => (
                            <SkillEditor
                              key={skill.id}
                              skill={skill}
                              index={index}
                              onChange={(nextSkill) =>
                                patchMemberDraft(activeMember.id, {
                                  skills: activeMember.skills.map((candidate) => (candidate.id === skill.id ? nextSkill : candidate)),
                                })}
                              onRemove={() =>
                                patchMemberDraft(activeMember.id, {
                                  skills: activeMember.skills.filter((candidate) => candidate.id !== skill.id),
                                })}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  {error ? <p className="m-0 text-sm text-destructive">{error}</p> : <div />}
                  <Button onClick={() => void saveRoomTeam()} disabled={saving}>
                    {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Save size={16} />}
                    Save room team
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
