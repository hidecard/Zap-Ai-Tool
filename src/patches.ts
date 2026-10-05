import { access, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import type { FileDiff } from './domain.js';
import { isPathInsideWorkspace } from './permissions.js';
import { isProjectConfigPath, isProtectedWorkspacePath } from './pathSafety.js';
import { decodeText, detectTextEncoding, encodeText, type TextEncoding } from './textEncoding.js';

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
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, filePath);
  const relativePath = relative(root, absolute);
  const portablePath = relativePath.replaceAll('\\', '/');
  if (!isPathInsideWorkspace(root, absolute) || isProtectedWorkspacePath(portablePath)) {
    throw new Error(`Patch path is unsafe or outside the selected workspace: ${filePath}`);
  }
  if (isProjectConfigPath(portablePath))
    throw new Error(
      `Project instruction files are human-owned and cannot be patched: ${portablePath}. Edit them in Settings.`,
    );
  return portablePath;
}

function safeBackupDirectory(workspaceRoot: string, backupId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(backupId) || backupId === '.' || backupId === '..')
    throw new Error('Invalid backup identifier.');
  return join(backupRoot(workspaceRoot), backupId);
}

async function assertSafeBackupRoot(workspaceRoot: string): Promise<void> {
  const path = backupRoot(workspaceRoot);
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw new Error('The workspace backup path must be a regular directory.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

async function assertNoSymlinkAncestors(
  workspaceRoot: string,
  relativePath: string,
): Promise<void> {
  let current = resolve(workspaceRoot);
  const segments = relativePath.replaceAll('\\', '/').split('/');
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink())
        throw new Error(`Symlink parent directories are not supported: ${current}`);
      if (!metadata.isDirectory()) throw new Error(`Patch parent is not a directory: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

async function assertRegularFile(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`Symlink paths are not supported: ${path}`);
    if (!metadata.isFile()) throw new Error(`Patch target is not a regular file: ${path}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function applyFileDiffs(
  workspaceRoot: string,
  diffs: FileDiff[],
  backupId = `backup-${Date.now()}-${randomUUID()}`,
): Promise<PatchApplyResult> {
  if (diffs.length === 0) throw new Error('At least one file diff is required.');
  const backupDirectory = safeBackupDirectory(workspaceRoot, backupId);
  const manifest: BackupManifest = { backupId, createdAt: new Date().toISOString(), files: [] };
  const targets = new Set<string>();
  const targetEncodings = new Map<string, TextEncoding>();
  await assertSafeBackupRoot(workspaceRoot);
  await mkdir(backupRoot(workspaceRoot), { recursive: true });
  await mkdir(backupDirectory);
  try {
    // Preflight every target before changing any file. This prevents a later
    // conflict from leaving an earlier approved change behind.
    for (const diff of diffs) {
      const relativePath = safeRelativePath(workspaceRoot, diff.path);
      const targetKey = relativePath.toLowerCase();
      if (targets.has(targetKey)) throw new Error(`Duplicate patch path: ${relativePath}`);
      targets.add(targetKey);
      const target = join(workspaceRoot, relativePath);
      await assertNoSymlinkAncestors(workspaceRoot, relativePath);
      await assertRegularFile(target);
      let existed = true;
      try {
        await access(target);
      } catch {
        existed = false;
      }
      if (diff.isNew === true && existed)
        throw new Error(`Patch conflict: ${relativePath} must not already exist.`);
      if (diff.isNew === false && !existed)
        throw new Error(`Patch conflict: ${relativePath} must already exist.`);
      if (existed) {
        const current = await readFile(target);
        if (decodeText(current) !== diff.before)
          throw new Error(`Patch conflict: ${relativePath} changed since the draft was created.`);
        targetEncodings.set(relativePath, detectTextEncoding(current));
      } else if (diff.before !== '') {
        throw new Error(`Patch conflict: ${relativePath} does not exist as expected.`);
      }
      manifest.files.push({ path: relativePath, existed });
    }

    for (const entry of manifest.files) {
      if (!entry.existed) continue;
      const target = join(workspaceRoot, entry.path);
      const backupPath = join(backupDirectory, entry.path);
      await mkdir(dirname(backupPath), { recursive: true });
      await copyFile(target, backupPath);
    }
    await writeFile(
      join(backupDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8',
    );

    for (const diff of diffs) {
      const target = join(workspaceRoot, safeRelativePath(workspaceRoot, diff.path));
      const temporaryPath = `${target}.zap-tmp-${process.pid}-${Date.now()}`;
      await mkdir(dirname(target), { recursive: true });
      const encoding = targetEncodings.get(safeRelativePath(workspaceRoot, diff.path)) ?? 'utf8';
      await writeFile(temporaryPath, encodeText(diff.after, encoding));
      await rename(temporaryPath, target);
    }
    return { backupId, changedFiles: manifest.files.map((file) => file.path) };
  } catch (error) {
    await rollbackFileDiffs(workspaceRoot, backupId).catch(() => undefined);
    throw error;
  }
}

export const MAX_EDITABLE_FILE_BYTES = 2_000_000;

/**
 * Writes a human-edited buffer to disk through the same preflight, backup and
 * rollback boundary as agent proposals. Returns the backup id so the edit can
 * be undone like any other reviewed change.
 */
export async function writeWorkspaceFile(
  workspaceRoot: string,
  filePath: string,
  content: string,
): Promise<PatchApplyResult> {
  if (typeof content !== 'string') throw new Error('File content must be a string.');
  if (Buffer.byteLength(content, 'utf8') > MAX_EDITABLE_FILE_BYTES)
    throw new Error(`Refusing to write more than ${MAX_EDITABLE_FILE_BYTES} bytes.`);
  const relativePath = safeRelativePath(workspaceRoot, filePath);
  const target = join(workspaceRoot, relativePath);
  await assertNoSymlinkAncestors(workspaceRoot, relativePath);
  await assertRegularFile(target);
  let existed = true;
  let before = '';
  try {
    before = decodeText(await readFile(target));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    existed = false;
  }
  if (existed && before === content) throw new Error('The file already has this content.');
  return await applyFileDiffs(workspaceRoot, [
    { path: relativePath, before, after: content, isNew: !existed },
  ]);
}

export async function rollbackFileDiffs(
  workspaceRoot: string,
  backupId: string,
): Promise<string[]> {
  const backupDirectory = safeBackupDirectory(workspaceRoot, backupId);
  await assertSafeBackupRoot(workspaceRoot);
  const manifest = JSON.parse(
    await readFile(join(backupDirectory, 'manifest.json'), 'utf8'),
  ) as BackupManifest;
  const restored: string[] = [];
  for (const entry of manifest.files) {
    const relativePath = safeRelativePath(workspaceRoot, entry.path);
    await assertNoSymlinkAncestors(workspaceRoot, relativePath);
    const target = join(workspaceRoot, relativePath);
    await assertRegularFile(target);
    if (entry.existed) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(backupDirectory, relativePath), target);
    } else {
      await rm(target, { force: true });
    }
    restored.push(entry.path);
  }
  return restored;
}
