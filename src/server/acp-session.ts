import { existsSync } from "node:fs";
import path from "node:path";

export function resolveCommandPath(
  command: string,
  cwd: string,
  env: Record<string, string | undefined>,
): string | undefined {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length === 0) {
    return undefined;
  }

  if (trimmedCommand.includes(path.sep) || trimmedCommand.startsWith(".")) {
    const candidate = path.isAbsolute(trimmedCommand) ? trimmedCommand : path.resolve(cwd, trimmedCommand);
    return existsSync(candidate) ? candidate : undefined;
  }

  const pathEntries = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, trimmedCommand);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function isCommandAvailable(command: string, cwd: string, env: Record<string, string | undefined>): boolean {
  return resolveCommandPath(command, cwd, env) !== undefined;
}
