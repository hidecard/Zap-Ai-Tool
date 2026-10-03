import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { WorkspaceContext, WorkspaceFile } from './domain.js';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.DS_Store']);
const SECRET_NAMES = new Set(['.env', '.env.local', 'id_rsa', 'id_ed25519']);

export async function buildWorkspaceContext(
  rootPath: string,
  options: { instructions?: string; maxFiles?: number; maxFileBytes?: number } = {},
): Promise<WorkspaceContext> {
  const files: WorkspaceFile[] = [];
  const maxFiles = options.maxFiles ?? 2000;
  const maxFileBytes = options.maxFileBytes ?? 512_000;

  async function walk(directory: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        files.length >= maxFiles ||
        DEFAULT_IGNORES.has(entry.name) ||
        SECRET_NAMES.has(entry.name)
      )
        continue;
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(rootPath, absolutePath);
      if (entry.isDirectory()) {
        files.push({ relativePath, sizeBytes: 0, kind: 'directory' });
        await walk(absolutePath);
      } else if (entry.isFile()) {
        const metadata = await stat(absolutePath);
        if (metadata.size <= maxFileBytes)
          files.push({ relativePath, sizeBytes: metadata.size, kind: 'file' });
      }
    }
  }

  await walk(rootPath);
  return {
    rootPath,
    files,
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    estimatedTokens: Math.ceil(files.reduce((total, file) => total + file.sizeBytes, 0) / 4),
  };
}
