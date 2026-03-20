import { hierarchy, tree } from "d3-hierarchy";
import { Position, type Edge, type Node } from "@xyflow/react";

export interface AqTodoCodeSnippet {
  content: string;
  language?: string;
}

export interface AqTodoImageRef {
  alt?: string;
  src: string;
}

export interface AqTodoNodeModel {
  children: AqTodoNodeModel[];
  codes: AqTodoCodeSnippet[];
  details?: string;
  id: string;
  images: AqTodoImageRef[];
  member?: string;
  note?: string;
  priority?: string;
  progress?: number;
  status: string;
  tags: string[];
  title: string;
}

export interface AqTodoDocument {
  root: AqTodoNodeModel;
  roomId?: string;
  roomName?: string;
  title?: string;
  version?: string;
}

export interface AqTodoNodeSize {
  height: number;
  width: number;
}

export interface AqTodoFlowNodeData extends Record<string, unknown> {
  node: AqTodoNodeModel;
  roomId?: string;
  size: AqTodoNodeSize;
}

function getDirectChildElements(element: Element, tagName?: string): Element[] {
  return [...element.children].filter((child) => !tagName || child.tagName === tagName);
}

function getDirectChildText(element: Element, tagName: string): string | undefined {
  const child = getDirectChildElements(element, tagName)[0];
  const text = child?.textContent?.trim();
  return text ? text : undefined;
}

function readTags(value?: string): string[] {
  if (!value) {
    return [];
  }

  return [...new Set(value.split(/[,\s]+/u).map((tag) => tag.trim()).filter(Boolean))];
}

function parseProgress(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(100, Math.max(0, parsed));
}

function parseAqTodoNode(element: Element, nodeId: string): AqTodoNodeModel {
  const title = element.getAttribute("title")?.trim() || getDirectChildText(element, "title") || nodeId;

  return {
    id: element.getAttribute("id")?.trim() || nodeId,
    title,
    status: element.getAttribute("status")?.trim() || "todo",
    member: element.getAttribute("member")?.trim() || undefined,
    priority: element.getAttribute("priority")?.trim() || undefined,
    progress: parseProgress(element.getAttribute("progress")?.trim() || undefined),
    tags: readTags(element.getAttribute("tags")?.trim() || undefined),
    note: getDirectChildText(element, "note"),
    details: getDirectChildText(element, "details"),
    codes: getDirectChildElements(element, "code")
      .map((codeElement) => ({
        content: codeElement.textContent?.trim() || "",
        language: codeElement.getAttribute("language")?.trim() || undefined,
      }))
      .filter((codeSnippet) => codeSnippet.content.length > 0),
    images: getDirectChildElements(element, "image")
      .map((imageElement) => ({
        src: imageElement.getAttribute("src")?.trim() || "",
        alt: imageElement.getAttribute("alt")?.trim() || undefined,
      }))
      .filter((imageRef) => imageRef.src.length > 0),
    children: getDirectChildElements(element, "node").map((child, index) =>
      parseAqTodoNode(child, `${nodeId}-${index + 1}`),
    ),
  };
}

export function parseAqTodoXml(xml: string): AqTodoDocument {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const parseError = document.querySelector("parsererror");
  if (parseError) {
    throw new Error(parseError.textContent?.trim() || "Invalid aqtree xml");
  }

  const rootElement = document.documentElement;
  if (
    !rootElement
    || (rootElement.tagName !== "aqtodo" && rootElement.tagName !== "aqtree")
  ) {
    throw new Error("AqTree xml must use a single <aqtree> root element. Legacy <aqtodo> roots are also accepted.");
  }

  const rootNodeElement =
    getDirectChildElements(rootElement, "node")[0] ??
    getDirectChildElements(rootElement, "tree")[0]?.querySelector("node") ??
    undefined;
  if (!rootNodeElement) {
    throw new Error("AqTree xml must contain at least one <node>.");
  }

  return {
    version: rootElement.getAttribute("version")?.trim() || undefined,
    title: rootElement.getAttribute("title")?.trim() || undefined,
    roomId: rootElement.getAttribute("roomId")?.trim() || undefined,
    roomName: rootElement.getAttribute("roomName")?.trim() || undefined,
    root: parseAqTodoNode(rootNodeElement, "root"),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateLineCount(value: string, charactersPerLine: number, maxLines: number): number {
  const normalized = value.trim();
  if (!normalized) {
    return 0;
  }

  return Math.min(
    maxLines,
    normalized.split(/\r?\n/u).reduce(
      (lineCount, line) => lineCount + Math.max(1, Math.ceil(line.length / charactersPerLine)),
      0,
    ),
  );
}

export function estimateAqTodoNodeSize(node: AqTodoNodeModel): AqTodoNodeSize {
  const titleLines = estimateLineCount(node.title, 18, 3);
  const noteLines = estimateLineCount(node.note ?? "", 26, 4);
  const detailsLines = estimateLineCount(node.details ?? "", 28, 3);
  const codeLines = node.codes.reduce(
    (count, codeSnippet) => count + estimateLineCount(codeSnippet.content, 26, 4),
    0,
  );
  const width =
    220
    + Math.max(0, Math.min(120, (titleLines > 1 ? 40 : 0) + (node.images.length > 0 ? 36 : 0)))
    + Math.max(0, Math.min(80, node.tags.join(" ").length));
  let height = 84 + titleLines * 20;

  if (node.member || node.priority || typeof node.progress === "number") {
    height += 30;
  }
  if (node.tags.length > 0) {
    height += 28;
  }
  if (noteLines > 0) {
    height += 16 + noteLines * 16;
  }
  if (detailsLines > 0) {
    height += 14 + detailsLines * 15;
  }
  if (codeLines > 0) {
    height += 18 + codeLines * 14;
  }
  if (node.images.length > 0) {
    height += 88;
  }

  return {
    width: clamp(width, 220, 360),
    height: clamp(height, 92, 320),
  };
}

function collectNodeSizes(root: AqTodoNodeModel): Map<string, AqTodoNodeSize> {
  const sizes = new Map<string, AqTodoNodeSize>();

  const visitNode = (node: AqTodoNodeModel): void => {
    sizes.set(node.id, estimateAqTodoNodeSize(node));
    node.children.forEach(visitNode);
  };

  visitNode(root);
  return sizes;
}

export function buildAqTodoFlowGraph(args: {
  document: AqTodoDocument;
  roomId?: string;
}): {
  edges: Edge[];
  nodes: Node<AqTodoFlowNodeData>[];
} {
  const sizes = collectNodeSizes(args.document.root);
  const sizeValues = [...sizes.values()];
  const maxWidth = Math.max(...sizeValues.map((size) => size.width), 240);
  const maxHeight = Math.max(...sizeValues.map((size) => size.height), 120);
  const root = hierarchy(args.document.root, (node) => node.children);
  const layout = tree<AqTodoNodeModel>().nodeSize([maxHeight + 40, maxWidth + 96]);
  const positioned = layout(root);

  return {
    nodes: positioned.descendants().map((entry) => {
      const size = sizes.get(entry.data.id) ?? estimateAqTodoNodeSize(entry.data);

      return {
        id: entry.data.id,
        type: "aqtodo",
        position: {
          x: entry.y - size.width / 2,
          y: entry.x - size.height / 2,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          node: entry.data,
          roomId: args.roomId,
          size,
        },
        draggable: false,
        selectable: false,
        style: {
          width: size.width,
          height: size.height,
        },
      } satisfies Node<AqTodoFlowNodeData>;
    }),
    edges: positioned.links().map((link) => ({
      id: `${link.source.data.id}->${link.target.data.id}`,
      source: link.source.data.id,
      target: link.target.data.id,
      type: "smoothstep",
      selectable: false,
    })),
  };
}
