import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ModelManager } from '../src/modelManager.js';
import { discoverModels } from '../src/modelDiscovery.js';
import { isPathInsideWorkspace, validateToolCall } from '../src/permissions.js';
import { createTask, transitionTask } from '../src/taskRunner.js';
import { readWorkspaceFile, runApprovedTerminal } from '../src/tools.js';
import { buildWorkspaceContext } from '../src/workspace.js';

test('discovers and sorts GGUF models while ignoring other files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-models-'));
  await writeFile(join(root, 'Qwen.gguf'), 'model');
  await writeFile(join(root, 'Llama.gguf'), 'model');
  await writeFile(join(root, 'notes.txt'), 'ignore');
  const models = await discoverModels(root);
  assert.deepEqual(
    models.map((model) => model.name),
    ['Llama', 'Qwen'],
  );
  assert.equal(models[0]?.format, 'gguf');
});

test('builds an ignore-aware workspace context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-workspace-'));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42;');
  await writeFile(join(root, '.env'), 'SECRET=do-not-index');
  await writeFile(join(root, 'node_modules', 'ignored.js'), 'ignored');
  const context = await buildWorkspaceContext(root, { instructions: 'Use strict TypeScript.' });
  assert.deepEqual(
    context.files.map((file) => file.relativePath),
    ['src', 'src/main.ts'],
  );
  assert.equal(context.instructions, 'Use strict TypeScript.');
  assert.ok(context.estimatedTokens > 0);
});

test('keeps file access inside the selected workspace', () => {
  assert.equal(isPathInsideWorkspace('/tmp/project', '/tmp/project/src/index.ts'), true);
  assert.equal(isPathInsideWorkspace('/tmp/project', '/tmp/project/../secrets.txt'), false);
  const blocked = validateToolCall(
    {
      id: '1',
      name: 'terminal.run',
      risk: 'mutating',
      summary: 'Remove files',
      command: 'rm -rf .',
      status: 'proposed',
    },
    '/tmp/project',
  );
  assert.equal(blocked.allowed, false);
  const read = validateToolCall(
    {
      id: '2',
      name: 'file.read',
      risk: 'read-only',
      summary: 'Read source',
      command: '/tmp/project/src/index.ts',
      status: 'proposed',
    },
    '/tmp/project',
  );
  assert.equal(read.allowed, true);
});

test('switches models safely and reports runtime health', async () => {
  const events: string[] = [];
  const runtime = {
    async load(model: { name: string }) {
      events.push(`load:${model.name}`);
    },
    async unload() {
      events.push('unload');
    },
    async healthCheck() {
      return { healthy: true, message: 'ready' };
    },
  };
  const manager = new ModelManager(runtime);
  const models = [
    {
      id: 'one.gguf',
      name: 'One',
      path: '/models/one.gguf',
      format: 'gguf' as const,
      sizeBytes: 1,
      modifiedAt: '',
    },
    {
      id: 'two.gguf',
      name: 'Two',
      path: '/models/two.gguf',
      format: 'gguf' as const,
      sizeBytes: 1,
      modifiedAt: '',
    },
  ];
  manager.setAvailable(models);
  await manager.select('one.gguf');
  await manager.select('two.gguf');
  assert.deepEqual(events, ['load:One', 'unload', 'load:Two']);
  assert.equal(manager.getState().loadedId, 'two.gguf');
});

test('reads workspace files and runs only approved terminal calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-tools-'));
  const file = join(root, 'hello.txt');
  await writeFile(file, 'hello');
  assert.equal(await readWorkspaceFile(root, file), 'hello');
  await assert.rejects(() => readWorkspaceFile(root, join(root, '..', 'secret.txt')));
  const result = await runApprovedTerminal(root, {
    id: 'terminal-1',
    name: 'terminal.run',
    risk: 'read-only',
    summary: 'Print working directory',
    command: 'printf ready',
    status: 'proposed',
  });
  assert.equal(result.stdout, 'ready');
  assert.equal(result.exitCode, 0);
});

test('enforces bounded autonomous task transitions', () => {
  let task = createTask('task-1', 'Inspect the project');
  task = transitionTask(task, 'inspect');
  task = transitionTask(task, 'draft');
  task = transitionTask(task, 'validate');
  task = transitionTask(task, 'revise');
  assert.equal(task.attempts, 1);
  assert.throws(() => transitionTask(task, 'complete'));
});
