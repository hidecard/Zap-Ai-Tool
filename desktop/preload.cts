import { contextBridge, ipcRenderer } from 'electron';
import type {
  ModelDescriptor,
  ModelManagerState,
  WorkspaceContext,
  FileDiff,
} from '../src/index.js';
import type { AgentRunResult } from '../src/agentRunner.js';
import type { PatchApplyResult } from '../src/patches.js';
import type { CompletionOptions, CompletionResult } from '../src/llamaRuntime.js';
import type { AppSettings } from '../src/settings.js';
import type { TerminalResult } from '../src/tools.js';

contextBridge.exposeInMainWorld('zap', {
  listModels: (): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }> =>
    ipcRenderer.invoke('models:list'),
  selectModel: (modelId: string): Promise<ModelManagerState> =>
    ipcRenderer.invoke('models:select', modelId),
  unloadModel: (): Promise<ModelManagerState> => ipcRenderer.invoke('models:unload'),
  complete: (prompt: string, options?: CompletionOptions): Promise<CompletionResult> =>
    ipcRenderer.invoke('models:complete', prompt, options),
  runAgentTask: (rootPath: string, instruction: string): Promise<AgentRunResult> =>
    ipcRenderer.invoke('agent:run', rootPath, instruction),
  chooseWorkspace: (): Promise<WorkspaceContext | null> => ipcRenderer.invoke('workspace:choose'),
  loadWorkspace: (rootPath: string): Promise<WorkspaceContext> =>
    ipcRenderer.invoke('workspace:load', rootPath),
  readWorkspaceFile: (rootPath: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke('workspace:read-file', rootPath, filePath),
  readWorkspaceFileIfExists: (rootPath: string, filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('workspace:read-file-if-exists', rootPath, filePath),
  applyPatches: (rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult> =>
    ipcRenderer.invoke('patches:apply', rootPath, diffs),
  rollbackPatches: (rootPath: string, backupId: string): Promise<string[]> =>
    ipcRenderer.invoke('patches:rollback', rootPath, backupId),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateMaxContextFiles: (maxContextFiles: number): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update-context-limit', maxContextFiles),
  chooseModelsDirectory: (): Promise<AppSettings | null> =>
    ipcRenderer.invoke('settings:choose-models-directory'),
  chooseModelFile: (): Promise<AppSettings | null> => ipcRenderer.invoke('models:choose-file'),
  runTerminal: (rootPath: string, command: string): Promise<TerminalResult> =>
    ipcRenderer.invoke('terminal:run', rootPath, command),
});
