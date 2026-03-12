import { memo, useMemo, type HTMLAttributes, type ReactNode } from "react";

import remarkBreaks from "remark-breaks";
import { Streamdown, defaultRemarkPlugins, type Components, type ExtraProps } from "streamdown";

import { cn } from "@/lib/utils";

const MESSAGE_MENTION_TAG = "oa-mention";

interface MessageMarkdownProps {
  content: string;
  className?: string;
  mentionHandles?: ReadonlySet<string>;
  quoteHandles?: ReadonlySet<string>;
  streaming?: boolean;
}

type MessageMentionKind = "assignment" | "reference";

interface MessageMentionProps extends HTMLAttributes<HTMLElement>, ExtraProps {
  children?: ReactNode;
  handle?: string;
  kind?: MessageMentionKind;
}

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

const MESSAGE_MARKDOWN_COMPONENTS = {
  [MESSAGE_MENTION_TAG]: MessageMention,
} satisfies Components;

function MessageMention(props: MessageMentionProps) {
  const { children, className, handle: _handle, kind, node: _node, ...rest } = props;
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

export const MessageMarkdown = memo(function MessageMarkdown(props: MessageMarkdownProps) {
  const {
    content,
    className,
    mentionHandles = EMPTY_HANDLE_SET,
    quoteHandles = EMPTY_HANDLE_SET,
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

  return (
    <Streamdown
      className={cn("oa-message-markdown space-y-3 text-sm leading-6", className)}
      mode="streaming"
      isAnimating={streaming}
      allowedTags={MESSAGE_MARKDOWN_ALLOWED_TAGS}
      literalTagContent={[MESSAGE_MENTION_TAG]}
      remarkPlugins={remarkPlugins}
      components={MESSAGE_MARKDOWN_COMPONENTS}
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

  for (const match of value.matchAll(/@>([\p{L}\p{N}_-]+)|@([\p{L}\p{N}_-]+)/gu)) {
    const matchedText = match[0];
    const matchIndex = match.index ?? 0;
    const assignmentHandle = match[1];
    const referenceHandle = match[2];
    const handle = assignmentHandle ?? referenceHandle;

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
