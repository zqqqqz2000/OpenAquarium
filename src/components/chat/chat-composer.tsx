import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowUp, Plus, X } from "lucide-react";

import type { TeamMember } from "@/domain/model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageMarkdown } from "@/components/chat/message-markdown";
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

const chatComposerDraftStore = new Map<string, ChatComposerDraftState>();

export function ChatComposer(props: {
  className?: string;
  contentClassName?: string;
  textareaClassName?: string;
  connected: boolean;
  error?: string;
  members: TeamMember[];
  onSend: (content: string, directMemberId?: string) => void | Promise<void>;
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
    onSend,
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedDirectMemberId = fixedDirectMemberId ?? directMemberId;
  const directMember = useMemo(
    () => members.find((member) => member.id === resolvedDirectMemberId),
    [members, resolvedDirectMemberId],
  );
  const mentionMatch = useMemo(() => resolveMentionMatch(text, caretPosition, members), [caretPosition, members, text]);
  const channelBadge = badgeToneProps(directMember ? "correction" : "blueprint");
  const allowTargetSelection = fixedDirectMemberId === undefined;
  const visibleMentionMatch = mentionMatch?.key === dismissedMentionKey ? undefined : mentionMatch;
  const supportsImageUploads = connected && typeof onUploadFiles === "function";
  const imagePreviewContent = useMemo(() => extractImageMarkdownPreview(text), [text]);

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

  const applyMention = (member: TeamMember): void => {
    if (!visibleMentionMatch) {
      return;
    }

    const trailingText = text.slice(visibleMentionMatch.end);
    const needsSpace = trailingText.length === 0 || !trailingText.startsWith(" ");
    const insertedMention = `${visibleMentionMatch.trigger}${member.handle}${needsSpace ? " " : ""}`;
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

  const submitMessage = (): void => {
    const nextText = text;

    if (nextText.trim().length === 0 || !connected || uploading) {
      return;
    }

    const nextDirectMemberId = resolvedDirectMemberId;
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
    void Promise.resolve(onSend(nextText, nextDirectMemberId)).catch((caughtError) => {
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
        <div className="relative">
          <Textarea
            ref={textareaRef}
            className={cn(
              "min-h-20 resize-none border-0 bg-transparent px-0 py-0 text-[1.05rem] leading-7 shadow-none ring-0 focus-visible:border-transparent focus-visible:ring-0",
              "max-h-48 overflow-y-auto",
              textareaClassName,
            )}
            placeholder={directMember ? `私发给 @${directMember.handle}，发送后会打断对方当前任务。` : "在群里说点什么。输入 @ 提到成员，输入 @> 派单，粘贴或上传图片会转成 room asset。"}
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
                  const selectedMember = visibleMentionMatch.matches[activeMentionIndex];

                  if (selectedMember) {
                    applyMention(selectedMember);
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
                {visibleMentionMatch.trigger === "@>" ? "Assign member" : "Reference member"}
              </p>
              <div className="flex flex-col gap-1">
                {visibleMentionMatch.matches.map((member, index) => (
                  <button
                    key={member.id}
                    type="button"
                    className={cn(
                      "flex items-center justify-between rounded-xl px-3 py-2 text-left transition-colors hover:bg-muted/70",
                      index === activeMentionIndex && "bg-accent text-accent-foreground",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applyMention(member);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{visibleMentionMatch.trigger}{member.handle}</span>
                      <span className="block truncate text-xs text-muted-foreground">{member.name}</span>
                    </span>
                    {member.isEntryMember ? <Badge variant="outline">Entry</Badge> : null}
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
  matches: TeamMember[];
}

function resolveMentionMatch(text: string, caretPosition: number, members: TeamMember[]): MentionMatch | undefined {
  const textBeforeCaret = text.slice(0, caretPosition);
  const match = /(?:^|\s)(@>|@)([^\s@>]*)$/u.exec(textBeforeCaret);

  if (!match) {
    return undefined;
  }

  const matchedText = match[0];
  const trigger = match[1] === "@>" ? "@>" : "@";
  const query = match[2]?.toLowerCase() ?? "";
  const mentionStart = (match.index ?? 0) + matchedText.lastIndexOf(trigger);
  const matches = members.filter((member) => {
    const handle = member.handle.toLowerCase();
    const name = member.name.toLowerCase();

    return query.length === 0 || handle.includes(query) || name.includes(query);
  });

  if (matches.length === 0) {
    return undefined;
  }

  return {
    key: `${mentionStart}:${caretPosition}:${query}`,
    start: mentionStart,
    end: caretPosition,
    trigger,
    matches,
  };
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
