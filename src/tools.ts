import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { isPathInsideWorkspace, validateToolCall } from './permissions.js';
import type { ToolCall } from './domain.js';

export async function readWorkspaceFile(
  workspaceRoot: string,
  filePath: string,
  maxBytes = 512_000,
): Promise<string> {
  if (!isPathInsideWorkspace(workspaceRoot, filePath))
    throw new Error('File reads must stay inside the selected workspace.');
  const content = await readFile(filePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > maxBytes)
    throw new Error(`File exceeds the ${maxBytes}-byte read limit.`);
  return content;
}

export interface TerminalResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
}

export async function runApprovedTerminal(
  workspaceRoot: string,
  call: ToolCall,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<TerminalResult> {
  const command = call.command;
  if (call.name !== 'terminal.run' || !command) throw new Error('A terminal command is required.');
  const validation = validateToolCall(call, workspaceRoot);
  if (!validation.allowed) throw new Error(validation.reason ?? 'Tool call is not allowed.');

  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 30_000;
  return await new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: TerminalResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    const abort = (): void => {
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on('close', (exitCode: number | null) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      finish({ stdout, stderr, exitCode, durationMs: Date.now() - started });
    });
  });
}
