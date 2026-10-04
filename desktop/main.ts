import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModels } from '../src/modelDiscovery.js';
import { ModelManager } from '../src/modelManager.js';
import { LlamaServerRuntime, type CompletionOptions } from '../src/llamaRuntime.js';
import { buildWorkspaceContext, loadWorkspaceOptions } from '../src/workspace.js';
import { applyFileDiffs, rollbackFileDiffs } from '../src/patches.js';
import { readWorkspaceFile } from '../src/tools.js';
import type { FileDiff } from '../src/domain.js';

const distributionDirectory = fileURLToPath(new URL('..', import.meta.url));
const projectDirectory = fileURLToPath(new URL('../..', import.meta.url));
const modelsDirectory = app.isPackaged
  ? join(process.resourcesPath, 'Models')
  : join(projectDirectory, 'Models');

const runtime = new LlamaServerRuntime({
  ...(process.env.LLAMA_SERVER_PATH ? { executablePath: process.env.LLAMA_SERVER_PATH } : {}),
  ...(process.env.LLAMA_GPU_LAYERS ? { gpuLayers: Number(process.env.LLAMA_GPU_LAYERS) } : {}),
});
const modelManager = new ModelManager(runtime);

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
  return buildWorkspaceContext(selectedPath, await loadWorkspaceOptions(selectedPath));
});

ipcMain.handle('workspace:load', async (_event, rootPath: string) =>
  buildWorkspaceContext(rootPath, await loadWorkspaceOptions(rootPath)),
);

ipcMain.handle('workspace:read-file', async (_event, rootPath: string, filePath: string) =>
  readWorkspaceFile(rootPath, filePath),
);

ipcMain.handle('patches:apply', async (_event, rootPath: string, diffs: FileDiff[]) =>
  applyFileDiffs(rootPath, diffs),
);

ipcMain.handle('patches:rollback', async (_event, rootPath: string, backupId: string) =>
  rollbackFileDiffs(rootPath, backupId),
);

app.whenReady().then(async () => {
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
