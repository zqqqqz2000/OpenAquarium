import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { WorkspaceSnapshot } from "../domain/model";
import { getErrorCode } from "./error-utils";

interface PersistedWorkspaceState {
  savedAt: string;
  snapshot: WorkspaceSnapshot;
}

export class WorkspacePersistence {
  private readonly filePath: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<WorkspaceSnapshot | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      return parsed.snapshot;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    const directory = path.dirname(this.filePath);
    const payload = JSON.stringify(
      {
        savedAt: new Date().toISOString(),
        snapshot,
      } satisfies PersistedWorkspaceState,
      null,
      2,
    );
    const tempPath = `${this.filePath}.tmp`;

    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(tempPath, payload, "utf8");
      await rename(tempPath, this.filePath);
    });

    await this.pendingWrite;
  }
}
