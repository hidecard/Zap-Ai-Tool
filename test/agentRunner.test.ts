import assert from 'node:assert/strict';
import test from 'node:test';
import type { CompletionOptions, CompletionResult } from '../src/llamaRuntime.js';
import type { WorkspaceContext } from '../src/domain.js';
import type { TerminalResult } from '../src/tools.js';
import { parseAgentAction, runAgentTask, type AgentRunnerOptions } from '../src/agentRunner.js';

const workspace: WorkspaceContext = {
  rootPath: '/tmp/zap-agent-project',
  files: [
    { relativePath: 'src/index.ts', sizeBytes: 30, kind: 'file' },
    { relativePath: 'test/index.test.ts', sizeBytes: 20, kind: 'file' },
  ],
  instructions: 'Use TypeScript.',
  estimatedTokens: 13,
};

function sequence(
  ...contents: string[]
): (prompt: string, options?: CompletionOptions) => Promise<CompletionResult> {
  const responses = [...contents];
  return async () => {
    const content = responses.shift();
    if (content === undefined) throw new Error('No fake model response remains.');
    return { content };
  };
}

function options(
  complete: AgentRunnerOptions['complete'],
  overrides: Partial<AgentRunnerOptions> = {},
): AgentRunnerOptions {
  return {
    workspace,
    instruction: 'Fix the module and add a test.',
    complete,
    readFile: async () => 'export const value = 1;\n',
    readFileIfExists: async () => 'export const value = 1;\n',
    approveTerminal: async () => false,
    runTerminal: async (): Promise<TerminalResult> => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 0,
      timedOut: false,
      cancelled: false,
    }),
    ...overrides,
  };
}

test('parses structured agent actions and rejects unsafe file paths', () => {
  assert.deepEqual(parseAgentAction('{"type":"read_file","path":"src/index.ts"}'), {
    type: 'read_file',
    path: 'src/index.ts',
  });
  assert.equal(parseAgentAction('{"type":"read_file","path":"../secret.txt"}'), undefined);
  assert.equal(parseAgentAction('{"type":"read_file","path":".env"}'), undefined);
  assert.equal(parseAgentAction('{"type":"read_file","path":".aws/credentials"}'), undefined);
  assert.equal(parseAgentAction('{"type":"read_file","path":"keys/server.pem"}'), undefined);
  assert.deepEqual(
    parseAgentAction(
      '```json\n{"type":"run_terminal","summary":"Run tests","command":"npm test"}\n```',
    ),
    { type: 'run_terminal', summary: 'Run tests', command: 'npm test' },
  );
});

test('reads only workspace-relative project files and completes through the local model loop', async () => {
  const prompts: string[] = [];
  const responses = sequence(
    '{"type":"read_file","path":"src/index.ts"}',
    '{"type":"answer","message":"I inspected the source file."}',
  );
  const result = await runAgentTask(
    options(
      async (prompt) => {
        prompts.push(prompt);
        return responses(prompt);
      },
      {
        readFile: async (path, maxBytes) => {
          assert.equal(path, 'src/index.ts');
          assert.equal(maxBytes, 8_000);
          return 'export const value = 1;\n';
        },
      },
    ),
  );
  assert.equal(result.task.status, 'complete');
  assert.equal(result.task.toolCalls.length, 1);
  assert.equal(result.task.toolCalls[0]?.status, 'completed');
  assert.match(prompts[1] ?? '', /export const value = 1/);
  assert.match(prompts[1] ?? '', /untrusted data/);
  assert.deepEqual(result.diffs, []);
});

test('shows each generated terminal command for approval before executing it', async () => {
  let approvedCount = 0;
  let executedCount = 0;
  let sawApprovedStatus = false;
  const result = await runAgentTask(
    options(
      sequence(
        '{"type":"run_terminal","summary":"Run the test suite","command":"npm test"}',
        '{"type":"answer","message":"The test command completed successfully."}',
      ),
      {
        approveTerminal: async (call) => {
          approvedCount += 1;
          assert.equal(call.command, 'npm test');
          assert.equal(call.status, 'proposed');
          return true;
        },
        runTerminal: async (call) => {
          executedCount += 1;
          sawApprovedStatus = call.status === 'approved';
          return {
            stdout: 'all tests passed',
            stderr: '',
            exitCode: 0,
            durationMs: 10,
            timedOut: false,
            cancelled: false,
          };
        },
      },
    ),
  );
  assert.equal(approvedCount, 1);
  assert.equal(executedCount, 1);
  assert.equal(sawApprovedStatus, true);
  assert.equal(result.task.toolCalls[0]?.status, 'completed');
  assert.equal(result.task.status, 'complete');
  assert.match(result.events[0] ?? '', /Command: npm test/);
  assert.match(result.events[0] ?? '', /all tests passed/);
});

test('never executes a command rejected by the user', async () => {
  let executedCount = 0;
  const result = await runAgentTask(
    options(
      sequence(
        '{"type":"run_terminal","summary":"Run the test suite","command":"npm test"}',
        '{"type":"answer","message":"I will proceed without running that command."}',
      ),
      {
        approveTerminal: async () => false,
        runTerminal: async () => {
          executedCount += 1;
          throw new Error('Must not run a rejected command.');
        },
      },
    ),
  );
  assert.equal(executedCount, 0);
  assert.equal(result.task.toolCalls[0]?.status, 'rejected');
  assert.equal(result.task.status, 'complete');
  assert.match(result.events[0] ?? '', /User rejected terminal command/);
});

test('blocks destructive command patterns without showing an approval prompt', async () => {
  let approvalCount = 0;
  let executedCount = 0;
  const result = await runAgentTask(
    options(
      sequence(
        '{"type":"run_terminal","summary":"Clean generated files","command":"rm -rf output"}',
        '{"type":"answer","message":"I did not run the blocked command."}',
      ),
      {
        approveTerminal: async () => {
          approvalCount += 1;
          return true;
        },
        runTerminal: async () => {
          executedCount += 1;
          throw new Error('Blocked command must not execute.');
        },
      },
    ),
  );
  assert.equal(approvalCount, 0);
  assert.equal(executedCount, 0);
  assert.equal(result.task.toolCalls[0]?.status, 'failed');
  assert.match(result.events[0] ?? '', /blocked/);
});

test('returns validated file proposals for the existing human review flow without writing files', async () => {
  let fileWasWritten = false;
  const proposal = JSON.stringify({
    type: 'propose_changes',
    diffs: [
      {
        path: 'src/index.ts',
        isNew: false,
        before: 'export const value = 1;\n',
        after: 'export const value = 2;\n',
      },
      { path: 'test/index.test.ts', isNew: true, before: '', after: 'test("value", () => {});\n' },
    ],
  });
  const result = await runAgentTask(
    options(sequence(proposal), {
      readFileIfExists: async (path) =>
        path === 'src/index.ts' ? 'export const value = 1;\n' : null,
      runTerminal: async () => {
        fileWasWritten = true;
        throw new Error('The agent runner must not write files.');
      },
    }),
  );
  assert.equal(result.task.status, 'complete');
  assert.equal(result.diffs.length, 2);
  assert.equal(result.diffs[1]?.isNew, true);
  assert.equal(fileWasWritten, false);
  assert.match(result.message, /No files have been changed/);
});

test('self-corrects a stale proposal within the bounded retry count', async () => {
  const proposal = JSON.stringify({
    type: 'propose_changes',
    diffs: [{ path: 'src/index.ts', isNew: false, before: 'stale content', after: 'new content' }],
  });
  const prompts: string[] = [];
  const result = await runAgentTask(
    options(async (prompt) => {
      prompts.push(prompt);
      if (prompts.length === 1) return { content: proposal };
      return { content: '{"type":"answer","message":"I found the draft was stale."}' };
    }),
  );
  assert.equal(result.task.status, 'complete');
  assert.equal(result.task.attempts, 1);
  assert.match(prompts[1] ?? '', /before-content does not match/);
  assert.deepEqual(result.diffs, []);
});

test('stops malformed model actions after the bounded correction budget', async () => {
  let calls = 0;
  const result = await runAgentTask(
    options(async () => {
      calls += 1;
      return { content: 'not structured output' };
    }),
  );
  assert.equal(calls, 4);
  assert.equal(result.task.status, 'failed');
  assert.match(result.message, /invalid actions/);
});
