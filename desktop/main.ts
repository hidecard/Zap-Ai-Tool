import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverModels } from '../src/modelDiscovery.js';
import { ModelManager } from '../src/modelManager.js';
import { buildWorkspaceContext } from '../src/workspace.js';

const distributionDirectory = fileURLToPath(new URL('..', import.meta.url));
const projectDirectory = fileURLToPath(new URL('../..', import.meta.url));
const modelsDirectory = app.isPackaged
  ? join(process.resourcesPath, 'Models')
  : join(projectDirectory, 'Models');

const runtime = {
  async load(): Promise<void> {
    // The llama.cpp adapter will be plugged in during the model runtime phase.
  },
  async unload(): Promise<void> {},
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    return { healthy: true, message: 'Model selected; runtime adapter ready for integration.' };
  },
};
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

ipcMain.handle('workspace:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  const selectedPath = result.filePaths[0];
  if (!selectedPath) return null;
  return buildWorkspaceContext(selectedPath);
});

ipcMain.handle('workspace:load', async (_event, rootPath: string) =>
  buildWorkspaceContext(rootPath),
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
