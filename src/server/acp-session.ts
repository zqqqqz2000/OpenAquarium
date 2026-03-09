import { existsSync } from "node:fs";
import path from "node:path";

export function isCommandAvailable(command: string, cwd: string, env: Record<string, string | undefined>): boolean {
  if (command.trim().length === 0) {
    return false;
  }

  if (command.includes(path.sep) || command.startsWith(".")) {
    const candidate = path.isAbsolute(command) ? command : path.resolve(cwd, command);
    return existsSync(candidate);
  }

  const pathEntries = (env.PATH ?? process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return pathEntries.some((entry) => existsSync(path.join(entry, command)));
}
