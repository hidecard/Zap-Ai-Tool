import type { ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';

declare global {
  interface Window {
    zap: {
      listModels(): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }>;
      selectModel(modelId: string): Promise<ModelManagerState>;
      unloadModel(): Promise<ModelManagerState>;
      chooseWorkspace(): Promise<WorkspaceContext | null>;
      loadWorkspace(rootPath: string): Promise<WorkspaceContext>;
    };
  }
}

export {};
