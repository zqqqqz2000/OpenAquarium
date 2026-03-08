import type { MemberTask, Project, Room, TeamMember, WorkspaceSnapshot } from "../domain/model";

export interface ExecutorCallbacks {
  onDraft(content: string): Promise<void>;
  onStatus(summary: string): Promise<void>;
  onComplete(finalContent: string, stopReason: string): Promise<void>;
  onError(message: string): Promise<void>;
}

export interface ExecutionRequest {
  project: Project;
  room: Room;
  member: TeamMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  prompt: string;
}

export interface MemberExecutor {
  execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export type MemberExecutorFactory = (args: {
  project: Project;
  room: Room;
  member: TeamMember;
}) => MemberExecutor;
