import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  FileDiff,
  ModelDescriptor,
  ModelManagerState,
  WorkspaceContext,
} from '../src/index.js';
import type { AgentProgressEvent, AgentRunResult } from '../src/agentRunner.js';
import type { PatchApplyResult } from '../src/patches.js';
import type { CompletionOptions, CompletionResult } from '../src/llamaRuntime.js';
import type { AppSettings } from '../src/settings.js';
import type { SearchMatch, SearchOptions } from '../src/search.js';
import type { GitSnapshot, GitFileDiff } from '../src/git.js';
import type { WorkspaceConfig } from '../src/workspace.js';
import type { TerminalResult } from '../src/tools.js';

const zap = {
  listModels: (): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }> =>
    ipcRenderer.invoke('models:list'),
  selectModel: (modelId: string): Promise<ModelManagerState> =>
    ipcRenderer.invoke('models:select', modelId),
  unloadModel: (): Promise<ModelManagerState> => ipcRenderer.invoke('models:unload'),
  checkModelHealth: (): Promise<{ healthy: boolean; message: string; state: ModelManagerState }> =>
    ipcRenderer.invoke('models:health'),
  complete: (prompt: string, options?: CompletionOptions): Promise<CompletionResult> =>
    ipcRenderer.invoke('models:complete', prompt, options),
  runAgentTask: (rootPath: string, instruction: string): Promise<AgentRunResult> =>
    ipcRenderer.invoke('agent:run', rootPath, instruction),
  cancelAgentTask: (): Promise<{ cancelled: boolean }> => ipcRenderer.invoke('agent:cancel'),
  onAgentProgress: (listener: (event: AgentProgressEvent) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: AgentProgressEvent): void =>
      listener(payload);
    ipcRenderer.on('agent:progress', handler);
    return () => ipcRenderer.removeListener('agent:progress', handler);
  },
  chooseWorkspace: (): Promise<WorkspaceContext | null> => ipcRenderer.invoke('workspace:choose'),
  loadWorkspace: (rootPath: string): Promise<WorkspaceContext> =>
    ipcRenderer.invoke('workspace:load', rootPath),
  readWorkspaceFile: (rootPath: string, filePath: string): Promise<string> =>
    ipcRenderer.invoke('workspace:read-file', rootPath, filePath),
  readWorkspaceFileIfExists: (rootPath: string, filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('workspace:read-file-if-exists', rootPath, filePath),
  writeWorkspaceFile: (
    rootPath: string,
    filePath: string,
    content: string,
  ): Promise<PatchApplyResult> =>
    ipcRenderer.invoke('workspace:write-file', rootPath, filePath, content),
  readWorkspaceConfig: (rootPath: string): Promise<WorkspaceConfig> =>
    ipcRenderer.invoke('workspace:read-config', rootPath),
  saveWorkspaceConfig: (rootPath: string, config: WorkspaceConfig): Promise<WorkspaceConfig> =>
    ipcRenderer.invoke('workspace:save-config', rootPath, config),
  searchWorkspace: (
    rootPath: string,
    query: string,
    options?: SearchOptions,
  ): Promise<{
    query: string;
    matches: SearchMatch[];
    filesSearched: number;
    filesSkipped: number;
    truncated: boolean;
  }> => ipcRenderer.invoke('search:run', rootPath, query, options),
  cancelSearch: (): Promise<{ cancelled: boolean }> => ipcRenderer.invoke('search:cancel'),
  gitStatus: (rootPath: string): Promise<GitSnapshot> => ipcRenderer.invoke('git:status', rootPath),
  gitDiff: (rootPath: string, filePath: string): Promise<GitFileDiff | undefined> =>
    ipcRenderer.invoke('git:diff', rootPath, filePath),
  applyPatches: (rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult> =>
    ipcRenderer.invoke('patches:apply', rootPath, diffs),
  rollbackPatches: (rootPath: string, backupId: string): Promise<string[]> =>
    ipcRenderer.invoke('patches:rollback', rootPath, backupId),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  updateSettings: (
    patch: Partial<AppSettings>,
  ): Promise<AppSettings & { state: ModelManagerState }> =>
    ipcRenderer.invoke('settings:update', patch),
  chooseModelsDirectory: (): Promise<AppSettings | null> =>
    ipcRenderer.invoke('settings:choose-models-directory'),
  chooseModelFile: (): Promise<AppSettings | null> => ipcRenderer.invoke('models:choose-file'),
  runTerminal: (rootPath: string, command: string): Promise<TerminalResult> =>
    ipcRenderer.invoke('terminal:run', rootPath, command),
  cancelTerminal: (): Promise<{ cancelled: boolean }> => ipcRenderer.invoke('terminal:cancel'),
};

contextBridge.exposeInMainWorld('zap', zap);

export type ZapBridge = typeof zap;
