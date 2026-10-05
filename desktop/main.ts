import { app, BrowserWindow, dialog, ipcMain, screen } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModelsDirectory } from '../src/appPaths.js';
import { runAgentTask, type AgentProgressEvent } from '../src/agentRunner.js';
import { describeModel, discoverModels } from '../src/modelDiscovery.js';
import { ModelManager } from '../src/modelManager.js';
import type { CompletionOptions } from '../src/llamaRuntime.js';
import { createCompletionRuntime, type CompletionRuntime } from '../src/completionRuntime.js';
import { describeHostedModel } from '../src/hostedRuntime.js';
import {
  buildWorkspaceContext,
  loadWorkspaceOptions,
  readWorkspaceConfig,
  saveWorkspaceConfig,
  type WorkspaceConfig,
} from '../src/workspace.js';
import { applyFileDiffs, rollbackFileDiffs, writeWorkspaceFile } from '../src/patches.js';
import { readWorkspaceFile, readWorkspaceFileIfExists, runApprovedTerminal } from '../src/tools.js';
import { searchWorkspaceFiles, type SearchOptions } from '../src/search.js';
import { readGitFileDiff, readGitStatus } from '../src/git.js';
import type { FileDiff, ToolCall, WorkspaceContext } from '../src/domain.js';
import {
  loadSettings,
  sanitizeSettingsPatch,
  saveSettings,
  type AppSettings,
} from '../src/settings.js';

const distributionDirectory = fileURLToPath(new URL('..', import.meta.url));
const projectDirectory = fileURLToPath(new URL('../..', import.meta.url));
let modelsDirectory = resolveModelsDirectory({
  isPackaged: app.isPackaged,
  projectDirectory,
  userDataDirectory: app.getPath('userData'),
});
const settingsPath = join(app.getPath('userData'), 'settings.json');
let appSettings: AppSettings = { modelsDirectory, maxContextFiles: 2000 };
let activeWorkspaceDirectory: string | undefined;
let activeWorkspace: WorkspaceContext | undefined;
let agentTaskRunning = false;

function llamaOptions(): Record<string, unknown> {
  return {
    ...(process.env.LLAMA_SERVER_PATH ? { executablePath: process.env.LLAMA_SERVER_PATH } : {}),
    ...(process.env.LLAMA_GPU_LAYERS ? { gpuLayers: Number(process.env.LLAMA_GPU_LAYERS) } : {}),
  };
}

function buildRuntime(): CompletionRuntime {
  return createCompletionRuntime(appSettings, llamaOptions());
}

let runtime: CompletionRuntime = buildRuntime();
let modelManager = new ModelManager(runtime);

const agentControllers = new Map<number, AbortController>();
const terminalControllers = new Map<number, AbortController>();
const searchControllers = new Map<number, AbortController>();

function assertActiveWorkspace(rootPath: string, action: string): void {
  if (!activeWorkspaceDirectory || resolve(rootPath) !== resolve(activeWorkspaceDirectory))
    throw new Error(`${action} must use the currently selected project.`);
}

async function discoverConfiguredModels(): Promise<Awaited<ReturnType<typeof discoverModels>>> {
  if (appSettings.provider?.kind === 'openai-compatible')
    return [describeHostedModel(appSettings.provider)];
  const bundled = await discoverModels(modelsDirectory);
  const external = await Promise.all(
    (appSettings.modelPaths ?? []).map(async (modelPath) => {
      try {
        return await describeModel(modelPath);
      } catch {
        return undefined;
      }
    }),
  );
  const models = [
    ...bundled,
    ...external.filter((model): model is NonNullable<typeof model> => model !== undefined),
  ];
  return models.filter(
    (model, index) => models.findIndex((candidate) => candidate.path === model.path) === index,
  );
}

async function loadWorkspaceContext(rootPath: string) {
  const options = await loadWorkspaceOptions(rootPath);
  const context = await buildWorkspaceContext(rootPath, {
    ...options,
    maxFiles: appSettings.maxContextFiles,
  });
  activeWorkspaceDirectory = rootPath;
  activeWorkspace = context;
  appSettings = { ...appSettings, workspaceDirectory: rootPath };
  await saveSettings(settingsPath, appSettings);
  return context;
}

async function persistSettings(next: AppSettings): Promise<AppSettings> {
  appSettings = next;
  modelsDirectory = next.modelsDirectory;
  await saveSettings(settingsPath, appSettings);
  return { ...appSettings };
}

async function createWindow(): Promise<void> {
  await mkdir(modelsDirectory, { recursive: true });
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(1280, workArea.width),
    height: Math.min(820, workArea.height),
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: join(distributionDirectory, 'desktop/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(join(distributionDirectory, 'renderer/index.html'));
}

ipcMain.handle('models:list', async () => {
  await mkdir(modelsDirectory, { recursive: true });
  const models = await discoverConfiguredModels();
  modelManager.setAvailable(models);
  return { models, state: modelManager.getState() };
});

ipcMain.handle('models:select', async (_event, modelId: string) => {
  return modelManager.select(modelId);
});

ipcMain.handle('models:unload', async () => modelManager.unload());

ipcMain.handle('models:health', async () => ({
  ...(await runtime.healthCheck()),
  state: modelManager.getState(),
}));

ipcMain.handle('models:complete', async (_event, prompt: string, options?: CompletionOptions) => {
  return runtime.complete(prompt, options);
});

ipcMain.handle('agent:run', async (event, rootPath: string, instruction: string) => {
  assertActiveWorkspace(rootPath, 'Agent tasks');
  if (agentTaskRunning) throw new Error('An agent task is already running.');
  if (modelManager.getState().status !== 'ready')
    throw new Error('Select a model and wait until it is ready before starting an agent task.');

  const controller = new AbortController();
  const sender = event.sender;
  agentControllers.set(sender.id, controller);
  agentTaskRunning = true;
  try {
    const workspace = await loadWorkspaceContext(rootPath);
    const parent = BrowserWindow.fromWebContents(sender);
    const ensureWorkspaceActive = (): void => {
      assertActiveWorkspace(rootPath, 'This agent task');
    };
    const result = await runAgentTask({
      workspace,
      instruction,
      signal: controller.signal,
      onEvent: (progress: AgentProgressEvent) => {
        if (!sender.isDestroyed()) sender.send('agent:progress', progress);
      },
      complete: (prompt, options) => {
        ensureWorkspaceActive();
        return runtime.complete(prompt, options);
      },
      readFile: (path, maxBytes) => {
        ensureWorkspaceActive();
        return readWorkspaceFile(rootPath, path, maxBytes);
      },
      readFileIfExists: (path, maxBytes) => {
        ensureWorkspaceActive();
        return readWorkspaceFileIfExists(rootPath, path, maxBytes);
      },
      approveTerminal: async (call) => {
        ensureWorkspaceActive();
        const options = {
          type: 'warning' as const,
          title: 'Approve AI Terminal Command',
          message: call.summary,
          detail: `Working directory:\n${rootPath}\n\nCommand to run once:\n${call.command ?? ''}`,
          buttons: ['Reject', 'Run once'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        };
        const result = parent
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options);
        ensureWorkspaceActive();
        return result.response === 1;
      },
      runTerminal: (call, signal) => {
        ensureWorkspaceActive();
        return runApprovedTerminal(rootPath, call, {
          timeoutMs: 30_000,
          maxOutputBytes: 32_000,
          ...(signal ? { signal } : {}),
          ...(appSettings.terminalPolicy ? { policy: appSettings.terminalPolicy } : {}),
        });
      },
      ...(appSettings.terminalPolicy ? { terminalPolicy: appSettings.terminalPolicy } : {}),
    });
    if (!activeWorkspaceDirectory || resolve(rootPath) !== resolve(activeWorkspaceDirectory)) {
      return {
        ...result,
        diffs: [],
        message:
          'The selected project changed while the agent was working. No file proposal was returned.',
      };
    }
    return result;
  } finally {
    agentTaskRunning = false;
    agentControllers.delete(sender.id);
  }
});

ipcMain.handle('agent:cancel', async (event) => {
  const controller = agentControllers.get(event.sender.id);
  if (!controller) return { cancelled: false };
  controller.abort();
  const terminalController = terminalControllers.get(event.sender.id);
  terminalController?.abort();
  return { cancelled: true };
});

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selectedPath = result.filePaths[0];
  if (!selectedPath) return null;
  return loadWorkspaceContext(selectedPath);
});

ipcMain.handle('workspace:load', async (_event, rootPath: string) =>
  loadWorkspaceContext(rootPath),
);

ipcMain.handle('workspace:read-file', async (_event, rootPath: string, filePath: string) =>
  readWorkspaceFile(rootPath, filePath),
);

ipcMain.handle(
  'workspace:read-file-if-exists',
  async (_event, rootPath: string, filePath: string) =>
    readWorkspaceFileIfExists(rootPath, filePath),
);

ipcMain.handle(
  'workspace:write-file',
  async (_event, rootPath: string, filePath: string, content: string) => {
    assertActiveWorkspace(rootPath, 'File saves');
    return writeWorkspaceFile(rootPath, filePath, content);
  },
);

ipcMain.handle('workspace:read-config', async (_event, rootPath: string) => {
  assertActiveWorkspace(rootPath, 'Project settings');
  return readWorkspaceConfig(rootPath);
});

ipcMain.handle(
  'workspace:save-config',
  async (_event, rootPath: string, config: WorkspaceConfig) => {
    assertActiveWorkspace(rootPath, 'Project settings');
    const saved = await saveWorkspaceConfig(rootPath, config);
    return loadWorkspaceContext(rootPath).then(() => saved);
  },
);

ipcMain.handle(
  'search:run',
  async (event, rootPath: string, query: string, options?: SearchOptions) => {
    assertActiveWorkspace(rootPath, 'Search');
    const controller = new AbortController();
    const senderId = event.sender.id;
    searchControllers.set(senderId, controller);
    try {
      const files =
        activeWorkspace?.rootPath === rootPath
          ? activeWorkspace.files
          : (
              await buildWorkspaceContext(rootPath, {
                ...(await loadWorkspaceOptions(rootPath)),
                maxFiles: appSettings.maxContextFiles,
              })
            ).files;
      return await searchWorkspaceFiles(rootPath, files, query, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      if (searchControllers.get(senderId) === controller) searchControllers.delete(senderId);
    }
  },
);

ipcMain.handle('search:cancel', async (event) => {
  searchControllers.get(event.sender.id)?.abort();
  return { cancelled: true };
});

ipcMain.handle('git:status', async (_event, rootPath: string) => {
  assertActiveWorkspace(rootPath, 'Git status');
  return readGitStatus(rootPath);
});

ipcMain.handle('git:diff', async (_event, rootPath: string, filePath: string) => {
  assertActiveWorkspace(rootPath, 'Git diff');
  return readGitFileDiff(rootPath, filePath);
});

ipcMain.handle('patches:apply', async (_event, rootPath: string, diffs: FileDiff[]) =>
  applyFileDiffs(rootPath, diffs),
);

ipcMain.handle('patches:rollback', async (_event, rootPath: string, backupId: string) =>
  rollbackFileDiffs(rootPath, backupId),
);

ipcMain.handle('settings:get', () => ({ ...appSettings }));

ipcMain.handle('settings:update', async (_event, patch: Partial<AppSettings>) => {
  const sanitized = sanitizeSettingsPatch(patch);
  const previousProvider = appSettings.provider?.kind;
  const next = await persistSettings({ ...appSettings, ...sanitized });
  if (sanitized.provider && sanitized.provider.kind !== previousProvider) {
    await runtime.unload().catch(() => undefined);
    runtime = buildRuntime();
    modelManager = new ModelManager(runtime);
  }
  return { ...next, state: modelManager.getState() };
});

ipcMain.handle('settings:choose-models-directory', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose model folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  const selectedPath = result.filePaths[0];
  if (result.canceled || !selectedPath) return null;
  await mkdir(selectedPath, { recursive: true });
  await modelManager.unload();
  return persistSettings({ ...appSettings, modelsDirectory: selectedPath });
});

ipcMain.handle('models:choose-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Choose a GGUF model file',
    properties: ['openFile'],
    filters: [{ name: 'GGUF models', extensions: ['gguf'] }],
  });
  const selectedPath = result.filePaths[0];
  if (result.canceled || !selectedPath) return null;
  await describeModel(selectedPath);
  const modelPaths = [...new Set([...(appSettings.modelPaths ?? []), selectedPath])];
  return persistSettings({ ...appSettings, modelPaths });
});

ipcMain.handle('terminal:run', async (event, rootPath: string, command: string) => {
  assertActiveWorkspace(rootPath, 'Terminal commands');
  if (!command.trim()) throw new Error('Enter a terminal command first.');
  const call: ToolCall = {
    id: `manual-${Date.now()}`,
    name: 'terminal.run',
    risk: 'mutating',
    summary: 'Run command approved by the user',
    command,
    status: 'approved',
  };
  const controller = new AbortController();
  const senderId = event.sender.id;
  terminalControllers.set(senderId, controller);
  try {
    return await runApprovedTerminal(rootPath, call, {
      ...(appSettings.terminalPolicy ? { policy: appSettings.terminalPolicy } : {}),
      signal: controller.signal,
    });
  } finally {
    if (terminalControllers.get(senderId) === controller) terminalControllers.delete(senderId);
  }
});

ipcMain.handle('terminal:cancel', async (event) => {
  terminalControllers.get(event.sender.id)?.abort();
  return { cancelled: true };
});

app.whenReady().then(async () => {
  appSettings = await loadSettings(settingsPath, { modelsDirectory, maxContextFiles: 2000 });
  modelsDirectory = appSettings.modelsDirectory;
  runtime = buildRuntime();
  modelManager = new ModelManager(runtime);
  await mkdir(modelsDirectory, { recursive: true });
  await createWindow();
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  for (const controller of agentControllers.values()) controller.abort();
  for (const controller of terminalControllers.values()) controller.abort();
  for (const controller of searchControllers.values()) controller.abort();
  void runtime.unload().finally(() => app.quit());
});
