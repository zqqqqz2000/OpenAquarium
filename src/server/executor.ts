import type {
  MemberTask,
  OpenAICompatibleProviderBinding,
  Project,
  ProviderBinding,
  Room,
  TeamMember,
  WorkspaceSnapshot,
} from "../domain/model";

export type ExecutionMember = Omit<TeamMember, "provider"> & {
  provider: ProviderBinding | OpenAICompatibleProviderBinding;
};

export interface ExecutorCallbacks {
  onPromptVisible?(): Promise<void>;
  onDraft(content: string): Promise<void>;
  onStatus(summary: string): Promise<void>;
  onComplete(finalContent: string, stopReason: string): Promise<void>;
  onError(message: string): Promise<void>;
}

export interface ExecutionRequest {
  project: Project;
  room: Room;
  member: ExecutionMember;
  task: MemberTask;
  snapshot: WorkspaceSnapshot;
  prompt: string;
}

export type ExecutionSessionContinuation = "fresh" | "resumed";

export type ExecutionPreparationRequest = Omit<ExecutionRequest, "prompt">;

export interface ExecutionPreparation {
  sessionContinuation?: ExecutionSessionContinuation;
}

export interface MemberExecutor {
  prepareExecution?(request: ExecutionPreparationRequest): Promise<ExecutionPreparation>;
  execute(request: ExecutionRequest, callbacks: ExecutorCallbacks): Promise<void>;
  discardSession?(): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

export type MemberExecutorFactory = (args: {
  project: Project;
  room: Room;
  member: ExecutionMember;
}) => MemberExecutor;
