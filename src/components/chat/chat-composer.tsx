import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowUp, Plus, X } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageMarkdown } from "@/components/chat/message-markdown";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  resolveUserChatImageContentType,
  USER_CHAT_IMAGE_ACCEPT_ATTRIBUTE,
  type UserChatAssetUploadResult,
} from "@/lib/chat/user-chat-assets";
import { badgeToneProps } from "@/lib/ui-tone";
import { cn } from "@/lib/utils";

interface ChatComposerDraftState {
  text: string;
  directMemberId?: string;
}

export interface ChatComposerSendTarget {
  authorHumanId?: string;
  directMemberId?: string;
  directHumanId?: string;
}

export interface ChatComposerHumanOption {
  accountId: string;
  humanId?: string;
  label: string;
  handle: string;
}

interface ChatComposerMentionCandidate {
  kind: "member" | "human";
  id: string;
  handle: string;
  label: string;
  description: string;
  isEntryMember?: boolean;
}

const chatComposerDraftStore = new Map<string, ChatComposerDraftState>();

export function ChatComposer(props: {
  className?: string;
  contentClassName?: string;
  textareaClassName?: string;
  connected: boolean;
  error?: string;
  members: TeamMember[];
  humanOptions?: ChatComposerHumanOption[];
  activeHumanAccountId?: string;
  onSend: (content: string, target?: string | ChatComposerSendTarget) => void | Promise<void>;
  onCreateWorkspaceAccount?: (input: { displayName: string; handle?: string }) => void | Promise<void>;
  onSetActiveAccount?: (accountId: string) => void | Promise<void>;
  onUploadFiles?: (files: File[]) => Promise<UserChatAssetUploadResult[]>;
  roomId?: string;
  sending?: boolean;
  fixedDirectMemberId?: string;
  preferredDirectMemberId?: string;
  focusSignal?: number;
  draftKey?: string;
}) {
  const {
    className,
    contentClassName,
    textareaClassName,
    connected,
    error,
    members,
    humanOptions = [],
    activeHumanAccountId,
    onSend,
    onCreateWorkspaceAccount,
    onSetActiveAccount,
    onUploadFiles,
    roomId,
    sending = false,
    fixedDirectMemberId,
    preferredDirectMemberId,
    focusSignal,
    draftKey,
  } = props;
  const initialDraft = draftKey ? chatComposerDraftStore.get(draftKey) : undefined;
  const [text, setText] = useState(initialDraft?.text ?? "");
  const [directMemberId, setDirectMemberId] = useState<string | undefined>(fixedDirectMemberId ?? initialDraft?.directMemberId);
  const [sendError, setSendError] = useState<string | undefined>();
  const [uploadError, setUploadError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [caretPosition, setCaretPosition] = useState(0);
  const [dismissedMentionKey, setDismissedMentionKey] = useState<string | undefined>();
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [addingHuman, setAddingHuman] = useState(false);
  const [newHumanName, setNewHumanName] = useState("");
  const [newHumanHandle, setNewHumanHandle] = useState("");
  const [humanActionError, setHumanActionError] = useState<string | undefined>();
  const [savingHuman, setSavingHuman] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedDirectMemberId = fixedDirectMemberId ?? directMemberId;
  const directMember = useMemo(
    () => members.find((member) => member.id === resolvedDirectMemberId),
    [members, resolvedDirectMemberId],
  );
  const activeHuman = useMemo(
    () => humanOptions.find((option) => option.accountId === activeHumanAccountId) ?? humanOptions[0],
    [activeHumanAccountId, humanOptions],
  );
  const mentionMatch = useMemo(
    () => resolveMentionMatch(text, caretPosition, members, humanOptions),
    [caretPosition, humanOptions, members, text],
  );
  const channelBadge = badgeToneProps(directMember ? "correction" : "blueprint");
  const allowTargetSelection = fixedDirectMemberId === undefined;
  const visibleMentionMatch = mentionMatch?.key === dismissedMentionKey ? undefined : mentionMatch;
  const supportsImageUploads = connected && typeof onUploadFiles === "function";
  const imagePreviewContent = useMemo(() => extractImageMarkdownPreview(text), [text]);
  const canManageHumans = Boolean(onCreateWorkspaceAccount || onSetActiveAccount);

  useEffect(() => {
    setDirectMemberId(fixedDirectMemberId);
  }, [fixedDirectMemberId]);

  useEffect(() => {
    if (!draftKey) {
      return;
    }

    const nextDraft = chatComposerDraftStore.get(draftKey);
    setText(nextDraft?.text ?? "");
    setDirectMemberId(fixedDirectMemberId ?? nextDraft?.directMemberId);
  }, [draftKey, fixedDirectMemberId]);

  useEffect(() => {
    if (fixedDirectMemberId !== undefined || preferredDirectMemberId === undefined) {
      return;
    }

    setDirectMemberId(preferredDirectMemberId);
  }, [fixedDirectMemberId, focusSignal, preferredDirectMemberId]);

  useEffect(() => {
    if (focusSignal === undefined) {
      return;
    }

    textareaRef.current?.focus();
  }, [focusSignal]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [visibleMentionMatch?.key]);

  useEffect(() => {
    if (!draftKey) {
      return;
    }

    if (text.length === 0 && !resolvedDirectMemberId) {
      chatComposerDraftStore.delete(draftKey);
      return;
    }

    chatComposerDraftStore.set(draftKey, {
      text,
      directMemberId: allowTargetSelection ? resolvedDirectMemberId : undefined,
    });
  }, [allowTargetSelection, draftKey, resolvedDirectMemberId, text]);

  const applyMention = (candidate: ChatComposerMentionCandidate): void => {
    if (!visibleMentionMatch) {
      return;
    }

    const trailingText = text.slice(visibleMentionMatch.end);
    const needsSpace = trailingText.length === 0 || !trailingText.startsWith(" ");
    const insertedMention = `${visibleMentionMatch.trigger}${candidate.handle}${needsSpace ? " " : ""}`;
    const nextText = `${text.slice(0, visibleMentionMatch.start)}${insertedMention}${trailingText}`;
    const nextCaretPosition = visibleMentionMatch.start + insertedMention.length;

    setText(nextText);
    setCaretPosition(nextCaretPosition);
    setDismissedMentionKey(undefined);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  };

  const submitLabel = sending ? "Send anyway" : "Send";

  const appendUploadedMarkdown = (markdownBlocks: string[]): void => {
    if (markdownBlocks.length === 0) {
      return;
    }

    const appendedText = markdownBlocks.join("\n\n");
    setText((current) => {
      const prefix = current.trim().length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
      const nextText = `${current}${prefix}${appendedText}`;
      setCaretPosition(nextText.length);
      return nextText;
    });
    setDismissedMentionKey(undefined);
    setSendError(undefined);
    setUploadError(undefined);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const nextPosition = textareaRef.current?.value.length ?? 0;
      textareaRef.current?.setSelectionRange(nextPosition, nextPosition);
    });
  };

  const uploadFiles = async (files: File[]): Promise<void> => {
    if (!onUploadFiles || files.length === 0) {
      return;
    }

    const supportedFiles = files.filter((file) => Boolean(resolveUserChatImageContentType(file.type, file.name)));
    if (supportedFiles.length === 0) {
      setUploadError("Only PNG, JPEG, GIF, and WebP images are supported.");
      return;
    }

    if (supportedFiles.length !== files.length) {
      setUploadError("Skipped unsupported files. Only PNG, JPEG, GIF, and WebP images are supported.");
    } else {
      setUploadError(undefined);
    }

    setUploading(true);
    try {
      const uploadedAssets = await onUploadFiles(supportedFiles);
      appendUploadedMarkdown(uploadedAssets.map((asset) => asset.markdown));
    } catch (caughtError) {
      setUploadError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    } finally {
      setUploading(false);
    }
  };

  const submitNewHuman = (): void => {
    if (!onCreateWorkspaceAccount || savingHuman) {
      return;
    }

    const displayName = newHumanName.trim();
    const handle = newHumanHandle.trim();
    if (!displayName) {
      setHumanActionError("Display name is required.");
      return;
    }

    setHumanActionError(undefined);
    setSavingHuman(true);
    void Promise.resolve(onCreateWorkspaceAccount({ displayName, handle: handle || undefined }))
      .then(() => {
        setAddingHuman(false);
        setNewHumanName("");
        setNewHumanHandle("");
      })
      .catch((caughtError) => {
        setHumanActionError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      })
      .finally(() => {
        setSavingHuman(false);
      });
  };

  const handleActiveHumanChange = (accountId: string): void => {
    if (!onSetActiveAccount || savingHuman || accountId === activeHumanAccountId) {
      return;
    }

    setHumanActionError(undefined);
    setSavingHuman(true);
    void Promise.resolve(onSetActiveAccount(accountId))
      .catch((caughtError) => {
        setHumanActionError(caughtError instanceof Error ? caughtError.message : String(caughtError));
      })
      .finally(() => {
        setSavingHuman(false);
      });
  };

  const submitMessage = (): void => {
    const nextText = text;

    if (nextText.trim().length === 0 || !connected || uploading) {
      return;
    }

    const nextDirectMemberId = resolvedDirectMemberId;
    const nextTarget = activeHuman?.humanId
      ? {
          authorHumanId: activeHuman.humanId,
          directMemberId: nextDirectMemberId,
        } satisfies ChatComposerSendTarget
      : nextDirectMemberId;
    setText("");
    setCaretPosition(0);
    if (allowTargetSelection) {
      setDirectMemberId(undefined);
    }
    setSendError(undefined);
    setDismissedMentionKey(undefined);
    if (draftKey) {
      chatComposerDraftStore.delete(draftKey);
    }
    void Promise.resolve(onSend(nextText, nextTarget)).catch((caughtError) => {
      setText(nextText);
      setCaretPosition(nextText.length);
      if (allowTargetSelection) {
        setDirectMemberId(nextDirectMemberId);
      }
      setSendError(caughtError instanceof Error ? caughtError.message : String(caughtError));
    });
  };

  return (
    <div className={cn("relative z-10 overflow-visible rounded-[1.75rem] border border-border/70 bg-card shadow-sm", className)}>
      <div className={cn("flex flex-col gap-2 p-3 md:p-3.5", contentClassName)}>
        {canManageHumans ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-muted/15 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="m-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Active human</p>
                <p className="m-0 text-sm text-foreground">
                  {activeHuman ? `${activeHuman.label} @${activeHuman.handle}` : "Current human identity"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {humanOptions.length > 0 && onSetActiveAccount ? (
                  <Select value={activeHumanAccountId ?? activeHuman?.accountId} onValueChange={handleActiveHumanChange}>
                    <SelectTrigger className="h-8 w-[13rem] rounded-xl border-border/70 bg-background/80 text-sm" disabled={savingHuman}>
                      <SelectValue placeholder="Choose human" />
                    </SelectTrigger>
                    <SelectContent>
                      {humanOptions.map((option) => (
                        <SelectItem key={option.accountId} value={option.accountId}>
                          {`${option.label} @${option.handle}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {onCreateWorkspaceAccount ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-xl border-border/70"
                    onClick={() => {
                      setAddingHuman((current) => !current);
                      setHumanActionError(undefined);
                    }}
                  >
                    <Plus size={14} />
                    Add human
                  </Button>
                ) : null}
              </div>
            </div>
            {addingHuman ? (
              <div className="flex flex-col gap-2 md:flex-row">
                <Input
                  value={newHumanName}
                  onChange={(event) => setNewHumanName(event.currentTarget.value)}
                  placeholder="Display name"
                  className="h-9 rounded-xl border-border/70"
                  disabled={savingHuman}
                />
                <Input
                  value={newHumanHandle}
                  onChange={(event) => setNewHumanHandle(event.currentTarget.value.replace(/^@+/u, ""))}
                  placeholder="handle"
                  className="h-9 rounded-xl border-border/70 md:max-w-[12rem]"
                  disabled={savingHuman}
                />
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" className="h-9 rounded-xl" onClick={submitNewHuman} disabled={savingHuman}>
                    Save
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 rounded-xl"
                    onClick={() => {
                      setAddingHuman(false);
                      setHumanActionError(undefined);
                    }}
                    disabled={savingHuman}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {humanActionError ? <p className="m-0 text-xs text-destructive">{humanActionError}</p> : null}
          </div>
        ) : null}
        <div className="relative">
          <Textarea
            ref={textareaRef}
            className={cn(
              "min-h-20 resize-none border-0 bg-transparent px-0 py-0 text-[1.05rem] leading-7 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0",
              "max-h-48 overflow-y-auto",
              textareaClassName,
            )}
            placeholder={directMember ? `私发给 @${directMember.handle}，发送后会打断对方当前任务。` : "在群里说点什么。输入 @ 提到成员或 room human，输入 @> 派单，粘贴或上传图片会转成 room asset。"}
            disabled={!connected}
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
              setDismissedMentionKey(undefined);
              setSendError(undefined);
              setUploadError(undefined);
            }}
            onClick={(event) => {
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onKeyUp={(event) => {
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onSelect={(event) => {
              setCaretPosition(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
            }}
            onPaste={(event) => {
              if (!supportsImageUploads) {
                return;
              }

              const clipboardFiles = collectClipboardFiles(event.clipboardData);
              if (clipboardFiles.length === 0) {
                return;
              }

              event.preventDefault();
              void uploadFiles(clipboardFiles);
            }}
            onKeyDown={(event) => {
              const composing = event.nativeEvent.isComposing;

              if (visibleMentionMatch && visibleMentionMatch.matches.length > 0) {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => (current + 1) % visibleMentionMatch.matches.length);
                  return;
                }

                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveMentionIndex((current) => (current - 1 + visibleMentionMatch.matches.length) % visibleMentionMatch.matches.length);
                  return;
                }

                if (((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") && !composing) {
                  event.preventDefault();
                  const selectedCandidate = visibleMentionMatch.matches[activeMentionIndex];

                  if (selectedCandidate) {
                    applyMention(selectedCandidate);
                  }
                  return;
                }

                if (event.key === "Escape") {
                  event.preventDefault();
                  setDismissedMentionKey(visibleMentionMatch.key);
                  return;
                }
              }

              if (event.key === "Enter" && !event.shiftKey && !composing) {
                event.preventDefault();
                submitMessage();
              }
            }}
          />
          {visibleMentionMatch && visibleMentionMatch.matches.length > 0 ? (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 max-h-[min(18rem,40vh)] w-[min(24rem,calc(100vw-4rem))] overflow-y-auto rounded-2xl border border-border/70 bg-background/95 p-2 shadow-lg">
              <p className="m-0 px-2 pb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {visibleMentionMatch.trigger === "@>" ? "Assign member" : humanOptions.length > 0 ? "Reference member or human" : "Reference member"}
              </p>
              <div className="flex flex-col gap-1">
                {visibleMentionMatch.matches.map((candidate, index) => (
                  <button
                    key={`${candidate.kind}:${candidate.id}`}
                    type="button"
                    className={cn(
                      "flex items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70",
                      index === activeMentionIndex && "bg-accent text-accent-foreground",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(candidate);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{visibleMentionMatch.trigger}{candidate.handle}</span>
                      <span className="block truncate text-xs text-muted-foreground">{candidate.description}</span>
                    </span>
                    {candidate.kind === "member"
                      ? (candidate.isEntryMember ? <Badge variant="outline">Entry</Badge> : <Badge variant="outline">Member</Badge>)
                      : <Badge variant="secondary">Human</Badge>}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        {imagePreviewContent ? (
          <div
            role="region"
            aria-label="Composer image preview"
            className="rounded-2xl border border-border/70 bg-muted/20 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Image preview</p>
              <p className="m-0 text-[11px] text-muted-foreground">Sending still uses markdown source.</p>
            </div>
            <MessageMarkdown
              className="mt-2 space-y-2"
              content={imagePreviewContent}
              roomId={roomId}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-2">
          <div className="flex min-w-0 items-center gap-2">
            {supportsImageUploads ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={USER_CHAT_IMAGE_ACCEPT_ATTRIBUTE}
                  multiple
                  className="sr-only"
                  aria-label="Upload images"
                  onChange={(event) => {
                    const nextFiles = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    void uploadFiles(nextFiles);
                  }}
                />
                <Button
                  aria-label="Choose images"
                  className="rounded-full border-border/70 text-muted-foreground"
                  size="icon-sm"
                  type="button"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Plus size={16} />
                </Button>
              </>
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
                <Plus size={16} />
              </span>
            )}
            {directMember ? (
              <Badge variant={channelBadge.variant} className={cn("h-7 rounded-full px-2.5 text-[0.78rem]", channelBadge.className)}>
                {`DM @${directMember.handle}`}
              </Badge>
            ) : (
              <span className="truncate text-sm text-muted-foreground">Room chat</span>
            )}
            {activeHuman ? (
              <Badge variant="outline" className="h-7 rounded-full px-2.5 text-[0.78rem]">
                {`Human @${activeHuman.handle}`}
              </Badge>
            ) : null}
            {uploading ? <p className="m-0 truncate text-xs text-muted-foreground">Uploading images…</p> : null}
            {uploadError || sendError || error ? <p className="m-0 truncate text-xs text-destructive">{uploadError ?? sendError ?? error}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {allowTargetSelection && directMember ? (
              <Button
                aria-label="Clear target"
                className="rounded-full border-border/70 text-muted-foreground"
                size="icon-sm"
                type="button"
                variant="outline"
                onClick={() => setDirectMemberId(undefined)}
              >
                <X size={16} />
              </Button>
            ) : null}
            <Button
              aria-label={submitLabel}
              className="size-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/88 disabled:bg-muted disabled:text-muted-foreground"
              disabled={text.trim().length === 0 || !connected || uploading}
              size="icon"
              type="button"
              onClick={submitMessage}
            >
              <ArrowUp size={20} />
              <span className="sr-only">{submitLabel}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface MentionMatch {
  key: string;
  start: number;
  end: number;
  trigger: "@" | "@>";
  matches: ChatComposerMentionCandidate[];
}

function resolveMentionMatch(
  text: string,
  caretPosition: number,
  members: TeamMember[],
  humanOptions: ChatComposerHumanOption[],
): MentionMatch | undefined {
  const textBeforeCaret = text.slice(0, caretPosition);
  const match = /(?:^|\s)(@>|@)([^\s@>]*)$/u.exec(textBeforeCaret);

  if (!match) {
    return undefined;
  }

  const matchedText = match[0];
  const trigger = match[1] === "@>" ? "@>" : "@";
  const query = match[2]?.toLowerCase() ?? "";
  const mentionStart = (match.index ?? 0) + matchedText.lastIndexOf(trigger);
  const memberMatches = members
    .map((member) => ({
      kind: "member" as const,
      id: member.id,
      handle: member.handle,
      label: member.name,
      description: `Member · ${member.name}`,
      isEntryMember: member.isEntryMember,
    }))
    .filter((candidate) => {
      const handle = candidate.handle.toLowerCase();
      const name = candidate.label.toLowerCase();
      return query.length === 0 || handle.includes(query) || name.includes(query);
    });

  const matches = trigger === "@>"
    ? memberMatches
    : dedupeMentionCandidatesByHandle([
        ...humanOptions
          .map((human) => ({
            kind: "human" as const,
            id: human.humanId ?? human.accountId,
            handle: human.handle,
            label: human.label,
            description: `Human · ${human.label}`,
          }))
          .filter((candidate) => {
            const handle = candidate.handle.toLowerCase();
            const name = candidate.label.toLowerCase();
            return query.length === 0 || handle.includes(query) || name.includes(query);
          }),
        ...memberMatches,
      ]);

  if (matches.length === 0) {
    return undefined;
  }

  return {
    key: `${mentionStart}:${caretPosition}:${trigger}:${query}`,
    start: mentionStart,
    end: caretPosition,
    trigger,
    matches,
  };
}

function dedupeMentionCandidatesByHandle(candidates: ChatComposerMentionCandidate[]): ChatComposerMentionCandidate[] {
  const seenHandles = new Set<string>();
  const deduped: ChatComposerMentionCandidate[] = [];

  candidates.forEach((candidate) => {
    const normalizedHandle = candidate.handle.toLowerCase();
    if (seenHandles.has(normalizedHandle)) {
      return;
    }

    seenHandles.add(normalizedHandle);
    deduped.push(candidate);
  });

  return deduped;
}

function collectClipboardFiles(dataTransfer?: DataTransfer | null): File[] {
  if (!dataTransfer) {
    return [];
  }

  const directFiles = Array.from(dataTransfer.files ?? []).filter((file) => file.size > 0);
  if (directFiles.length > 0) {
    return directFiles;
  }

  return Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file instanceof File && file.size > 0);
}

function extractImageMarkdownPreview(value: string): string {
  const markdownMatches = value.match(/!\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\)/gu);
  return markdownMatches?.join("\n\n") ?? "";
}
