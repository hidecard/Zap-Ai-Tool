import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ModelManager } from '../src/modelManager.js';
import { discoverModels } from '../src/modelDiscovery.js';
import { isPathInsideWorkspace, validateToolCall } from '../src/permissions.js';
import { createTask, transitionTask } from '../src/taskRunner.js';
import { readWorkspaceFile, runApprovedTerminal } from '../src/tools.js';
import { buildWorkspaceContext } from '../src/workspace.js';
import { applyFileDiffs, rollbackFileDiffs } from '../src/patches.js';
import { createFileReviews, selectReviewedDiffs } from '../src/review.js';
import { LlamaServerRuntime } from '../src/llamaRuntime.js';

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

test('loads project instructions and configurable ignore patterns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-config-'));
  await mkdir(join(root, 'notes'));
  await writeFile(join(root, 'ZAP.md'), 'Prefer small safe changes.');
  await writeFile(join(root, '.zapignore'), 'notes\nlocal.txt\n');
  await writeFile(join(root, 'notes', 'private.md'), 'ignore');
  await writeFile(join(root, 'local.txt'), 'ignore');
  await writeFile(join(root, 'main.ts'), 'export {};');
  const { loadWorkspaceOptions } = await import('../src/workspace.js');
  const context = await buildWorkspaceContext(root, await loadWorkspaceOptions(root));
  assert.equal(context.instructions, 'Prefer small safe changes.');
  assert.deepEqual(
    context.files.map((file) => file.relativePath),
    ['.zapignore', 'ZAP.md', 'main.ts'],
  );
});

test('applies diffs with a backup and restores them on rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-patches-'));
  const file = join(root, 'app.ts');
  await writeFile(file, 'const value = 1;\n');
  const result = await applyFileDiffs(
    root,
    [{ path: 'app.ts', before: 'const value = 1;\n', after: 'const value = 2;\n' }],
    'test-backup',
  );
  assert.equal(await readFile(file, 'utf8'), 'const value = 2;\n');
  assert.deepEqual(result.changedFiles, ['app.ts']);
  await rollbackFileDiffs(root, result.backupId);
  assert.equal(await readFile(file, 'utf8'), 'const value = 1;\n');
});

test('blocks a stale patch when the current file differs from the draft', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-conflict-'));
  const file = join(root, 'app.ts');
  await writeFile(file, 'const value = 3;\n');
  await assert.rejects(
    () =>
      applyFileDiffs(root, [
        { path: 'app.ts', before: 'const value = 1;\n', after: 'const value = 2;\n' },
      ]),
    /Patch conflict/,
  );
  assert.equal(await readFile(file, 'utf8'), 'const value = 3;\n');
});

test('rolls back every file if a later patch fails preflight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-atomic-'));
  await writeFile(join(root, 'first.txt'), 'one');
  await writeFile(join(root, 'second.txt'), 'changed');
  await assert.rejects(
    () =>
      applyFileDiffs(root, [
        { path: 'first.txt', before: 'one', after: 'updated' },
        { path: 'second.txt', before: 'original', after: 'updated' },
      ]),
    /Patch conflict/,
  );
  assert.equal(await readFile(join(root, 'first.txt'), 'utf8'), 'one');
});

test('rejects symlink patch targets and supports hunk review selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-review-'));
  const outside = await mkdtemp(join(tmpdir(), 'zap-outside-'));
  await writeFile(join(outside, 'secret.txt'), 'secret');
  await symlink(join(outside, 'secret.txt'), join(root, 'linked.txt'));
  await assert.rejects(
    () => applyFileDiffs(root, [{ path: 'linked.txt', before: 'secret', after: 'leak' }]),
    /Symlink/,
  );
  const reviews = createFileReviews([{ path: 'app.ts', before: 'a\nb\nc', after: 'a\nB\nc\nd' }]);
  assert.equal(reviews[0]?.hunks.length, 1);
  assert.deepEqual(selectReviewedDiffs(reviews, [{ path: 'app.ts', selected: false }]), []);
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
  assert.equal(result.timedOut, false);
  assert.equal(result.cancelled, false);
});

test('connects to a llama-server-compatible runtime process', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-llama-runtime-'));
  const fakeServer = join(root, 'fake-llama-server.sh');
  const fakeNode = join(root, 'fake-llama-server.mjs');
  await writeFile(
    fakeNode,
    `import http from 'node:http';
const server = http.createServer((request, response) => {
  if (request.url === '/health') { response.writeHead(200, {'content-type': 'application/json'}); response.end('{"status":"ok"}'); return; }
  if (request.url === '/completion') { response.setHeader('content-type', 'application/json'); let body = ''; request.on('data', chunk => body += chunk); request.on('end', () => response.end(JSON.stringify({content: ' fake completion', tokens_predicted: 2, timings: {predicted_ms: 1}}))); return; }
  response.writeHead(404); response.end();
});
const portIndex = process.argv.indexOf('--port');
server.listen(Number(process.argv[portIndex + 1]), '127.0.0.1');
`,
  );
  await writeFile(fakeServer, `#!/bin/sh\nexec node ${JSON.stringify(fakeNode)} "$@"\n`);
  await chmod(fakeServer, 0o755);
  const port = 18_090 + Math.floor(Math.random() * 100);
  const runtime = new LlamaServerRuntime({
    executablePath: fakeServer,
    port,
    startupTimeoutMs: 2_000,
  });
  await runtime.load({
    id: 'fixture.gguf',
    name: 'Fixture',
    path: join(root, 'fixture.gguf'),
    format: 'gguf',
    sizeBytes: 1,
    modifiedAt: '',
  });
  assert.deepEqual(await runtime.healthCheck(), {
    healthy: true,
    message: 'llama-server is ready.',
  });
  assert.equal((await runtime.complete('hello')).content, ' fake completion');
  await runtime.unload();
});

test('reports terminal cancellation and timeout instead of hanging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-cancel-'));
  const controller = new AbortController();
  const cancelled = runApprovedTerminal(
    root,
    {
      id: 'terminal-cancel',
      name: 'terminal.run',
      risk: 'read-only',
      summary: 'sleep',
      command: 'sleep 1',
      status: 'proposed',
    },
    { signal: controller.signal, timeoutMs: 5_000 },
  );
  controller.abort();
  assert.equal((await cancelled).cancelled, true);
  const timedOut = await runApprovedTerminal(
    root,
    {
      id: 'terminal-timeout',
      name: 'terminal.run',
      risk: 'read-only',
      summary: 'sleep',
      command: 'sleep 1',
      status: 'proposed',
    },
    { timeoutMs: 10 },
  );
  assert.equal(timedOut.timedOut, true);
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
