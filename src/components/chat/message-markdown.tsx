import {
  memo,
  useMemo,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import remarkBreaks from "remark-breaks";
import { Streamdown, defaultRemarkPlugins, type Components, type ExtraProps } from "streamdown";

import { RoomAssetImage } from "@/components/media/room-asset-image";
import { cn } from "@/lib/utils";

const MESSAGE_MENTION_TAG = "oa-mention";

interface MessageMarkdownProps {
  content: string;
  className?: string;
  mentionHandles?: ReadonlySet<string>;
  quoteHandles?: ReadonlySet<string>;
  roomId?: string;
  streaming?: boolean;
}

type MessageMentionKind = "assignment" | "reference";

interface MessageMentionProps extends HTMLAttributes<HTMLElement>, ExtraProps {
  children?: ReactNode;
  handle?: string;
  kind?: MessageMentionKind;
}

interface MessageMarkdownImageProps extends ImgHTMLAttributes<HTMLImageElement>, ExtraProps {}

interface MarkdownNode {
  type: string;
}

interface MarkdownParentNode extends MarkdownNode {
  children: MarkdownChildNode[];
}

interface MarkdownTextNode extends MarkdownNode {
  type: "text";
  value: string;
}

interface MarkdownHtmlNode extends MarkdownNode {
  type: "html";
  value: string;
}

type MarkdownChildNode = MarkdownTextNode | MarkdownHtmlNode | MarkdownParentNode;

const MESSAGE_MARKDOWN_ALLOWED_TAGS = {
  [MESSAGE_MENTION_TAG]: ["handle", "kind"],
} satisfies Record<string, string[]>;

const MESSAGE_MARKDOWN_MATH_PLUGIN = createMathPlugin({
  singleDollarTextMath: true,
});
const MESSAGE_MARKDOWN_PLUGINS = {
  code,
  cjk,
  math: MESSAGE_MARKDOWN_MATH_PLUGIN,
  mermaid,
} as const;

function omitMessageMentionDomProps(props: MessageMentionProps): HTMLAttributes<HTMLElement> {
  const rest = { ...props } as MessageMentionProps;

  delete rest.children;
  delete rest.className;
  delete rest.handle;
  delete rest.kind;
  delete rest.node;

  return rest;
}

function omitMarkdownImageExtraProps(
  props: MessageMarkdownImageProps,
): Omit<MessageMarkdownImageProps, "alt" | "className" | "node" | "src"> {
  const rest = { ...props } as MessageMarkdownImageProps;

  delete rest.alt;
  delete rest.className;
  delete rest.node;
  delete rest.src;

  return rest;
}

function MessageMention(props: MessageMentionProps) {
  const { children, className, kind } = props;
  const rest = omitMessageMentionDomProps(props);
  const isAssignment = kind === "assignment";

  return (
    <span
      {...rest}
      data-message-mention-kind={kind}
      className={cn(
        "rounded-md px-1 py-0.5",
        isAssignment
          ? "bg-[var(--tone-postit-badge)] text-[var(--tone-postit-foreground)]"
          : "bg-[var(--tone-paper-badge)] text-[var(--tone-paper-foreground)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function createMessageMarkdownComponents(roomId?: string): Components {
  return {
    [MESSAGE_MENTION_TAG]: MessageMention,
    img: function MessageMarkdownImage(props: MessageMarkdownImageProps) {
      const { alt, className, src } = props;
      const imageProps = omitMarkdownImageExtraProps(props);

      if (typeof src !== "string" || src.trim().length === 0) {
        return null;
      }

      return (
        <RoomAssetImage
          {...imageProps}
          roomId={roomId}
          src={src}
          alt={typeof alt === "string" ? alt : undefined}
          className="oa-message-image"
          imageClassName={cn(
            "max-h-64 rounded-2xl border border-border/80 bg-card object-contain shadow-sm",
            className,
          )}
        />
      );
    },
  } satisfies Components;
}

export const MessageMarkdown = memo(function MessageMarkdown(props: MessageMarkdownProps) {
  const {
    content,
    className,
    mentionHandles = EMPTY_HANDLE_SET,
    quoteHandles = EMPTY_HANDLE_SET,
    roomId,
    streaming = false,
  } = props;
  const mentionHandleList = useMemo(() => [...mentionHandles].sort(), [mentionHandles]);
  const quoteHandleList = useMemo(() => [...quoteHandles].sort(), [quoteHandles]);
  const mentionRemarkPlugin = useMemo(
    () =>
      [
        messageMentionRemarkPlugin,
        {
          mentionHandles: mentionHandleList,
          quoteHandles: quoteHandleList,
        },
      ] as [typeof messageMentionRemarkPlugin, { mentionHandles: string[]; quoteHandles: string[] }],
    [mentionHandleList, quoteHandleList],
  );
  const remarkPlugins = useMemo(
    () => [
      ...Object.values(defaultRemarkPlugins),
      remarkBreaks,
      mentionRemarkPlugin,
    ],
    [mentionRemarkPlugin],
  );
  const components = useMemo(
    () => createMessageMarkdownComponents(roomId),
    [roomId],
  );

  return (
    <Streamdown
      className={cn("oa-message-markdown space-y-3 text-sm leading-6", className)}
      mode="streaming"
      isAnimating={streaming}
      allowedTags={MESSAGE_MARKDOWN_ALLOWED_TAGS}
      literalTagContent={[MESSAGE_MENTION_TAG]}
      plugins={MESSAGE_MARKDOWN_PLUGINS}
      remarkPlugins={remarkPlugins}
      components={components}
    >
      {content}
    </Streamdown>
  );
});

const EMPTY_HANDLE_SET = new Set<string>();

function messageMentionRemarkPlugin(options?: {
  mentionHandles?: string[];
  quoteHandles?: string[];
}) {
  const handles = {
    mentionHandles: new Set(options?.mentionHandles ?? []),
    quoteHandles: new Set(options?.quoteHandles ?? []),
  };

  return function transformMessageMentions(tree: MarkdownParentNode): void {
    transformMarkdownNodeChildren(tree, handles);
  };
}

function transformMarkdownNodeChildren(
  node: MarkdownParentNode,
  handles: {
    mentionHandles: ReadonlySet<string>;
    quoteHandles: ReadonlySet<string>;
  },
): void {
  node.children = node.children.flatMap((child) => transformMarkdownNode(child, handles));
}

function transformMarkdownNode(
  node: MarkdownChildNode,
  handles: {
    mentionHandles: ReadonlySet<string>;
    quoteHandles: ReadonlySet<string>;
  },
): MarkdownChildNode[] {
  if (isMarkdownTextNode(node)) {
    return splitTextNodeWithMentions(node.value, handles);
  }

  if (hasMarkdownChildren(node)) {
    transformMarkdownNodeChildren(node, handles);
  }

  return [node];
}

function hasMarkdownChildren(node: MarkdownNode): node is MarkdownParentNode {
  return "children" in node && Array.isArray(node.children);
}

function isMarkdownTextNode(node: MarkdownNode): node is MarkdownTextNode {
  return node.type === "text" && "value" in node && typeof node.value === "string";
}

function splitTextNodeWithMentions(
  value: string,
  handles: {
    mentionHandles: ReadonlySet<string>;
    quoteHandles: ReadonlySet<string>;
  },
): MarkdownChildNode[] {
  const nextChildren: MarkdownChildNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(/@>([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)?)|@([\p{L}\p{N}_-]+)/gu)) {
    const matchedText = match[0];
    const matchIndex = match.index ?? 0;
    const assignmentHandle = match[1];
    const referenceHandle = match[2];
    const handle = assignmentHandle ? assignmentHandle.split("/").at(-1) : referenceHandle;

    if (!matchedText || !handle) {
      continue;
    }

    const mentionKind: MessageMentionKind | undefined = assignmentHandle
      ? handles.mentionHandles.has(handle)
        ? "assignment"
        : undefined
      : handles.quoteHandles.has(handle)
        ? "reference"
        : undefined;

    if (!mentionKind) {
      continue;
    }

    if (cursor < matchIndex) {
      nextChildren.push({
        type: "text",
        value: value.slice(cursor, matchIndex),
      });
    }

    nextChildren.push({
      type: "html",
      value: `<${MESSAGE_MENTION_TAG} kind="${escapeHtml(mentionKind)}" handle="${escapeHtml(handle)}">${escapeHtml(matchedText)}</${MESSAGE_MENTION_TAG}>`,
    });
    cursor = matchIndex + matchedText.length;
  }

  if (nextChildren.length === 0) {
    return [
      {
        type: "text",
        value,
      },
    ];
  }

  if (cursor < value.length) {
    nextChildren.push({
      type: "text",
      value: value.slice(cursor),
    });
  }

  return nextChildren;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
