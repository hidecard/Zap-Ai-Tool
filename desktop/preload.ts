import { contextBridge, ipcRenderer } from 'electron';
import type {
  ModelDescriptor,
  ModelManagerState,
  WorkspaceContext,
  FileDiff,
} from '../src/index.js';
import type { PatchApplyResult } from '../src/patches.js';
import type { CompletionOptions, CompletionResult } from '../src/llamaRuntime.js';

contextBridge.exposeInMainWorld('zap', {
  listModels: (): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }> =>
    ipcRenderer.invoke('models:list'),
  selectModel: (modelId: string): Promise<ModelManagerState> =>
    ipcRenderer.invoke('models:select', modelId),
  unloadModel: (): Promise<ModelManagerState> => ipcRenderer.invoke('models:unload'),
  complete: (prompt: string, options?: CompletionOptions): Promise<CompletionResult> =>
    ipcRenderer.invoke('models:complete', prompt, options),
  chooseWorkspace: (): Promise<WorkspaceContext | null> => ipcRenderer.invoke('workspace:choose'),
  loadWorkspace: (rootPath: string): Promise<WorkspaceContext> =>
    ipcRenderer.invoke('workspace:load', rootPath),
  readWorkspaceFile: (rootPath: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke('workspace:read-file', rootPath, filePath),
  applyPatches: (rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult> =>
    ipcRenderer.invoke('patches:apply', rootPath, diffs),
  rollbackPatches: (rootPath: string, backupId: string): Promise<string[]> =>
    ipcRenderer.invoke('patches:rollback', rootPath, backupId),
});
