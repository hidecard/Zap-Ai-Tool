export type ModelFormat = 'gguf';

export interface ModelDescriptor {
  id: string;
  name: string;
  path: string;
  format: ModelFormat;
  sizeBytes: number;
  modifiedAt: string;
}

export interface WorkspaceFile {
  relativePath: string;
  sizeBytes: number;
  kind: 'file' | 'directory';
}

export interface WorkspaceContext {
  rootPath: string;
  files: WorkspaceFile[];
  instructions?: string;
  estimatedTokens: number;
}

export type ToolName = 'file.read' | 'terminal.run';
export type ToolRisk = 'read-only' | 'mutating' | 'network';

export interface ToolCall {
  id: string;
  name: ToolName;
  risk: ToolRisk;
  summary: string;
  command?: string;
  status: 'proposed' | 'approved' | 'rejected' | 'completed' | 'failed';
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
}

export type TaskStatus =
  'plan' | 'inspect' | 'draft' | 'validate' | 'revise' | 'complete' | 'failed';

export interface AgentTask {
  id: string;
  instruction: string;
  status: TaskStatus;
  attempts: number;
  toolCalls: ToolCall[];
  diffs: FileDiff[];
}

export const TASK_FLOW: readonly TaskStatus[] = [
  'plan',
  'inspect',
  'draft',
  'validate',
  'revise',
  'complete',
];
