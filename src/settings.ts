import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AppSettings {
  modelsDirectory: string;
  modelPaths?: string[];
  workspaceDirectory?: string;
  maxContextFiles: number;
}

const DEFAULT_SETTINGS: AppSettings = { modelsDirectory: 'Models', maxContextFiles: 2000 };

export async function loadSettings(
  path: string,
  defaults: AppSettings = DEFAULT_SETTINGS,
): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings>;
    const settings: AppSettings = {
      ...defaults,
      modelsDirectory:
        typeof raw.modelsDirectory === 'string' && raw.modelsDirectory.trim()
          ? raw.modelsDirectory
          : defaults.modelsDirectory,
      maxContextFiles:
        typeof raw.maxContextFiles === 'number' && Number.isFinite(raw.maxContextFiles)
          ? Math.max(100, Math.min(10_000, Math.floor(raw.maxContextFiles)))
          : defaults.maxContextFiles,
    };
    const modelPaths = Array.isArray(raw.modelPaths)
      ? raw.modelPaths.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : defaults.modelPaths;
    if (modelPaths && modelPaths.length > 0) settings.modelPaths = [...new Set(modelPaths)];
    const workspaceDirectory =
      typeof raw.workspaceDirectory === 'string' && raw.workspaceDirectory.trim()
        ? raw.workspaceDirectory
        : defaults.workspaceDirectory;
    if (workspaceDirectory !== undefined) settings.workspaceDirectory = workspaceDirectory;
    return settings;
  } catch {
    return { ...defaults };
  }
}

export async function saveSettings(path: string, settings: AppSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
