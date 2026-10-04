import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { test } from 'node:test';
import { LlamaServerRuntime } from '../src/llamaRuntime.js';

const executablePath = process.env.LLAMA_SERVER_PATH;
const modelPath = process.env.GGUF_MODEL_PATH;
const enabled = Boolean(executablePath && modelPath);

test('runs a real llama.cpp GGUF completion smoke test', { skip: !enabled }, async () => {
  assert.ok(executablePath);
  assert.ok(modelPath);
  const metadata = await stat(modelPath);
  const runtime = new LlamaServerRuntime({
    executablePath,
    port: Number(process.env.LLAMA_TEST_PORT ?? 18092),
    contextSize: Number(process.env.LLAMA_CONTEXT_SIZE ?? 512),
    startupTimeoutMs: 120_000,
    requestTimeoutMs: 60_000,
  });
  try {
    await runtime.load({
      id: basename(modelPath),
      name: basename(modelPath, '.gguf'),
      path: modelPath,
      format: 'gguf',
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    });
    assert.deepEqual(await runtime.healthCheck(), {
      healthy: true,
      message: 'llama-server is ready.',
    });
    const result = await runtime.complete('Reply with exactly one short greeting.', {
      maxTokens: 8,
      temperature: 0,
    });
    assert.equal(typeof result.content, 'string');
    assert.ok(result.content.length > 0);
  } finally {
    await runtime.unload();
  }
});
