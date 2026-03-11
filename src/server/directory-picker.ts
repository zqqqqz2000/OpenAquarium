import { execFile } from "node:child_process";
import path from "node:path";

const MACOS_PROJECT_DIRECTORY_PICKER_SCRIPT =
  'POSIX path of (choose folder with prompt "Select a project directory for OpenAquarium")';

export class DirectorySelectionCancelledError extends Error {
  constructor() {
    super("Project directory selection was cancelled");
    this.name = "DirectorySelectionCancelledError";
  }
}

export async function selectProjectDirectory(): Promise<string> {
  if (process.platform !== "darwin") {
    throw new Error("Project directory picker is currently supported on macOS only.");
  }

  const stdout = await new Promise<string>((resolve, reject) => {
    execFile("osascript", ["-e", MACOS_PROJECT_DIRECTORY_PICKER_SCRIPT], (error, commandStdout) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(String(commandStdout));
    });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("User canceled") || message.includes("(-128)")) {
      throw new DirectorySelectionCancelledError();
    }

    throw error;
  });

  const selectedPath = path.normalize(stdout.trim());
  if (selectedPath.length === 0) {
    throw new Error("Project directory picker did not return a path.");
  }

  return selectedPath;
}
