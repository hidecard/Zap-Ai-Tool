/**
 * Local performance benchmark for model discovery, workspace context, diffing,
 * and patch round-trips. Run with `npm run benchmark`.
 *
 * Set LLAMA_SERVER_PATH and GGUF_MODEL_PATH to also measure llama-server model
 * load and a real completion.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { diffLines } from '../src/diff.js';
import { describeModel, discoverModels } from '../src/modelDiscovery.js';
import { LlamaServerRuntime } from '../src/llamaRuntime.js';
import { applyFileDiffs, rollbackFileDiffs } from '../src/patches.js';
import { buildWorkspaceContext } from '../src/workspace.js';

interface Measurement {
  name: string;
  ms: number;
  detail: string;
}

async function measure(
  name: string,
  detail: string,
  run: () => Promise<string>,
): Promise<Measurement> {
  const started = performance.now();
  const summary = await run();
  return { name, ms: performance.now() - started, detail: summary || detail };
}

function report(measurements: Measurement[]): void {
  const width = Math.max(...measurements.map((item) => item.name.length));
  for (const item of measurements)
    console.log(`${item.name.padEnd(width)}  ${item.ms.toFixed(1).padStart(9)} ms  ${item.detail}`);
}

async function fixtureProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'zap-benchmark-'));
  const files = 400;
  await Promise.all(
    Array.from({ length: files }, async (_unused, index) => {
      const directory = join(root, `src`, `module-${Math.floor(index / 20)}`);
      await mkdir(directory, { recursive: true });
      const lines = Array.from(
        { length: 60 },
        (_line, line) => `export const value${line} = ${index}_${line};`,
      );
      await writeFile(join(directory, `file-${index}.ts`), `${lines.join('\n')}\n`, 'utf8');
    }),
  );
  return root;
}

async function benchmarkLlama(): Promise<Measurement[]> {
  const executable = process.env.LLAMA_SERVER_PATH;
  const modelPath = process.env.GGUF_MODEL_PATH;
  if (!executable || !modelPath) return [];
  const runtime = new LlamaServerRuntime({
    executablePath: executable,
    ...(process.env.LLAMA_GPU_LAYERS ? { gpuLayers: Number(process.env.LLAMA_GPU_LAYERS) } : {}),
  });
  const model = await describeModel(modelPath);
  const measurements: Measurement[] = [];
  measurements.push(
    await measure('llama load', `${model.name}`, async () => {
      await runtime.load(model);
      return `${model.name} (${(model.sizeBytes / 1024 ** 3).toFixed(2)} GB)`;
    }),
  );
  measurements.push(
    await measure('llama complete', '512 tokens', async () => {
      const result = await runtime.complete('Summarize this file:\n', { maxTokens: 512 });
      return `${result.tokensPredicted ?? 0} tokens predicted`;
    }),
  );
  await runtime.unload();
  return measurements;
}

async function main(): Promise<void> {
  const measurements: Measurement[] = [];
  const modelsDirectory = await mkdtemp(join(tmpdir(), 'zap-benchmark-models-'));
  await writeFile(join(modelsDirectory, 'bench.gguf'), 'not a real model');
  await writeFile(join(modelsDirectory, 'notes.txt'), 'ignored');

  measurements.push(
    await measure('model discovery', 'scan a small model folder', async () => {
      const models = await discoverModels(modelsDirectory);
      return `${models.length} model(s)`;
    }),
  );

  const root = await fixtureProject();
  const fileCount = await readdir(join(root, 'src')).then((entries) => entries.length);
  measurements.push(
    await measure('workspace context', 'index the fixture project', async () => {
      const context = await buildWorkspaceContext(root);
      return `${context.files.filter((file) => file.kind === 'file').length} files, ~${context.estimatedTokens.toLocaleString()} tokens, ${fileCount} dirs`;
    }),
  );

  const sample = await readFile(join(root, 'src', 'module-0', 'file-0.ts'), 'utf8');
  measurements.push(
    await measure('line diff', '400 edits in one file', async () => {
      const after = sample
        .split('\n')
        .map((line) => (line.endsWith(';') ? `${line} // touched` : line))
        .join('\n');
      const diff = diffLines(sample, after);
      return `${diff.hunks.length} hunks, ${diff.additions} added, ${diff.deletions} removed`;
    }),
  );

  measurements.push(
    await measure('patch round trip', 'apply and roll back one file', async () => {
      const result = await applyFileDiffs(root, [
        { path: 'src/module-0/file-0.ts', before: sample, after: `${sample}// done\n` },
      ]);
      await rollbackFileDiffs(root, result.backupId);
      const restored = await readFile(join(root, 'src', 'module-0', 'file-0.ts'), 'utf8');
      return restored === sample ? 'restored exactly' : 'MISMATCH';
    }),
  );

  measurements.push(...(await benchmarkLlama()));
  report(measurements);
  await rm(root, { recursive: true, force: true });
  await rm(modelsDirectory, { recursive: true, force: true });
}

await main();
