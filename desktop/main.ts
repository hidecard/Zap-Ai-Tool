import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModelsDirectory } from '../src/appPaths.js';
import { discoverModels } from '../src/modelDiscovery.js';
import { ModelManager } from '../src/modelManager.js';
import { LlamaServerRuntime, type CompletionOptions } from '../src/llamaRuntime.js';
import { buildWorkspaceContext, loadWorkspaceOptions } from '../src/workspace.js';
import { applyFileDiffs, rollbackFileDiffs } from '../src/patches.js';
import { readWorkspaceFile, readWorkspaceFileIfExists, runApprovedTerminal } from '../src/tools.js';
import type { FileDiff, ToolCall } from '../src/domain.js';
import { loadSettings, saveSettings, type AppSettings } from '../src/settings.js';

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

const runtime = new LlamaServerRuntime({
  ...(process.env.LLAMA_SERVER_PATH ? { executablePath: process.env.LLAMA_SERVER_PATH } : {}),
  ...(process.env.LLAMA_GPU_LAYERS ? { gpuLayers: Number(process.env.LLAMA_GPU_LAYERS) } : {}),
});
const modelManager = new ModelManager(runtime);

async function loadWorkspaceContext(rootPath: string) {
  const options = await loadWorkspaceOptions(rootPath);
  const context = await buildWorkspaceContext(rootPath, {
    ...options,
    maxFiles: appSettings.maxContextFiles,
  });
  activeWorkspaceDirectory = rootPath;
  appSettings = { ...appSettings, workspaceDirectory: rootPath };
  await saveSettings(settingsPath, appSettings);
  return context;
}

async function persistSettings(next: AppSettings): Promise<AppSettings> {
  appSettings = next;
  await saveSettings(settingsPath, appSettings);
  return { ...appSettings };
}

async function createWindow(): Promise<void> {
  await mkdir(modelsDirectory, { recursive: true });
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: join(distributionDirectory, 'desktop/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadFile(join(distributionDirectory, 'renderer/index.html'));
}

ipcMain.handle('models:list', async () => {
  await mkdir(modelsDirectory, { recursive: true });
  const models = await discoverModels(modelsDirectory);
  modelManager.setAvailable(models);
  return { models, state: modelManager.getState() };
});

ipcMain.handle('models:select', async (_event, modelId: string) => {
  return modelManager.select(modelId);
});

ipcMain.handle('models:unload', async () => modelManager.unload());

ipcMain.handle('models:complete', async (_event, prompt: string, options?: CompletionOptions) => {
  return runtime.complete(prompt, options);
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

ipcMain.handle('patches:apply', async (_event, rootPath: string, diffs: FileDiff[]) =>
  applyFileDiffs(rootPath, diffs),
);

ipcMain.handle('patches:rollback', async (_event, rootPath: string, backupId: string) =>
  rollbackFileDiffs(rootPath, backupId),
);

ipcMain.handle('settings:get', () => ({ ...appSettings }));

ipcMain.handle('settings:update-context-limit', async (_event, maxContextFiles: number) => {
  if (!Number.isFinite(maxContextFiles)) throw new Error('Context file limit must be a number.');
  return persistSettings({
    ...appSettings,
    maxContextFiles: Math.max(100, Math.min(10_000, Math.floor(maxContextFiles))),
  });
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
  modelsDirectory = selectedPath;
  return persistSettings({ ...appSettings, modelsDirectory: selectedPath });
});

ipcMain.handle('terminal:run', async (_event, rootPath: string, command: string) => {
  if (!activeWorkspaceDirectory || resolve(rootPath) !== resolve(activeWorkspaceDirectory)) {
    throw new Error('Terminal commands must run in the currently selected workspace.');
  }
  if (!command.trim()) throw new Error('Enter a terminal command first.');
  const call: ToolCall = {
    id: `manual-${Date.now()}`,
    name: 'terminal.run',
    risk: 'mutating',
    summary: 'Run command approved by the user',
    command,
    status: 'approved',
  };
  return runApprovedTerminal(rootPath, call);
});

app.whenReady().then(async () => {
  appSettings = await loadSettings(settingsPath, { modelsDirectory, maxContextFiles: 2000 });
  modelsDirectory = appSettings.modelsDirectory;
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
  void runtime.unload().finally(() => app.quit());
});
