import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, relative } from 'node:path';
import type { FileDiff } from './domain.js';
import { isProtectedWorkspacePath } from './pathSafety.js';
import { readWorkspaceFileIfExists } from './tools.js';

const run = promisify(execFile);

export type GitChangeStatus =
  'added' | 'deleted' | 'modified' | 'renamed' | 'untracked' | 'conflicted' | 'typechange';

export interface GitStatusEntry {
  /** Path relative to the workspace root. */
  path: string;
  status: GitChangeStatus;
  staged: boolean;
  originalPath?: string;
}

export interface GitSnapshot {
  available: boolean;
  repositoryRoot?: string;
  branch?: string;
  message?: string;
  entries: GitStatusEntry[];
}

export interface GitFileDiff {
  path: string;
  status: GitChangeStatus;
  diff: FileDiff;
}

const GIT_TIMEOUT_MS = 10_000;

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PAGER: 'cat',
  };
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run(
    'git',
    ['-C', cwd, '--no-pager', '-c', 'core.quotepath=false', ...args],
    { env: gitEnv(), timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  return stdout;
}

function mapStatus(code: string): GitChangeStatus {
  if (code === '??') return 'untracked';
  if (code === 'UU' || code === 'AA' || code === 'DD' || code === 'AU' || code === 'UA')
    return 'conflicted';
  if (code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('T')) return 'typechange';
  return 'modified';
}

/**
 * Reads porcelain status for the workspace. Paths outside the workspace are
 * dropped so a parent repository cannot leak unrelated files into the app.
 */
export async function readGitStatus(workspaceRoot: string): Promise<GitSnapshot> {
  let repositoryRoot: string;
  try {
    repositoryRoot = (await git(workspaceRoot, ['rev-parse', '--show-toplevel'])).trim();
  } catch {
    return { available: false, entries: [], message: 'This folder is not a Git repository.' };
  }
  if (!repositoryRoot)
    return { available: false, entries: [], message: 'Git repository not found.' };

  let branch: string | undefined;
  try {
    branch = (await git(workspaceRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  } catch {
    branch = undefined;
  }

  let entries: GitStatusEntry[] = [];
  try {
    const raw = await git(workspaceRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]);
    const fields = raw.split('\0').filter((field) => field.length > 0);
    for (let index = 0; index < fields.length; index += 1) {
      const field = fields[index];
      if (!field || field.length < 3) continue;
      const code = field.slice(0, 2);
      const repoPath = field.slice(3);
      const staged = code[0] !== ' ' && code[0] !== '?';
      const status = mapStatus(code);
      let originalPath: string | undefined;
      let target = repoPath;
      if (status === 'renamed') {
        originalPath = fields[index + 1];
        index += 1;
      }
      const workspacePath = normalizeWorkspacePath(repositoryRoot, workspaceRoot, target);
      if (!workspacePath || isProtectedWorkspacePath(workspacePath)) continue;
      entries.push({
        path: workspacePath,
        status,
        staged,
        ...(originalPath
          ? {
              originalPath:
                normalizeWorkspacePath(repositoryRoot, workspaceRoot, originalPath) ?? originalPath,
            }
          : {}),
      });
    }
  } catch (error) {
    return {
      available: true,
      repositoryRoot,
      ...(branch === undefined ? {} : { branch }),
      entries: [],
      message: `git status failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return {
    available: true,
    repositoryRoot,
    ...(branch === undefined ? {} : { branch }),
    entries,
  };
}

function normalizeWorkspacePath(
  repositoryRoot: string,
  workspaceRoot: string,
  repoPath: string,
): string | undefined {
  const absolute = isAbsolute(repoPath) ? repoPath : join(repositoryRoot, repoPath);
  const relativePath = relative(workspaceRoot, absolute).replaceAll('\\', '/');
  if (!relativePath || relativePath.startsWith('..')) return undefined;
  return relativePath;
}

/**
 * Builds a whole-file diff for one repository path: the committed version from
 * HEAD against the current file on disk. Untracked files report an empty
 * before-content so the normal review flow can create them.
 */
export async function readGitFileDiff(
  workspaceRoot: string,
  workspacePath: string,
): Promise<GitFileDiff | undefined> {
  const status = await readGitStatus(workspaceRoot);
  if (!status.available || !status.repositoryRoot) return undefined;
  const entry = status.entries.find((candidate) => candidate.path === workspacePath);
  if (!entry) return undefined;
  const repoPath = relative(status.repositoryRoot, join(workspaceRoot, workspacePath)).replaceAll(
    '\\',
    '/',
  );
  let before = '';
  if (entry.status !== 'untracked' && entry.status !== 'added') {
    try {
      before = await git(workspaceRoot, ['show', `HEAD:${repoPath}`]);
    } catch {
      before = '';
    }
  }
  const after =
    entry.status === 'deleted' ? '' : await readWorkspaceFileIfExists(workspaceRoot, workspacePath);
  if (after === null) return undefined;
  return {
    path: workspacePath,
    status: entry.status,
    diff: {
      path: workspacePath,
      before,
      after,
      isNew: entry.status === 'untracked' || entry.status === 'added',
    },
  };
}
