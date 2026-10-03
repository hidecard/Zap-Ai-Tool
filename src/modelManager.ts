import type { ModelDescriptor } from './domain.js';

export interface ModelRuntime {
  load(model: ModelDescriptor): Promise<void>;
  unload(): Promise<void>;
  healthCheck(): Promise<{ healthy: boolean; message: string }>;
}

export interface ModelManagerState {
  available: ModelDescriptor[];
  selectedId: string | undefined;
  loadedId: string | undefined;
  status: 'idle' | 'loading' | 'ready' | 'unloading' | 'error';
  error: string | undefined;
}

export class ModelManager {
  private state: ModelManagerState = {
    available: [],
    selectedId: undefined,
    loadedId: undefined,
    status: 'idle',
    error: undefined,
  };

  constructor(private readonly runtime: ModelRuntime) {}

  setAvailable(models: ModelDescriptor[]): void {
    this.state = { ...this.state, available: [...models] };
  }

  getState(): ModelManagerState {
    return { ...this.state, available: [...this.state.available] };
  }

  async select(modelId: string): Promise<ModelManagerState> {
    const model = this.state.available.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error(`Model not found: ${modelId}`);
    this.state = { ...this.state, selectedId: modelId, status: 'loading', error: undefined };
    try {
      if (this.state.loadedId) {
        this.state = { ...this.state, status: 'unloading' };
        await this.runtime.unload();
      }
      await this.runtime.load(model);
      const health = await this.runtime.healthCheck();
      if (!health.healthy) throw new Error(health.message);
      this.state = { ...this.state, loadedId: modelId, status: 'ready', error: undefined };
    } catch (error) {
      this.state = {
        ...this.state,
        loadedId: undefined,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return this.getState();
  }

  async unload(): Promise<ModelManagerState> {
    if (!this.state.loadedId) return this.getState();
    this.state = { ...this.state, status: 'unloading' };
    await this.runtime.unload();
    this.state = { ...this.state, loadedId: undefined, status: 'idle' };
    return this.getState();
  }
}
