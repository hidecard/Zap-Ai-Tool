import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverModels } from '../src/modelDiscovery.js';
import { isPathInsideWorkspace, validateToolCall } from '../src/permissions.js';
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
  const paths = context.files.map((file) => file.relativePath);
  assert.deepEqual(paths, ['src', 'src/main.ts']);
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
