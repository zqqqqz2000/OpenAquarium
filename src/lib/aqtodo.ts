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

export interface AqTodoNodeAggregate {
  completion: number;
  depth: number;
  directChildCount: number;
  doneItemCount: number;
  isCategory: boolean;
  levelCount: number;
  statusCounts: Record<string, number>;
  totalItemCount: number;
}

export function deriveAqTodoDisplayStatus(
  node: AqTodoNodeModel,
  aggregate?: AqTodoNodeAggregate,
): string {
  const completion = aggregate?.completion ?? inferAqTodoNodeProgress(node);

  if (aggregate?.isCategory) {
    if (aggregate.doneItemCount >= aggregate.totalItemCount) {
      return "done";
    }

    const { blocked = 0, done = 0, in_progress = 0, todo = 0 } = aggregate.statusCounts;
    if (blocked > 0 && done === 0 && in_progress === 0 && todo === 0) {
      return "blocked";
    }
    if (in_progress > 0 || done > 0 || (completion > 0 && completion < 100)) {
      return "in_progress";
    }
    if (blocked > 0) {
      return "blocked";
    }

    return "todo";
  }

  if (completion >= 100) {
    return "done";
  }
  if (node.status === "blocked" && completion <= 0) {
    return "blocked";
  }
  if (completion > 0) {
    return "in_progress";
  }

  return node.status === "done" ? "done" : "todo";
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

export function inferAqTodoNodeProgress(node: AqTodoNodeModel): number {
  if (typeof node.progress === "number") {
    return Math.min(100, Math.max(0, node.progress));
  }

  switch (node.status) {
    case "done":
      return 100;
    case "in_progress":
      return 50;
    default:
      return 0;
  }
}

function createEmptyStatusCounts(): Record<string, number> {
  return {
    blocked: 0,
    done: 0,
    in_progress: 0,
    todo: 0,
  };
}

export function buildAqTodoNodeAggregates(root: AqTodoNodeModel): Map<string, AqTodoNodeAggregate> {
  const aggregates = new Map<string, AqTodoNodeAggregate>();

  const visitNode = (node: AqTodoNodeModel, depth: number): AqTodoNodeAggregate => {
    if (node.children.length === 0) {
      const completion = inferAqTodoNodeProgress(node);
      const statusCounts = createEmptyStatusCounts();
      statusCounts[node.status] = 1;
      const aggregate = {
        completion,
        depth,
        directChildCount: 0,
        doneItemCount: completion >= 100 ? 1 : 0,
        isCategory: false,
        levelCount: 1,
        statusCounts,
        totalItemCount: 1,
      } satisfies AqTodoNodeAggregate;
      aggregates.set(node.id, aggregate);
      return aggregate;
    }

    const childAggregates = node.children.map((child) => visitNode(child, depth + 1));
    const statusCounts = createEmptyStatusCounts();
    let totalItemCount = 0;
    let doneItemCount = 0;
    let weightedCompletion = 0;
    let maxChildLevelCount = 0;

    childAggregates.forEach((childAggregate) => {
      totalItemCount += childAggregate.totalItemCount;
      doneItemCount += childAggregate.doneItemCount;
      weightedCompletion += childAggregate.completion * childAggregate.totalItemCount;
      maxChildLevelCount = Math.max(maxChildLevelCount, childAggregate.levelCount);
      Object.entries(childAggregate.statusCounts).forEach(([status, count]) => {
        statusCounts[status] = (statusCounts[status] ?? 0) + count;
      });
    });

    const aggregate = {
      completion: totalItemCount > 0 ? weightedCompletion / totalItemCount : inferAqTodoNodeProgress(node),
      depth,
      directChildCount: node.children.length,
      doneItemCount,
      isCategory: true,
      levelCount: maxChildLevelCount + 1,
      statusCounts,
      totalItemCount: Math.max(1, totalItemCount),
    } satisfies AqTodoNodeAggregate;
    aggregates.set(node.id, aggregate);
    return aggregate;
  };

  visitNode(root, 0);
  return aggregates;
}
