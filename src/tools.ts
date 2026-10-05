import { readFile, realpath } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { evaluateTerminalCommand, isPathInsideWorkspace } from './permissions.js';
import { isProtectedWorkspacePath } from './pathSafety.js';
import { decodeConsoleOutput, decodeText } from './textEncoding.js';
import type { TerminalPolicy } from './settings.js';
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
  const content = decodeText(await readFile(realFilePath));
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

/**
 * Variables kept for child processes. Everything else, including tokens and
 * agent credentials from the parent environment, is withheld from commands.
 */
const SANDBOX_KEEP = [
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'TMPDIR',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
  'LANG',
  'LC_ALL',
  'TZ',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'SSH_AUTH_SOCK',
  'DISPLAY',
  'XDG_RUNTIME_DIR',
  'COLORTERM',
];

export function buildSandboxEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SANDBOX_KEEP) {
    const value = base[key];
    if (typeof value === 'string') environment[key] = value;
  }
  environment.ZAP_SANDBOX = '1';
  environment.NO_COLOR = '1';
  return environment;
}

export interface TerminalRunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  policy?: TerminalPolicy;
  env?: NodeJS.ProcessEnv;
}

export async function runApprovedTerminal(
  workspaceRoot: string,
  call: ToolCall,
  options: TerminalRunOptions = {},
): Promise<TerminalResult> {
  const command = call.command;
  if (call.name !== 'terminal.run' || !command) throw new Error('A terminal command is required.');
  const decision = evaluateTerminalCommand(call, workspaceRoot, options.policy);
  if (!decision.allowed) throw new Error(decision.reason ?? 'Tool call is not allowed.');
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
        env: options.env ?? buildSandboxEnvironment(),
      },
    );
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
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
    const collect = (chunks: Buffer[], used: number, chunk: Buffer): number => {
      if (used >= maxOutputBytes) return used;
      const remaining = maxOutputBytes - used;
      chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
      return used + Math.min(chunk.length, remaining);
    };
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes = collect(stdoutChunks, stdoutBytes, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes = collect(stderrChunks, stderrBytes, chunk);
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
          stdout: decodeConsoleOutput(Buffer.concat(stdoutChunks)),
          stderr: decodeConsoleOutput(Buffer.concat(stderrChunks)),
          exitCode,
          durationMs: Date.now() - started,
          timedOut,
          cancelled,
        });
      }
    });
  });
}
