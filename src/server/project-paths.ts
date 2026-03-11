import path from "node:path";

import type { Project } from "../domain/model";

const OPEN_AQUARIUM_SCRIPT_NAMES = ["oa-room-send", "oa-room-state", "oa-room-watch"] as const;
type OpenAquariumScriptName = (typeof OPEN_AQUARIUM_SCRIPT_NAMES)[number];

const OPEN_AQUARIUM_SCRIPT_NAME_SET = new Set<string>(OPEN_AQUARIUM_SCRIPT_NAMES);
const SAFE_SHELL_TOKEN_PATTERN = /^[A-Za-z0-9_./:@%+=,-]+$/u;

function isOpenAquariumScriptName(value: string): value is OpenAquariumScriptName {
  return OPEN_AQUARIUM_SCRIPT_NAME_SET.has(value);
}

function extractOpenAquariumScriptName(commandToken: string): OpenAquariumScriptName | undefined {
  const normalizedToken = commandToken.startsWith("./") ? commandToken.slice(2) : commandToken;
  if (normalizedToken.startsWith("bin/")) {
    const scriptName = normalizedToken.slice(4);
    return isOpenAquariumScriptName(scriptName) ? scriptName : undefined;
  }

  return isOpenAquariumScriptName(normalizedToken) ? normalizedToken : undefined;
}

export function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeProjectPath(workspaceRoot: string, rawPath?: string): string | undefined {
  const trimmedPath = rawPath?.trim();
  if (!trimmedPath) {
    return undefined;
  }

  return path.normalize(path.isAbsolute(trimmedPath) ? trimmedPath : path.resolve(workspaceRoot, trimmedPath));
}

export function resolveProjectWorkingDirectory(project: Pick<Project, "path">, workspaceRoot: string): string {
  return normalizeProjectPath(workspaceRoot, project.path) ?? workspaceRoot;
}

export function resolveAcpSessionWorkingDirectory(args: {
  workspaceRoot: string;
  project: Pick<Project, "path">;
  providerWorkingDirectory?: string;
}): string {
  const projectRoot = resolveProjectWorkingDirectory(args.project, args.workspaceRoot);
  const configuredWorkingDirectory = args.providerWorkingDirectory?.trim();
  if (!configuredWorkingDirectory) {
    return projectRoot;
  }

  const resolvedWorkingDirectory = path.normalize(
    path.isAbsolute(configuredWorkingDirectory)
      ? configuredWorkingDirectory
      : path.resolve(projectRoot, configuredWorkingDirectory),
  );

  return isPathInsideRoot(projectRoot, resolvedWorkingDirectory) ? resolvedWorkingDirectory : projectRoot;
}

export function getOpenAquariumScriptPath(workspaceRoot: string, scriptName: OpenAquariumScriptName): string {
  return path.join(workspaceRoot, "bin", scriptName);
}

export function quoteShellToken(token: string): string {
  if (SAFE_SHELL_TOKEN_PATTERN.test(token)) {
    return token;
  }

  return `'${token.replace(/'/gu, `'\"'\"'`)}'`;
}

export function rewriteCommandForProjectContext(command: string, workspaceRoot: string): string {
  const leadingWhitespaceLength = command.length - command.trimStart().length;
  const leadingWhitespace = command.slice(0, leadingWhitespaceLength);
  const trimmedCommand = command.slice(leadingWhitespaceLength);
  if (trimmedCommand.length === 0) {
    return command;
  }

  const firstWhitespaceIndex = trimmedCommand.search(/\s/u);
  const commandToken = firstWhitespaceIndex === -1 ? trimmedCommand : trimmedCommand.slice(0, firstWhitespaceIndex);
  const trailingCommand = firstWhitespaceIndex === -1 ? "" : trimmedCommand.slice(firstWhitespaceIndex);
  const scriptName = extractOpenAquariumScriptName(commandToken);
  if (!scriptName) {
    return command;
  }

  return `${leadingWhitespace}${quoteShellToken(getOpenAquariumScriptPath(workspaceRoot, scriptName))}${trailingCommand}`;
}
