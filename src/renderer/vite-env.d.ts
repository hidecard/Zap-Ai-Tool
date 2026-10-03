import type { ModelDescriptor, ModelManagerState } from '../index.js';

declare global {
  interface Window {
    zap: {
      listModels(): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }>;
      selectModel(modelId: string): Promise<ModelManagerState>;
      unloadModel(): Promise<ModelManagerState>;
    };
  }
}

export {};
