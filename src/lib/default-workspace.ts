import type { TeamTemplate, WorkspaceSnapshot } from "../domain/model";
import { createWorkspaceSnapshot } from "../domain/workspace";
import { defaultTemplates } from "./sample-data/templates";

export function createDefaultWorkspaceSnapshot(currentUserName = "You", templates: TeamTemplate[] = defaultTemplates): WorkspaceSnapshot {
  return createWorkspaceSnapshot(templates, currentUserName);
}
