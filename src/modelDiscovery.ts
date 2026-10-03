import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { ModelDescriptor } from './domain.js';

export async function discoverModels(modelsDirectory: string): Promise<ModelDescriptor[]> {
  const entries = await readdir(modelsDirectory, { withFileTypes: true });
  const models: ModelDescriptor[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gguf')) continue;
    const path = join(modelsDirectory, entry.name);
    const metadata = await stat(path);
    models.push({
      id: entry.name,
      name: basename(entry.name, '.gguf'),
      path,
      format: 'gguf',
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    });
  }

  return models.sort((left, right) => left.name.localeCompare(right.name));
}
