import { useEffect, useMemo, useRef, useState } from "react";

import { LoaderCircle, Plus, Save, Settings2, Star, Trash2, Users } from "lucide-react";

import type { GlobalWorkspaceConfig, Room, UpdateRoomTeamInput, WorkspaceSnapshot } from "@/domain/model";
import { AllowedSkillSelector } from "@/components/skills/allowed-skill-selector";
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
import { ProviderModelSelects } from "@/components/members/provider-model-selects";
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
const CODEX_THINKING_DEPTHS = ["low", "mid", "high", "extra-high"] as const;

function resolveProfileLabel(args: {
  modelProfileId?: string;
  providerLabel: string;
  globalConfig: GlobalWorkspaceConfig;
}): string {
  return args.globalConfig.modelProfiles.find((profile) => profile.id === args.modelProfileId)?.name ?? args.providerLabel;
}

function supportsCodexThinkingDepth(args: {
  modelProfileId?: string;
  providerKind: string;
  globalConfig: GlobalWorkspaceConfig;
}): boolean {
  const selectedProfile = args.globalConfig.modelProfiles.find((profile) => profile.id === args.modelProfileId);
  return ((selectedProfile?.providerType === "acp" ? selectedProfile.binding.kind : undefined) ?? args.providerKind) === "codex-acp";
}

interface RoleGroupDraft {
  roleId: string;
  roleName: string;
  members: RoomTeamMemberDraft[];
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
  const seededRoomIdRef = useRef<string | undefined>(undefined);
  const seededRoomSignatureRef = useRef<string | undefined>(undefined);
  const lastSavedSignatureRef = useRef<string | undefined>(undefined);

  const roomSeedDraft = useMemo(
    () => (open && room ? createRoomTeamDraft(snapshot, room) : undefined),
    [open, room, snapshot],
  );
  useEffect(() => {
    if (!open || !room || !roomSeedDraft) {
      return;
    }

    const nextSeedSignature = JSON.stringify(buildRoomTeamInput(room, roomSeedDraft));
    const currentDraftSignature = draft ? JSON.stringify(buildRoomTeamInput(room, draft)) : undefined;
    const draftIsDirty =
      currentDraftSignature !== undefined
      && seededRoomSignatureRef.current !== undefined
      && currentDraftSignature !== seededRoomSignatureRef.current;
    const shouldPreserveLocalDraft =
      seededRoomIdRef.current === room.id
      && nextSeedSignature !== seededRoomSignatureRef.current
      && draftIsDirty
      && lastSavedSignatureRef.current !== nextSeedSignature;

    if (shouldPreserveLocalDraft || seededRoomSignatureRef.current === nextSeedSignature) {
      return;
    }

    const nextDraft = roomSeedDraft;
    seededRoomIdRef.current = room.id;
    seededRoomSignatureRef.current = nextSeedSignature;
    lastSavedSignatureRef.current = undefined;
    setDraft(roomSeedDraft);
    setActiveMemberId((current) => (current && nextDraft.members.some((member) => member.id === current) ? current : nextDraft.members[0]?.id));
    setError(undefined);
  }, [draft, open, room, roomSeedDraft]);

  useEffect(() => {
    if (open) {
      return;
    }

    seededRoomIdRef.current = undefined;
    seededRoomSignatureRef.current = undefined;
    lastSavedSignatureRef.current = undefined;
  }, [open]);

  const activeMember = draft?.members.find((member) => member.id === activeMemberId) ?? draft?.members[0];
  const roomTeam = room ? resolveRoomTeamSummary(snapshot, room) : undefined;
  const teamBadge = badgeToneProps(draft?.accentTone ?? roomTeam?.accentTone ?? "paper");
  const roleGroups = useMemo<RoleGroupDraft[]>(
    () =>
      (draft?.members ?? []).reduce<RoleGroupDraft[]>((groups, member) => {
        const existingGroup = groups.find((group) => group.roleId === member.roleId);
        if (existingGroup) {
          existingGroup.members.push(member);
          return groups;
        }

        return [...groups, { roleId: member.roleId, roleName: member.roleName, members: [member] }];
      }, []),
    [draft?.members],
  );
  const activeRoleGroup = activeMember ? roleGroups.find((group) => group.roleId === activeMember.roleId) : undefined;
  const isActiveRoleTemplate = Boolean(activeMember && activeRoleGroup?.members[0]?.id === activeMember.id);

  const patchDraft = (patch: Partial<RoomTeamDraft>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const patchMemberDraft = (memberId: string, patch: Partial<RoomTeamMemberDraft>): void => {
    setDraft((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) => {
              if (member.id === memberId) {
                return { ...member, ...patch };
              }

              if (patch.roleName && current.members.find((candidate) => candidate.id === memberId)?.roleId === member.roleId) {
                return { ...member, roleName: patch.roleName };
              }

              return member;
            }),
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

  const setRoleEnabled = (memberId: string, checked: boolean): void => {
    patchMemberDraft(memberId, {
      isRole: checked,
      watchConfigured: checked ? false : activeMember?.watchConfigured,
      watchEnabled: checked ? false : activeMember?.watchEnabled,
      watchPersistent: checked ? false : activeMember?.watchPersistent,
    });
  };

  const addMemberDraft = (): void => {
    if (!draft) {
      return;
    }

    const seededMembers = addEmptyRoomTeamMemberDraft(draft.members, {
      teamAccentTone: draft.accentTone,
      baseMember: activeMember ?? draft.members[0],
      mode: "role-template",
    });
    const nextMember = seededMembers.at(-1);
    setDraft({
      ...draft,
      members: seededMembers,
    });
    setActiveMemberId(nextMember?.id);
  };

  const addRoleEmployeeDraft = (baseMember: RoomTeamMemberDraft): void => {
    if (!draft) {
      return;
    }

    const nextMembers = addEmptyRoomTeamMemberDraft(draft.members, {
      teamAccentTone: draft.accentTone,
      baseMember,
      mode: "employee",
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
      lastSavedSignatureRef.current = JSON.stringify(buildRoomTeamInput(room, draft));
      await onSave(buildRoomTeamInput(room, draft));
    } catch (nextError) {
      lastSavedSignatureRef.current = undefined;
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
      <DialogContent className="h-[min(92vh,72rem)] w-[min(96vw,88rem)] max-w-[88rem] overflow-hidden p-0 sm:max-w-[88rem]">
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
                    当前 room 会保留自己的 team name、tone、岗位模板、员工构成和 watcher 配置。
                  </p>
                  <p className="m-0 text-xs text-muted-foreground">Source template: {roomTeam?.sourceTemplateId ?? room.templateId}</p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-base font-semibold tracking-tight">Role templates</p>
                    <Badge variant="outline">{draft.members.length}</Badge>
                  </div>
                  <Button size="sm" variant="secondary" type="button" onClick={addMemberDraft}>
                    <Plus size={16} />
                    Add role
                  </Button>
                </div>

                <ScrollArea className="min-h-0 flex-1" data-testid="room-team-members-scroll">
                  <div className="flex flex-col gap-2 pr-3">
                    {roleGroups.map((group) => {
                      const baseMember = group.members[0];
                      if (!baseMember) {
                        return null;
                      }

                      const memberBadge = badgeToneProps(baseMember.accentTone);
                      const profileLabel = resolveProfileLabel({
                        modelProfileId: baseMember.modelProfileId,
                        providerLabel: baseMember.provider.label,
                        globalConfig,
                      });

                      return (
                        <div key={group.roleId} className="rounded-xl border border-border/70 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <button
                              type="button"
                              className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left"
                              onClick={() => setActiveMemberId(baseMember.id)}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="m-0 text-sm font-semibold">{group.roleName}</p>
                                <Badge variant="outline">{group.members.length} staff</Badge>
                                {baseMember.isEntryMember ? <Badge variant="secondary">Entry</Badge> : null}
                                <Badge variant={memberBadge.variant} className={memberBadge.className}>
                                  {profileLabel}
                                </Badge>
                              </div>
                              <p className="m-0 mt-2 text-sm text-muted-foreground">{baseMember.summary}</p>
                            </button>
                            <Button size="sm" variant="ghost" type="button" onClick={() => addRoleEmployeeDraft(baseMember)}>
                              <Plus size={16} />
                              Add employee
                            </Button>
                          </div>
                          <div className="mt-3 flex flex-col gap-2">
                            {group.members.map((member) => (
                              <div
                                key={member.id}
                                className={cn(
                                  "flex items-start gap-2 rounded-xl border border-border/60 px-3 py-2.5 transition-colors",
                                  member.id === activeMember?.id && "border-ring bg-accent/10",
                                )}
                              >
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-left"
                                  onClick={() => setActiveMemberId(member.id)}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="m-0 text-sm font-medium">{member.name}</p>
                                    <Badge variant="outline">@{member.handle}</Badge>
                                  </div>
                                  {member.note ? <p className="m-0 mt-1 text-xs text-muted-foreground">{member.note}</p> : null}
                                </button>
                                <RoomMemberDeleteTrigger
                                  disabled={draft.members.length <= 1}
                                  member={member}
                                  onConfirm={() => deleteMemberDraft(member.id)}
                                />
                              </div>
                            ))}
                          </div>
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
                          <p className="m-0 text-sm text-muted-foreground">Role templates can edit full defaults. Added employees only edit name and note.</p>
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
                          <span className="text-sm font-medium">Role</span>
                          <Input value={activeMember.roleName} onChange={(event) => patchMemberDraft(activeMember.id, { roleName: event.currentTarget.value })} />
                        </label>
                      </div>

                      <label className="flex flex-col gap-2">
                        <span className="text-sm font-medium">Note</span>
                        <Textarea
                          className="min-h-24"
                          value={activeMember.note ?? ""}
                          onChange={(event) => patchMemberDraft(activeMember.id, { note: event.currentTarget.value })}
                        />
                      </label>

                      {isActiveRoleTemplate ? (
                        <>
                          <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                            <span className="text-sm font-medium">Role owner</span>
                            <Switch
                              aria-label="Room team role owner"
                              checked={activeMember.isRole}
                              onCheckedChange={(checked) => setRoleEnabled(activeMember.id, checked)}
                            />
                          </label>
                          <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                            {activeMember.isRole
                              ? "Role owner 可以挂员工并接收 `oa_role_*` 扩编操作；同时不能配置 Watch。若要关闭它，必须先移除这个岗位下的员工。"
                              : "关闭后，这个成员会变成普通成员，不再作为岗位 owner 接收扩编。若这个岗位下还有员工，保存时会被阻止。"}
                          </div>
                          <label className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Handle</span>
                            <Input value={activeMember.handle} onChange={(event) => patchMemberDraft(activeMember.id, { handle: event.currentTarget.value })} />
                          </label>

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
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                          这个员工继承岗位模板的 prompt、allowedSkillIds、provider 和 watcher 配置；本阶段只开放名字和备注。
                        </div>
                      )}

                      {isActiveRoleTemplate ? (
                        <div className="grid gap-4 md:grid-cols-2">
                          <ProviderModelSelects
                            globalConfig={globalConfig}
                            allowedProviderTypes={["acp"]}
                            modelProfileId={activeMember.modelProfileId}
                            modelId={activeMember.modelId}
                            onProviderChange={(value) => patchMemberDraft(activeMember.id, { modelProfileId: value })}
                            onModelChange={(value) => patchMemberDraft(activeMember.id, { modelId: value })}
                          />
                        </div>
                      ) : null}
                      {isActiveRoleTemplate ? (
                        <>
                          {supportsCodexThinkingDepth({
                            modelProfileId: activeMember.modelProfileId,
                            providerKind: activeMember.provider.kind,
                            globalConfig,
                          }) ? (
                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-medium">Codex thinking depth</span>
                              <Select
                                value={activeMember.codexThinkingDepth ?? "high"}
                                onValueChange={(value) => patchMemberDraft(activeMember.id, { codexThinkingDepth: value as (typeof CODEX_THINKING_DEPTHS)[number] })}
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

                          <div className="grid gap-3 md:grid-cols-4">
                            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                              <span className="text-sm font-medium">Watcher configured</span>
                              <Switch
                                aria-label="Room team watcher configured"
                                checked={activeMember.watchConfigured}
                                disabled={activeMember.isRole}
                                onCheckedChange={(checked) =>
                                  patchMemberDraft(activeMember.id, {
                                    watchConfigured: checked,
                                    watchEnabled: checked ? activeMember.watchEnabled : false,
                                    watchPersistent: checked ? activeMember.watchPersistent : false,
                                  })}
                              />
                            </label>
                            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                              <span className="text-sm font-medium">Watcher enabled</span>
                              <Switch
                                aria-label="Room team watcher enabled"
                                checked={activeMember.watchEnabled}
                                disabled={activeMember.isRole || !activeMember.watchConfigured}
                                onCheckedChange={(checked) => patchMemberDraft(activeMember.id, { watchEnabled: checked })}
                              />
                            </label>
                            <label className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                              <span className="text-sm font-medium">Persistent watch</span>
                              <Switch
                                aria-label="Room team persistent watch"
                                checked={activeMember.watchPersistent}
                                disabled={activeMember.isRole || !activeMember.watchConfigured}
                                onCheckedChange={(checked) => patchMemberDraft(activeMember.id, { watchPersistent: checked })}
                              />
                            </label>
                            <label className="flex flex-col gap-2">
                              <span className="text-sm font-medium">Watcher interval</span>
                              <Input
                                inputMode="numeric"
                                value={activeMember.watchIntervalMinutes}
                                disabled={activeMember.isRole || !activeMember.watchConfigured}
                                onChange={(event) => patchMemberDraft(activeMember.id, { watchIntervalMinutes: event.currentTarget.value })}
                              />
                            </label>
                          </div>
                          <label className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Watcher prompt</span>
                            <Textarea
                              className="min-h-28"
                              value={activeMember.watchPrompt}
                              disabled={activeMember.isRole || !activeMember.watchConfigured}
                              onChange={(event) => patchMemberDraft(activeMember.id, { watchPrompt: event.currentTarget.value })}
                              placeholder="Optional extra instructions only for watcher-triggered turns."
                            />
                          </label>
                          <div className="rounded-xl border border-dashed border-border/80 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                            {activeMember.isRole
                              ? "Role owner 不允许配置 Watch。先关闭 Role owner，才能在当前 room 为这个成员保存 watcher。"
                              : "开启 Persistent watch 后，不会立刻触发；要等第一个 interval 到达。之后即使没有新消息，也会生成 heartbeat digest；如果有新消息或成员状态变化，digest 会带上新增内容。"}
                          </div>

                          <div className="flex flex-col gap-2">
                            <span className="text-sm font-medium">Allowed skill ids</span>
                            <AllowedSkillSelector
                              valueText={activeMember.allowedSkillIdsText}
                              onChangeText={(allowedSkillIdsText) =>
                                patchMemberDraft(activeMember.id, {
                                  allowedSkillIdsText,
                                })}
                              description="通过下拉选择成员可用 skill；运行时只暴露 skill id 和 `skills/<skill-id>/SKILL.md` 入口。"
                            />
                          </div>
                        </>
                      ) : null}
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
