import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { WorkspaceContext, WorkspaceFile } from './domain.js';
import { isProtectedWorkspacePath } from './pathSafety.js';

const DEFAULT_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.DS_Store']);

export interface WorkspaceOptions {
  instructions?: string;
  ignorePatterns?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface WorkspaceConfig {
  instructions: string;
  ignorePatterns: string[];
}

/** Reads the optional ZAP.md project instructions and .zapignore patterns. */
export async function readWorkspaceConfig(rootPath: string): Promise<WorkspaceConfig> {
  const config: WorkspaceConfig = { instructions: '', ignorePatterns: [] };
  try {
    const instructions = await readFile(join(rootPath, 'ZAP.md'), 'utf8');
    if (instructions.trim()) config.instructions = instructions.trim();
  } catch {
    // Project instructions are optional.
  }
  try {
    const raw = await readFile(join(rootPath, '.zapignore'), 'utf8');
    config.ignorePatterns = parseIgnorePatterns(raw);
  } catch {
    // Project ignore patterns are optional.
  }
  return config;
}

/** Persists project instructions and ignore patterns back into the workspace. */
export async function saveWorkspaceConfig(
  rootPath: string,
  config: WorkspaceConfig,
): Promise<WorkspaceConfig> {
  const instructions = config.instructions.trim();
  const patterns = config.ignorePatterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0 && !pattern.startsWith('#'))
    .slice(0, 200);
  if (instructions) await writeFile(join(rootPath, 'ZAP.md'), `${instructions}\n`, 'utf8');
  else await rm(join(rootPath, 'ZAP.md'), { force: true });
  if (patterns.length > 0)
    await writeFile(
      join(rootPath, '.zapignore'),
      `# Zap ignore patterns\n${patterns.join('\n')}\n`,
      'utf8',
    );
  else await rm(join(rootPath, '.zapignore'), { force: true });
  return { instructions, ignorePatterns: patterns };
}

function parseIgnorePatterns(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export async function loadWorkspaceOptions(rootPath: string): Promise<WorkspaceOptions> {
  const config = await readWorkspaceConfig(rootPath);
  const options: WorkspaceOptions = {};
  if (config.instructions) options.instructions = config.instructions;
  if (config.ignorePatterns.length > 0) options.ignorePatterns = config.ignorePatterns;
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
        isProtectedWorkspacePath(relativePath) ||
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
