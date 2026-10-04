import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { WorkspaceContext, WorkspaceFile } from './domain.js';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.DS_Store']);
const SECRET_NAMES = new Set(['.env', '.env.local', 'id_rsa', 'id_ed25519']);

export interface WorkspaceOptions {
  instructions?: string;
  ignorePatterns?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
}

export async function loadWorkspaceOptions(rootPath: string): Promise<WorkspaceOptions> {
  const options: WorkspaceOptions = {};
  try {
    const instructions = await readFile(join(rootPath, 'ZAP.md'), 'utf8');
    if (instructions.trim()) options.instructions = instructions.trim();
  } catch {
    // Project instructions are optional.
  }
  try {
    const raw = await readFile(join(rootPath, '.zapignore'), 'utf8');
    const ignorePatterns = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    if (ignorePatterns.length > 0) options.ignorePatterns = ignorePatterns;
  } catch {
    // Project ignore patterns are optional.
  }
  return options;
}

function matchesIgnore(relativePath: string, name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const normalized = pattern
      .replaceAll('\\', '/')
      .replace(/^\//, '')
      .replace(/\/\*\*$/, '');
    return (
      normalized === name ||
      normalized === relativePath ||
      relativePath.startsWith(`${normalized}/`)
    );
  });
}

export async function buildWorkspaceContext(
  rootPath: string,
  options: WorkspaceOptions = {},
): Promise<WorkspaceContext> {
  const files: WorkspaceFile[] = [];
  const maxFiles = options.maxFiles ?? 2000;
  const maxFileBytes = options.maxFileBytes ?? 512_000;
  const projectIgnores = options.ignorePatterns ?? [];

  async function walk(directory: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      if (files.length >= maxFiles) continue;
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(rootPath, absolutePath).replaceAll('\\', '/');
      if (
        DEFAULT_IGNORES.has(entry.name) ||
        SECRET_NAMES.has(entry.name) ||
        matchesIgnore(relativePath, entry.name, projectIgnores)
      )
        continue;
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
