import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
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
      name: entry.name.slice(0, -'.gguf'.length),
      path,
      format: 'gguf',
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    });
  }

  return models.sort((left, right) => left.name.localeCompare(right.name));
}

export async function describeModel(modelPath: string): Promise<ModelDescriptor> {
  if (!modelPath.toLowerCase().endsWith('.gguf')) {
    throw new Error('Only GGUF model files are supported.');
  }
  const metadata = await stat(modelPath);
  return {
    id: `external:${modelPath}`,
    name: modelPath.split(/[\\/]/).pop()?.slice(0, -'.gguf'.length) ?? modelPath,
    path: modelPath,
    format: 'gguf',
    sizeBytes: metadata.size,
    modifiedAt: metadata.mtime.toISOString(),
  };
}
