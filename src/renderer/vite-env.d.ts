import type { FileDiff, ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';
import type { AgentRunResult } from '../agentRunner.js';
import type { PatchApplyResult } from '../patches.js';
import type { CompletionOptions, CompletionResult } from '../llamaRuntime.js';
import type { AppSettings } from '../settings.js';
import type { TerminalResult } from '../tools.js';

declare global {
  interface Window {
    zap: {
      listModels(): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }>;
      selectModel(modelId: string): Promise<ModelManagerState>;
      unloadModel(): Promise<ModelManagerState>;
      complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
      runAgentTask(rootPath: string, instruction: string): Promise<AgentRunResult>;
      chooseWorkspace(): Promise<WorkspaceContext | null>;
      loadWorkspace(rootPath: string): Promise<WorkspaceContext>;
      readWorkspaceFile(rootPath: string, filePath: string): Promise<string>;
      readWorkspaceFileIfExists(rootPath: string, filePath: string): Promise<string | null>;
      applyPatches(rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult>;
      rollbackPatches(rootPath: string, backupId: string): Promise<string[]>;
      getSettings(): Promise<AppSettings>;
      updateMaxContextFiles(maxContextFiles: number): Promise<AppSettings>;
      chooseModelsDirectory(): Promise<AppSettings | null>;
      runTerminal(rootPath: string, command: string): Promise<TerminalResult>;
    };
  }
}

export {};
