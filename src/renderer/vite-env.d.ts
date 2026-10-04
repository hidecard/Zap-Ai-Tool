import type { FileDiff, ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';
import type { PatchApplyResult } from '../patches.js';

declare global {
  interface Window {
    zap: {
      listModels(): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }>;
      selectModel(modelId: string): Promise<ModelManagerState>;
      unloadModel(): Promise<ModelManagerState>;
      chooseWorkspace(): Promise<WorkspaceContext | null>;
      loadWorkspace(rootPath: string): Promise<WorkspaceContext>;
      applyPatches(rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult>;
      rollbackPatches(rootPath: string, backupId: string): Promise<string[]>;
    };
  }
}

export {};
