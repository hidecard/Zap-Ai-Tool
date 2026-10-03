import { contextBridge, ipcRenderer } from 'electron';
import type { ModelDescriptor, ModelManagerState, WorkspaceContext } from '../src/index.js';

contextBridge.exposeInMainWorld('zap', {
  listModels: (): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }> =>
    ipcRenderer.invoke('models:list'),
  selectModel: (modelId: string): Promise<ModelManagerState> =>
    ipcRenderer.invoke('models:select', modelId),
  unloadModel: (): Promise<ModelManagerState> => ipcRenderer.invoke('models:unload'),
  chooseWorkspace: (): Promise<WorkspaceContext | null> => ipcRenderer.invoke('workspace:choose'),
  loadWorkspace: (rootPath: string): Promise<WorkspaceContext> =>
    ipcRenderer.invoke('workspace:load', rootPath),
});
