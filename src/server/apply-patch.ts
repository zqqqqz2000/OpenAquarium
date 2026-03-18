import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

type PatchOperation =
  | {
    kind: "add";
    filePath: string;
    content: string;
  }
  | {
    kind: "delete";
    filePath: string;
  }
  | {
    kind: "update";
    filePath: string;
    moveTo?: string;
    hunks: string[][];
  };

function splitPatchLines(patch: string): string[] {
  return patch.replace(/\r\n/gu, "\n").split("\n");
}

function requirePatchPrefix(line: string, prefix: string): string {
  if (!line.startsWith(prefix)) {
    throw new Error(`Expected "${prefix}" line, received "${line}"`);
  }
  return line.slice(prefix.length);
}

function parseHunks(lines: string[]): string[][] {
  const hunks: string[][] = [];
  let currentHunk: string[] = [];

  for (const line of lines) {
    if (line === "*** End of File") {
      continue;
    }

    if (line === "@@" || line.startsWith("@@ ")) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk);
        currentHunk = [];
      }
      continue;
    }

    if (![" ", "+", "-"].includes(line[0] ?? "")) {
      throw new Error(`Invalid patch line "${line}"`);
    }

    currentHunk.push(line);
  }

  if (currentHunk.length > 0) {
    hunks.push(currentHunk);
  }

  return hunks;
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = splitPatchLines(patch);
  if (lines[0] !== "*** Begin Patch") {
    throw new Error('Patch must start with "*** Begin Patch"');
  }

  const operations: PatchOperation[] = [];
  let index = 1;

  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      return operations;
    }
    if (line.length === 0) {
      index += 1;
      continue;
    }

    if (line.startsWith("*** Add File: ")) {
      const filePath = requirePatchPrefix(line, "*** Add File: ").trim();
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        const contentLine = lines[index];
        if (!contentLine.startsWith("+")) {
          throw new Error(`Added file lines must start with "+": "${contentLine}"`);
        }
        contentLines.push(contentLine.slice(1));
        index += 1;
      }
      operations.push({
        kind: "add",
        filePath,
        content: contentLines.join("\n"),
      });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      operations.push({
        kind: "delete",
        filePath: requirePatchPrefix(line, "*** Delete File: ").trim(),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const filePath = requirePatchPrefix(line, "*** Update File: ").trim();
      index += 1;

      let moveTo: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) {
        moveTo = requirePatchPrefix(lines[index], "*** Move to: ").trim();
        index += 1;
      }

      const changeLines: string[] = [];
      while (index < lines.length && !lines[index].startsWith("*** ")) {
        changeLines.push(lines[index]);
        index += 1;
      }

      operations.push({
        kind: "update",
        filePath,
        moveTo,
        hunks: parseHunks(changeLines),
      });
      continue;
    }

    throw new Error(`Unexpected patch directive "${line}"`);
  }

  throw new Error('Patch must end with "*** End Patch"');
}

function findHunkStart(lines: string[], searchFrom: number, hunk: string[]): number {
  const anchor = hunk
    .filter((line) => line.startsWith(" ") || line.startsWith("-"))
    .map((line) => line.slice(1));

  if (anchor.length === 0) {
    return searchFrom;
  }

  for (let start = searchFrom; start <= lines.length - anchor.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < anchor.length; offset += 1) {
      if (lines[start + offset] !== anchor[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return start;
    }
  }

  return -1;
}

function applyHunks(originalContent: string, hunks: string[][]): string {
  if (hunks.length === 0) {
    return originalContent;
  }

  const originalLines = originalContent.replace(/\r\n/gu, "\n").split("\n");
  const result: string[] = [];
  let cursor = 0;

  for (const hunk of hunks) {
    const start = findHunkStart(originalLines, cursor, hunk);
    if (start < 0) {
      throw new Error(`Failed to match patch hunk starting near line ${cursor + 1}`);
    }

    result.push(...originalLines.slice(cursor, start));
    let originalIndex = start;

    for (const line of hunk) {
      const operation = line[0];
      const text = line.slice(1);
      if (operation === " ") {
        if (originalLines[originalIndex] !== text) {
          throw new Error(`Context mismatch while applying patch: expected "${originalLines[originalIndex] ?? ""}", received "${text}"`);
        }
        result.push(text);
        originalIndex += 1;
        continue;
      }
      if (operation === "-") {
        if (originalLines[originalIndex] !== text) {
          throw new Error(`Delete mismatch while applying patch: expected "${originalLines[originalIndex] ?? ""}", received "${text}"`);
        }
        originalIndex += 1;
        continue;
      }
      if (operation === "+") {
        result.push(text);
        continue;
      }
      throw new Error(`Unsupported patch operation "${operation}"`);
    }

    cursor = originalIndex;
  }

  result.push(...originalLines.slice(cursor));
  return result.join("\n");
}

export async function applyStructuredPatch(args: {
  patch: string;
  resolvePath: (filePath: string) => string;
}): Promise<{ changedPaths: string[] }> {
  const operations = parsePatch(args.patch);
  const changedPaths: string[] = [];

  for (const operation of operations) {
    if (operation.kind === "add") {
      const resolvedPath = args.resolvePath(operation.filePath);
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      await writeFile(resolvedPath, operation.content, "utf8");
      changedPaths.push(resolvedPath);
      continue;
    }

    if (operation.kind === "delete") {
      const resolvedPath = args.resolvePath(operation.filePath);
      await rm(resolvedPath);
      changedPaths.push(resolvedPath);
      continue;
    }

    const sourcePath = args.resolvePath(operation.filePath);
    const originalContent = await readFile(sourcePath, "utf8");
    const nextContent = applyHunks(originalContent, operation.hunks);

    if (operation.moveTo) {
      const targetPath = args.resolvePath(operation.moveTo);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, nextContent, "utf8");
      if (sourcePath !== targetPath) {
        await rm(sourcePath);
      }
      changedPaths.push(targetPath);
      continue;
    }

    await writeFile(sourcePath, nextContent, "utf8");
    changedPaths.push(sourcePath);
  }

  return {
    changedPaths,
  };
}
