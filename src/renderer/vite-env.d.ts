import type { FileDiff, ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';
import type { PatchApplyResult } from '../patches.js';
import type { CompletionOptions, CompletionResult } from '../llamaRuntime.js';

declare global {
  interface Window {
    zap: {
      listModels(): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }>;
      selectModel(modelId: string): Promise<ModelManagerState>;
      unloadModel(): Promise<ModelManagerState>;
      complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
      chooseWorkspace(): Promise<WorkspaceContext | null>;
      loadWorkspace(rootPath: string): Promise<WorkspaceContext>;
      applyPatches(rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult>;
      rollbackPatches(rootPath: string, backupId: string): Promise<string[]>;
    };
  }
}

export {};
