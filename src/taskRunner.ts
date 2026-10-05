import type { AgentTask, TaskStatus } from './domain.js';

const ALLOWED: Record<TaskStatus, readonly TaskStatus[]> = {
  plan: ['inspect', 'failed'],
  inspect: ['revise', 'draft', 'failed'],
  draft: ['validate', 'failed'],
  validate: ['revise', 'complete', 'failed'],
  revise: ['inspect', 'draft', 'failed'],
  complete: [],
  failed: [],
};

export function transitionTask(task: AgentTask, next: TaskStatus, maxAttempts = 3): AgentTask {
  if (!ALLOWED[task.status].includes(next))
    throw new Error(`Invalid task transition: ${task.status} → ${next}`);
  const attempts = next === 'revise' ? task.attempts + 1 : task.attempts;
  if (attempts > maxAttempts) return { ...task, status: 'failed', attempts };
  return { ...task, status: next, attempts };
}

export function createTask(id: string, instruction: string): AgentTask {
  return { id, instruction, status: 'plan', attempts: 0, toolCalls: [], diffs: [] };
}
