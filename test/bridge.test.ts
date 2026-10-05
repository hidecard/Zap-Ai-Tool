import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

/**
 * Guards the renderer bridge: every main-process channel must have a preload
 * wrapper, every wrapper must be declared for the renderer, and every bridge
 * call in the renderer must exist. These are the failure modes that only show
 * up at runtime in a packaged Electron app.
 */

const projectRoot = process.cwd();

async function rendererSources(
  directory = join(projectRoot, 'src', 'renderer'),
): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await rendererSources(path)));
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
      files.push(await readFile(path, 'utf8'));
  }
  return files;
}

test('main-process IPC channels and preload wrappers stay in sync', async () => {
  const main = await readFile(join(projectRoot, 'desktop', 'main.ts'), 'utf8');
  const preload = await readFile(join(projectRoot, 'desktop', 'preload.cts'), 'utf8');
  const handled = new Set([...main.matchAll(/ipcMain\.handle\(\s*'([^']+)'/g)].map((m) => m[1]));
  const invoked = new Set(
    [...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]),
  );
  assert.deepEqual(
    [...invoked].filter((channel) => !handled.has(channel)),
    [],
    'preload invokes channels that main does not handle',
  );
  assert.deepEqual(
    [...handled].filter((channel) => !invoked.has(channel)),
    [],
    'main handles channels that preload never invokes',
  );
});

test('preload event listeners match the channels main sends', async () => {
  const main = await readFile(join(projectRoot, 'desktop', 'main.ts'), 'utf8');
  const preload = await readFile(join(projectRoot, 'desktop', 'preload.cts'), 'utf8');
  const sent = new Set([...main.matchAll(/\.send\('([^']+)'/g)].map((m) => m[1]));
  const listened = new Set([...preload.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual(
    [...listened].filter((channel) => !sent.has(channel)),
    [],
    'preload listens for events that main never sends',
  );
});

test('every bridge method is declared for the renderer and used from it', async () => {
  const preload = await readFile(join(projectRoot, 'desktop', 'preload.cts'), 'utf8');
  const declaration = await readFile(join(projectRoot, 'src', 'renderer', 'vite-env.d.ts'), 'utf8');
  const sources = await rendererSources();
  const implemented = new Set([...preload.matchAll(/^ {2}([a-zA-Z0-9]+):/gm)].map((m) => m[1]));
  const declared = new Set([...declaration.matchAll(/^ {6}([a-zA-Z0-9]+)\(/gm)].map((m) => m[1]));
  const used = new Set(
    sources.flatMap((source) =>
      [...source.matchAll(/window\.zap\.([a-zA-Z0-9]+)/g)].map((m) => m[1]),
    ),
  );
  assert.deepEqual(
    [...implemented].filter((name) => !declared.has(name)),
    [],
    'preload exposes methods that vite-env.d.ts does not declare',
  );
  assert.deepEqual(
    [...declared].filter((name) => !implemented.has(name)),
    [],
    'vite-env.d.ts declares methods that preload does not expose',
  );
  assert.deepEqual(
    [...used].filter((name) => !implemented.has(name)),
    [],
    'the renderer calls bridge methods that preload does not expose',
  );
});

test('the preload script is compiled to a format Electron can execute', async () => {
  const main = await readFile(join(projectRoot, 'desktop', 'main.ts'), 'utf8');
  const tsconfig = await readFile(join(projectRoot, 'tsconfig.json'), 'utf8');
  const preloadPath = main.match(/preload:\s*join\([^,]+,\s*'([^']+)'\)/)?.[1];
  assert.equal(
    preloadPath,
    'desktop/preload.cjs',
    'BrowserWindow must load the CommonJS preload build; an ESM .js preload never loads',
  );
  await access(join(projectRoot, 'desktop', 'preload.cts'));
  assert.match(tsconfig, /desktop\/\*\*\/\*\.cts/, 'tsconfig must compile desktop/preload.cts');
});

test('the renderer never imports a Node-only module as a value', async () => {
  const sources = await rendererSources();
  const nodeOnly = [
    '../tools.js',
    '../patches.js',
    '../agentRunner.js',
    '../search.js',
    '../git.js',
    '../gguf.js',
    '../workspace.js',
    '../settings.js',
    '../llamaRuntime.js',
    '../hostedRuntime.js',
  ];
  for (const source of sources)
    for (const match of source.matchAll(/^import\s+([^;]+?)\s+from\s+'([^']+)';/gm)) {
      const [, clause, specifier] = match;
      const resolved = (specifier ?? '').replace('../../', '../').replace('../', '');
      if (!nodeOnly.some((entry) => resolved.endsWith(entry.replace('../', '')))) continue;
      assert.match(
        clause ?? '',
        /^type\b/,
        `renderer imports ${specifier} as a value; Node-only modules must be type-only imports`,
      );
    }
});
