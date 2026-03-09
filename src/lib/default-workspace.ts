import type { WorkspaceSnapshot } from "../domain/model";
import { createWorkspaceSnapshot } from "../domain/workspace";
import { defaultTemplates } from "./sample-data/templates";

export function createDefaultWorkspaceSnapshot(currentUserName = "You"): WorkspaceSnapshot {
  return createWorkspaceSnapshot(defaultTemplates, currentUserName);
}
