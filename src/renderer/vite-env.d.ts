import type { FileDiff, ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';
import type { AgentProgressEvent, AgentRunResult } from '../agentRunner.js';
import type { PatchApplyResult } from '../patches.js';
import type { CompletionOptions, CompletionResult } from '../llamaRuntime.js';
import type { AppSettings } from '../settings.js';
import type { SearchMatch, SearchOptions } from '../search.js';
import type { GitFileDiff, GitSnapshot } from '../git.js';
import type { WorkspaceConfig } from '../workspace.js';
import type { TerminalResult } from '../tools.js';

export interface SearchOutcome {
  query: string;
  matches: SearchMatch[];
  filesSearched: number;
  filesSkipped: number;
  truncated: boolean;
}

declare global {
  interface Window {
    zap: {
      listModels(): Promise<{ models: ModelDescriptor[]; state: ModelManagerState }>;
      selectModel(modelId: string): Promise<ModelManagerState>;
      unloadModel(): Promise<ModelManagerState>;
      checkModelHealth(): Promise<{ healthy: boolean; message: string; state: ModelManagerState }>;
      complete(prompt: string, options?: CompletionOptions): Promise<CompletionResult>;
      runAgentTask(rootPath: string, instruction: string): Promise<AgentRunResult>;
      cancelAgentTask(): Promise<{ cancelled: boolean }>;
      onAgentProgress(listener: (event: AgentProgressEvent) => void): () => void;
      chooseWorkspace(): Promise<WorkspaceContext | null>;
      loadWorkspace(rootPath: string): Promise<WorkspaceContext>;
      readWorkspaceFile(rootPath: string, filePath: string): Promise<string>;
      readWorkspaceFileIfExists(rootPath: string, filePath: string): Promise<string | null>;
      writeWorkspaceFile(
        rootPath: string,
        filePath: string,
        content: string,
      ): Promise<PatchApplyResult>;
      readWorkspaceConfig(rootPath: string): Promise<WorkspaceConfig>;
      saveWorkspaceConfig(rootPath: string, config: WorkspaceConfig): Promise<WorkspaceConfig>;
      searchWorkspace(
        rootPath: string,
        query: string,
        options?: SearchOptions,
      ): Promise<SearchOutcome>;
      cancelSearch(): Promise<{ cancelled: boolean }>;
      gitStatus(rootPath: string): Promise<GitSnapshot>;
      gitDiff(rootPath: string, filePath: string): Promise<GitFileDiff | undefined>;
      applyPatches(rootPath: string, diffs: FileDiff[]): Promise<PatchApplyResult>;
      rollbackPatches(rootPath: string, backupId: string): Promise<string[]>;
      getSettings(): Promise<AppSettings>;
      updateSettings(
        patch: Partial<AppSettings>,
      ): Promise<AppSettings & { state: ModelManagerState }>;
      chooseModelsDirectory(): Promise<AppSettings | null>;
      chooseModelFile(): Promise<AppSettings | null>;
      runTerminal(rootPath: string, command: string): Promise<TerminalResult>;
      cancelTerminal(): Promise<{ cancelled: boolean }>;
    };
  }
}

export {};
