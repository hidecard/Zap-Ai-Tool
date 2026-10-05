import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolCall } from './domain.js';
import type { TerminalPolicy } from './settings.js';

const BLOCKED_COMMANDS = [
  /\brm\s+(?:-[^\s]*r[^\s]*\s+|--recursive\s+).*/i,
  /\bsudo\b/i,
  /\b(?:curl|wget)\b[^\n]*\|/i,
  /(?:^|[;&|])\s*(?:chmod|chown)\b/i,
  />\s*\/etc\//i,
];

export function isPathInsideWorkspace(workspaceRoot: string, candidatePath: string): boolean {
  const root = resolve(workspaceRoot);
  const candidate = resolve(candidatePath);
  const distance = relative(root, candidate);
  return distance === '' || (!distance.startsWith('..') && !isAbsolute(distance));
}

/**
 * Allow-list matching is prefix based on command words: the entry `npm test`
 * allows `npm test` and `npm test --watch`, and the entry `git` allows every
 * `git ...` invocation. Entries never match a command that only contains the
 * text, so `npm` cannot authorize `sudo npm` or `echo npm`.
 */
export function matchesCommandAllowList(command: string, allowList: readonly string[]): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  return allowList.some((entry) => {
    const prefix = entry.trim().replace(/\s+/g, ' ');
    if (!prefix) return false;
    return normalized === prefix || normalized.startsWith(`${prefix} `);
  });
}

export function describeTerminalPolicy(policy: TerminalPolicy | undefined): string {
  if (!policy || policy.mode === 'ask-every-time') return 'every command asks first';
  if (policy.allowList.length === 0) return 'no command is allowed yet';
  return `${policy.allowList.length} allowed command prefix(es)${policy.allowAgentCommands ? ', agent runs them without a prompt' : ''}`;
}

export interface TerminalDecision {
  allowed: boolean;
  reason?: string;
  /** False when policy already authorizes the command without a native prompt. */
  requiresApproval: boolean;
}

export function evaluateTerminalCommand(
  call: ToolCall,
  workspaceRoot: string,
  policy?: TerminalPolicy,
): TerminalDecision {
  const command = call.command;
  if (call.name === 'file.read') {
    if (command && !isPathInsideWorkspace(workspaceRoot, command))
      return {
        allowed: false,
        reason: 'File reads must stay inside the selected workspace.',
        requiresApproval: false,
      };
    return { allowed: true, requiresApproval: false };
  }
  if (!command)
    return { allowed: false, reason: 'A terminal command is required.', requiresApproval: true };
  if (BLOCKED_COMMANDS.some((pattern) => pattern.test(command)))
    return {
      allowed: false,
      reason: 'This command matches a blocked safety pattern.',
      requiresApproval: true,
    };
  if (policy && policy.mode === 'allow-list' && !matchesCommandAllowList(command, policy.allowList))
    return {
      allowed: false,
      reason: `The terminal allow-list does not include this command (${describeTerminalPolicy(policy)}).`,
      requiresApproval: true,
    };
  if (call.risk !== 'read-only' && call.status !== 'approved')
    return {
      allowed: false,
      reason: 'Mutating or network tools require explicit approval.',
      requiresApproval: true,
    };
  const preapproved = policy?.mode === 'allow-list' && policy.allowAgentCommands === true;
  return { allowed: true, requiresApproval: !preapproved };
}

export function validateToolCall(
  call: ToolCall,
  workspaceRoot: string,
): { allowed: boolean; reason?: string } {
  const decision = evaluateTerminalCommand(call, workspaceRoot);
  return decision.allowed
    ? { allowed: true }
    : { allowed: false, ...(decision.reason ? { reason: decision.reason } : {}) };
}
