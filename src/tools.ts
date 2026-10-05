import { readFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { isPathInsideWorkspace, validateToolCall } from './permissions.js';
import { isProtectedWorkspacePath } from './pathSafety.js';
import type { ToolCall } from './domain.js';

export async function readWorkspaceFile(
  workspaceRoot: string,
  filePath: string,
  maxBytes = 512_000,
): Promise<string> {
  const absolutePath = resolve(workspaceRoot, filePath);
  const requestedRelative = relative(resolve(workspaceRoot), absolutePath);
  if (
    !isPathInsideWorkspace(workspaceRoot, absolutePath) ||
    isProtectedWorkspacePath(requestedRelative)
  )
    throw new Error('File reads are blocked outside the workspace or for protected paths.');
  const [realWorkspaceRoot, realFilePath] = await Promise.all([
    realpath(workspaceRoot),
    realpath(absolutePath),
  ]);
  if (!isPathInsideWorkspace(realWorkspaceRoot, realFilePath))
    throw new Error('File reads must stay inside the selected workspace.');
  if (isProtectedWorkspacePath(relative(realWorkspaceRoot, realFilePath)))
    throw new Error('File reads are blocked for protected paths.');
  const content = await readFile(realFilePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > maxBytes)
    throw new Error(`File exceeds the ${maxBytes}-byte read limit.`);
  return content;
}

export async function readWorkspaceFileIfExists(
  workspaceRoot: string,
  filePath: string,
  maxBytes = 512_000,
): Promise<string | null> {
  try {
    return await readWorkspaceFile(workspaceRoot, filePath, maxBytes);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return null;
    throw error;
  }
}

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

export async function runApprovedTerminal(
  workspaceRoot: string,
  call: ToolCall,
  options: { timeoutMs?: number; signal?: AbortSignal; maxOutputBytes?: number } = {},
): Promise<TerminalResult> {
  const command = call.command;
  if (call.name !== 'terminal.run' || !command) throw new Error('A terminal command is required.');
  const validation = validateToolCall(call, workspaceRoot);
  if (!validation.allowed) throw new Error(validation.reason ?? 'Tool call is not allowed.');
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxOutputBytes = options.maxOutputBytes ?? 1_000_000;
  return await new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const child = spawn(
      isWindows ? (process.env.ComSpec ?? 'cmd.exe') : 'sh',
      isWindows ? ['/d', '/s', '/c', command] : ['-c', command],
      {
        cwd: workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const terminate = (reason: 'timeout' | 'cancel'): void => {
      if (reason === 'timeout') timedOut = true;
      else cancelled = true;
      child.kill('SIGTERM');
    };
    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    const abort = (): void => terminate('cancel');
    options.signal?.addEventListener('abort', abort, { once: true });
    const append = (current: string, chunk: Buffer): string => {
      const remaining = maxOutputBytes - Buffer.byteLength(current, 'utf8');
      return remaining <= 0 ? current : current + chunk.toString('utf8').slice(0, remaining);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (exitCode: number | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (!settled) {
        settled = true;
        resolve({
          stdout,
          stderr,
          exitCode,
          durationMs: Date.now() - started,
          timedOut,
          cancelled,
        });
      }
    });
  });
}
