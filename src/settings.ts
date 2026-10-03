import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface AppSettings {
  modelsDirectory: string;
  workspaceDirectory?: string;
  maxContextFiles: number;
}

const DEFAULT_SETTINGS: AppSettings = { modelsDirectory: 'Models', maxContextFiles: 2000 };

export async function loadSettings(path: string): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(path: string, settings: AppSettings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
