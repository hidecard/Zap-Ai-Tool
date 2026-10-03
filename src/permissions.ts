import { isAbsolute, resolve, relative } from 'node:path';
import type { ToolCall } from './domain.js';

const BLOCKED_COMMANDS = [/\brm\s+-rf\b/i, /\bsudo\b/i, /\bcurl\b.*\|/i, /\bwget\b.*\|/i];

export function isPathInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const root = resolve(workspaceRoot);
  const candidate = resolve(candidatePath);
  const distance = relative(root, candidate);
  return distance === '' || (!distance.startsWith('..') && !isAbsolute(distance));
}

export function validateToolCall(
  call: ToolCall,
  workspaceRoot: string,
): { allowed: boolean; reason?: string } {
  const command = call.command;
  if (call.name === 'file.read' && command && !isPathInsideWorkspace(workspaceRoot, command)) {
    return { allowed: false, reason: 'File reads must stay inside the selected workspace.' };
  }
  if (
    call.name === 'terminal.run' &&
    command &&
    BLOCKED_COMMANDS.some((pattern) => pattern.test(command))
  ) {
    return { allowed: false, reason: 'This command matches a blocked safety pattern.' };
  }
  if (call.risk !== 'read-only' && call.status !== 'approved') {
    return { allowed: false, reason: 'Mutating or network tools require explicit approval.' };
  }
  return { allowed: true };
}
