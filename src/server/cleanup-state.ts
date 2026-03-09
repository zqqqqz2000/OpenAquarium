import { readFile } from "node:fs/promises";
import path from "node:path";

import { createDiagnosticsLogger, summarizeWorkspaceSnapshot } from "./diagnostics";
import { WorkspacePersistence } from "./persistence";

async function getFileSize(filePath: string): Promise<number> {
  try {
    const raw = await readFile(filePath, "utf8");
    return raw.length;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const workspaceRoot = process.cwd();
  const stateFilePath = process.env.OA_STATE_FILE ?? path.join(workspaceRoot, ".openaquarium", "state.json");
  const logger = createDiagnosticsLogger({
    workspaceRoot,
  });
  const persistence = new WorkspacePersistence(stateFilePath, logger);
  const beforeBytes = await getFileSize(stateFilePath);
  const snapshot = await persistence.load();

  if (!snapshot) {
    console.log(`No state file found at ${stateFilePath}`);
    return;
  }

  await persistence.save(snapshot);
  const afterBytes = await getFileSize(stateFilePath);

  console.log(
    JSON.stringify(
      {
        filePath: stateFilePath,
        beforeBytes,
        afterBytes,
        ...summarizeWorkspaceSnapshot(snapshot),
      },
      null,
      2,
    ),
  );
}

void main();
