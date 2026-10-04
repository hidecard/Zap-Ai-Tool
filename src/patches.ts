import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { FileDiff } from './domain.js';
import { isPathInsideWorkspace } from './permissions.js';

export interface PatchApplyResult {
  backupId: string;
  changedFiles: string[];
}

type BackupEntry = { path: string; existed: boolean };
type BackupManifest = { backupId: string; createdAt: string; files: BackupEntry[] };

function backupRoot(workspaceRoot: string): string {
  return join(workspaceRoot, '.zap-backups');
}

function safeRelativePath(workspaceRoot: string, filePath: string): string {
  const absolute = resolve(workspaceRoot, filePath);
  if (
    !isPathInsideWorkspace(workspaceRoot, absolute) ||
    absolute.includes(`${resolve(workspaceRoot)}/.zap-backups/`)
  ) {
    throw new Error(`Patch path is outside the selected workspace: ${filePath}`);
  }
  return relative(workspaceRoot, absolute);
}

export async function applyFileDiffs(
  workspaceRoot: string,
  diffs: FileDiff[],
  backupId = `backup-${Date.now()}`,
): Promise<PatchApplyResult> {
  if (diffs.length === 0) throw new Error('At least one file diff is required.');
  const backupDirectory = join(backupRoot(workspaceRoot), backupId);
  const manifest: BackupManifest = { backupId, createdAt: new Date().toISOString(), files: [] };
  await mkdir(backupDirectory, { recursive: true });
  try {
    for (const diff of diffs) {
      const relativePath = safeRelativePath(workspaceRoot, diff.path);
      const target = join(workspaceRoot, relativePath);
      const backupPath = join(backupDirectory, relativePath);
      let existed = true;
      try {
        await access(target);
      } catch {
        existed = false;
      }
      if (existed) {
        const current = await readFile(target, 'utf8');
        if (current !== diff.before) {
          throw new Error(`Patch conflict: ${relativePath} changed since the draft was created.`);
        }
      } else if (diff.before !== '') {
        throw new Error(`Patch conflict: ${relativePath} does not exist as expected.`);
      }
      manifest.files.push({ path: relativePath, existed });
      if (existed) {
        await mkdir(dirname(backupPath), { recursive: true });
        await copyFile(target, backupPath);
      }
      const temporaryPath = `${target}.zap-tmp-${process.pid}-${Date.now()}`;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporaryPath, diff.after, 'utf8');
      await rename(temporaryPath, target);
    }
    await writeFile(
      join(backupDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );
    return { backupId, changedFiles: manifest.files.map((file) => file.path) };
  } catch (error) {
    await rollbackFileDiffs(workspaceRoot, backupId).catch(() => undefined);
    throw error;
  }
}

export async function rollbackFileDiffs(
  workspaceRoot: string,
  backupId: string,
): Promise<string[]> {
  const backupDirectory = join(backupRoot(workspaceRoot), backupId);
  const manifest = JSON.parse(
    await readFile(join(backupDirectory, 'manifest.json'), 'utf8'),
  ) as BackupManifest;
  const restored: string[] = [];
  for (const entry of manifest.files) {
    const target = join(workspaceRoot, entry.path);
    if (entry.existed) {
      await copyFile(join(backupDirectory, entry.path), target);
    } else {
      await rm(target, { force: true });
    }
    restored.push(entry.path);
  }
  return restored;
}
