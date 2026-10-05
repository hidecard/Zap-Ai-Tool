import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AgentProgressEvent } from '../src/agentRunner.js';
import { runAgentTask, type AgentRunnerOptions } from '../src/agentRunner.js';
import type { FileDiff } from '../src/domain.js';
import { applySelectedHunks, diffLines } from '../src/diff.js';
import { readGitFileDiff, readGitStatus } from '../src/git.js';
import { HostedChatRuntime } from '../src/hostedRuntime.js';
import { evaluateTerminalCommand, matchesCommandAllowList } from '../src/permissions.js';
import {
  createFileReviews,
  createReviewSelections,
  narrowReviewedDiffs,
  selectReviewedDiffs,
} from '../src/review.js';
import { parseFileDiffProposals } from '../src/diffProposal.js';
import { writeWorkspaceFile } from '../src/patches.js';
import { searchWorkspaceFiles } from '../src/search.js';
import { sanitizeSettingsPatch, type TerminalPolicy } from '../src/settings.js';
import { buildSandboxEnvironment } from '../src/tools.js';
import { readWorkspaceConfig, saveWorkspaceConfig } from '../src/workspace.js';
import { isProjectConfigPath } from '../src/pathSafety.js';
import { familyForArchitecture, formatGgufReport, inspectGguf } from '../src/gguf.js';
import { runApprovedTerminal } from '../src/tools.js';
import {
  decodeConsoleOutput,
  decodeText,
  detectTextEncoding,
  encodeText,
} from '../src/textEncoding.js';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

type GgufValue = { type: number; value: string | number | bigint | boolean | string[] };

function ggufHeader(entries: Array<[string, GgufValue]>, tensorCount = 291): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0x46554747, 0);
  header.writeUInt32LE(3, 4);
  header.writeBigUInt64LE(BigInt(tensorCount), 8);
  header.writeBigUInt64LE(BigInt(entries.length), 16);
  parts.push(header);
  for (const [key, { type, value }] of entries) {
    const keyBytes = Buffer.from(key, 'utf8');
    const keyLength = Buffer.alloc(8);
    keyLength.writeBigUInt64LE(BigInt(keyBytes.length), 0);
    parts.push(keyLength, keyBytes);
    const typeBytes = Buffer.alloc(4);
    typeBytes.writeUInt32LE(type, 0);
    parts.push(typeBytes);
    if (type === 8) {
      const bytes = Buffer.from(String(value), 'utf8');
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(bytes.length), 0);
      parts.push(length, bytes);
      continue;
    }
    if (type === 10) {
      const scalar = Buffer.alloc(8);
      scalar.writeBigUInt64LE(BigInt(value as number), 0);
      parts.push(scalar);
      continue;
    }
    if (type === 7) {
      parts.push(Buffer.from([value === true ? 1 : 0]));
      continue;
    }
    if (type === 4) {
      const scalar = Buffer.alloc(4);
      scalar.writeUInt32LE(value as number, 0);
      parts.push(scalar);
      continue;
    }
    throw new Error(`Unsupported test type ${type}`);
  }
  return Buffer.concat(parts);
}

test('reads GGUF metadata and maps Llama, DeepSeek, and Qwen families', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-gguf-'));
  const qwenPath = join(root, 'qwen2.5-coder-7b-instruct-q4_k_m.gguf');
  await writeFile(
    qwenPath,
    ggufHeader([
      ['general.architecture', { type: 8, value: 'qwen2' }],
      ['general.name', { type: 8, value: 'Qwen2.5 Coder 7B Instruct' }],
      ['general.file_type', { type: 4, value: 15 }],
      ['general.parameter_count', { type: 10, value: 7_615_616_512 }],
      ['qwen2.block_count', { type: 4, value: 28 }],
      ['qwen2.context_length', { type: 4, value: 32_768 }],
      ['qwen2.feed_forward_length', { type: 4, value: 18_963 }],
    ]),
  );
  const inspection = await inspectGguf(qwenPath);
  assert.equal(inspection.valid, true);
  assert.equal(inspection.metadata?.architecture, 'qwen2');
  assert.equal(inspection.metadata?.name, 'Qwen2.5 Coder 7B Instruct');
  assert.equal(inspection.metadata?.quantization, 'type 15');
  assert.equal(inspection.metadata?.blockCount, 28);
  assert.equal(inspection.metadata?.contextLength, 32_768);
  assert.equal(inspection.metadata?.parameterCount, 7_615_616_512n);
  assert.equal(inspection.metadata?.tensorCount, 291);
  assert.equal(inspection.metadata?.version, 3);
  assert.equal(inspection.metadata?.keys.includes('qwen2.context_length'), true);
  assert.equal(familyForArchitecture('qwen2'), 'Qwen');
  const report = formatGgufReport(inspection);
  assert.match(report, /architecture=qwen2/);
  assert.match(report, /family=Qwen/);
  assert.match(report, /context=32768/);

  const deepseekPath = join(root, 'deepseek-coder-6.7b-q4.gguf');
  await writeFile(
    deepseekPath,
    ggufHeader([
      ['general.architecture', { type: 8, value: 'llama' }],
      ['llama.block_count', { type: 4, value: 32 }],
    ]),
  );
  assert.equal((await inspectGguf(deepseekPath)).metadata?.architecture, 'llama');
  assert.equal(familyForArchitecture('llama'), 'Llama');
  assert.equal(familyForArchitecture('deepseek2'), 'DeepSeek');
  assert.equal(familyForArchitecture('gemma3'), undefined);

  const brokenPath = join(root, 'notes.gguf');
  await writeFile(brokenPath, 'this is not a gguf file');
  const broken = await inspectGguf(brokenPath);
  assert.equal(broken.valid, false);
  assert.match(broken.message ?? '', /magic/);

  const futurePath = join(root, 'future.gguf');
  const future = ggufHeader([['general.architecture', { type: 8, value: 'llama' }]]);
  future.writeUInt32LE(99, 4);
  await writeFile(futurePath, future);
  assert.match((await inspectGguf(futurePath)).message ?? '', /Unsupported GGUF version/);
});

test('computes a line-level side-by-side diff with selectable hunks', () => {
  const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n');
  const after = ['one', 'two', 'THREE', 'four', 'five', 'six', 'seven', 'EIGHT'].join('\n');
  const diff = diffLines(before, after);
  assert.equal(diff.identical, false);
  assert.equal(diff.hunks.length, 1);
  const hunk = diff.hunks[0];
  assert.ok(hunk);
  assert.equal(hunk.selected, true);
  assert.match(hunk.header, /^@@ -\d+,\d+ \+\d+,\d+ @@$/);
  const changed = hunk.rows.filter((row) => row.kind === 'changed');
  assert.deepEqual(
    changed.map((row) => `${row.oldLine}:${row.oldText}->${row.newLine}:${row.newText}`),
    ['3:three->3:THREE', '8:eight->8:EIGHT'],
  );
  assert.equal(
    hunk.rows.every((row) => row.oldLine !== undefined || row.newLine !== undefined),
    true,
  );
});

test('separates distant edits into independent hunks', () => {
  const before = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
  const after = before
    .split('\n')
    .map((line) => (line === 'line 2' || line === 'line 38' ? `${line} edited` : line))
    .join('\n');
  const diff = diffLines(before, after);
  assert.equal(diff.hunks.length, 2);
  assert.deepEqual(
    diff.hunks.map((hunk) => hunk.rows.filter((row) => row.kind === 'changed').length),
    [1, 1],
  );
  assert.deepEqual(
    diff.hunks.map((hunk) => hunk.rows[0]?.kind),
    ['context', 'context'],
  );
  assert.equal(diff.additions, 2);
  assert.equal(diff.deletions, 2);
});

test('applies only the selected hunks and keeps the rest of the file intact', () => {
  const before = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
  const after = before
    .split('\n')
    .map((line) => (line === 'line 2' || line === 'line 38' ? `${line} edited` : line))
    .join('\n');
  const diff = diffLines(before, after);
  const [first, second] = diff.hunks;
  assert.ok(first && second);
  assert.equal(
    applySelectedHunks(before, diff.hunks, new Set([first.id])),
    after.replace('line 38 edited', 'line 38'),
  );
  assert.equal(
    applySelectedHunks(before, diff.hunks, new Set([second.id])),
    after.replace('line 2 edited', 'line 2'),
  );
  assert.equal(applySelectedHunks(before, diff.hunks, new Set()), before);
  assert.equal(applySelectedHunks(before, diff.hunks, new Set(diff.hunks.map((h) => h.id))), after);
});

test('creates a new file from a selected hunk over an empty file', () => {
  const diff = diffLines('', 'export const value = 1;\n');
  assert.equal(diff.hunks.length, 1);
  const ids = new Set(diff.hunks.map((hunk) => hunk.id));
  assert.equal(applySelectedHunks('', diff.hunks, ids), 'export const value = 1;\n');
  assert.equal(applySelectedHunks('', diff.hunks, new Set()), '');
});

test('narrows whole-file reviews down to the hunks a reviewer kept', () => {
  const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
  const after = before.replace('line 3', 'line 3 edited').replace('line 27', 'line 27 edited');
  const [diff] = createFileReviews([{ path: 'src/app.ts', before, after, isNew: false }]);
  assert.ok(diff);
  const [first, second] = diff.hunks;
  assert.ok(first && second);
  const narrowed = selectReviewedDiffs([diff], [{ path: 'src/app.ts', hunkIds: [second.id] }]);
  assert.equal(narrowed.length, 1);
  assert.equal(narrowed[0]?.after, before.replace('line 27', 'line 27 edited'));
  assert.equal(narrowed[0]?.isNew, false);
  assert.deepEqual(selectReviewedDiffs([diff], [{ path: 'src/app.ts', hunkIds: [] }]), []);
  assert.deepEqual(selectReviewedDiffs([diff], [{ path: 'src/app.ts', selected: false }]), []);
});

test('defaults every proposal and hunk to selected, then narrows what is applied', () => {
  const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n');
  const after = before.replace('line 3', 'line 3 edited').replace('line 27', 'line 27 edited');
  const diffs: FileDiff[] = [
    { path: 'src/app.ts', before, after, isNew: false },
    { path: 'test/app.test.ts', before: '', after: 'test("a", () => {});\n', isNew: true },
  ];
  const selections = createReviewSelections(diffs);
  assert.deepEqual(Object.keys(selections).sort(), ['src/app.ts', 'test/app.test.ts']);
  assert.equal(selections['src/app.ts']?.selected, true);
  assert.equal(selections['src/app.ts']?.hunkIds.length, 2);
  assert.equal(narrowReviewedDiffs(diffs, selections).length, 2);

  const firstHunk = selections['src/app.ts']?.hunkIds[0] ?? '';
  const narrowed = narrowReviewedDiffs(diffs, {
    ...selections,
    'src/app.ts': { selected: true, hunkIds: [firstHunk] },
    'test/app.test.ts': { selected: false, hunkIds: [] },
  });
  assert.deepEqual(
    narrowed.map((diff) => diff.path),
    ['src/app.ts'],
  );
  assert.equal(narrowed[0]?.before, before);
  assert.equal(narrowed[0]?.after, before.replace('line 3', 'line 3 edited'));
  assert.deepEqual(
    narrowReviewedDiffs(diffs, {
      ...selections,
      'src/app.ts': { selected: true, hunkIds: [] },
    }),
    [diffs[1]],
  );
  assert.deepEqual(
    narrowReviewedDiffs(diffs, {
      'src/app.ts': { selected: true, hunkIds: [] },
      'test/app.test.ts': { selected: false, hunkIds: [] },
    }),
    [],
  );
});

test('finds full-text matches, sorts them, and skips binary files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-search-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'alpha.ts'), 'const needle = 1;\nconst other = 2;\n');
  await writeFile(join(root, 'src', 'beta.ts'), 'nothing here\nNEEDLE\n');
  await writeFile(join(root, 'src', 'binary.bin'), 'needle\u0000binary\n');
  await writeFile(join(root, 'src', 'secret.pem'), 'needle\n');
  const files = [
    { relativePath: 'src/alpha.ts', sizeBytes: 30, kind: 'file' as const },
    { relativePath: 'src/beta.ts', sizeBytes: 20, kind: 'file' as const },
    { relativePath: 'src/binary.bin', sizeBytes: 20, kind: 'file' as const },
    { relativePath: 'src/secret.pem', sizeBytes: 10, kind: 'file' as const },
  ];
  const insensitive = await searchWorkspaceFiles(root, files, 'needle');
  assert.deepEqual(
    insensitive.matches.map((match) => `${match.path}:${match.line}`),
    ['src/alpha.ts:1', 'src/beta.ts:2'],
  );
  assert.equal(insensitive.filesSkipped, 1);
  const sensitive = await searchWorkspaceFiles(root, files, 'needle', { caseSensitive: true });
  assert.deepEqual(
    sensitive.matches.map((match) => match.path),
    ['src/alpha.ts'],
  );
  const regex = await searchWorkspaceFiles(root, files, 'NEEDLE|NOTHING', { isRegex: true });
  assert.deepEqual(
    regex.matches.map((match) => match.path),
    ['src/alpha.ts', 'src/beta.ts', 'src/beta.ts'],
  );
  const bounded = await searchWorkspaceFiles(root, files, 'needle', { maxResults: 1 });
  assert.equal(bounded.matches.length, 1);
  assert.equal(bounded.truncated, true);
  const cancelled = AbortSignal.abort();
  await assert.rejects(() => searchWorkspaceFiles(root, files, 'needle', { signal: cancelled }));
});

test('saves a human edit through the backup boundary and refuses config files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-write-'));
  await writeFile(join(root, 'notes.md'), 'first\n');
  const result = await writeWorkspaceFile(root, 'notes.md', 'second\n');
  assert.deepEqual(result.changedFiles, ['notes.md']);
  assert.equal(await readFile(join(root, 'notes.md'), 'utf8'), 'second\n');
  await assert.rejects(() => writeWorkspaceFile(root, 'notes.md', 'second\n'), /already has this/);
  await assert.rejects(() => writeWorkspaceFile(root, 'ZAP.md', 'obey me\n'), /human-owned/);
  await assert.rejects(() => writeWorkspaceFile(root, '../escape.md', 'x'), /unsafe or outside/);
  const created = await writeWorkspaceFile(root, 'src/new.ts', 'export const a = 1;\n');
  assert.equal(await readFile(join(root, 'src', 'new.ts'), 'utf8'), 'export const a = 1;\n');
  assert.deepEqual(created.changedFiles, ['src/new.ts']);
});

test('keeps project instruction files human owned', async () => {
  assert.equal(isProjectConfigPath('ZAP.md'), true);
  assert.equal(isProjectConfigPath('docs/zap.md'), true);
  assert.equal(isProjectConfigPath('.zapignore'), true);
  assert.equal(isProjectConfigPath('src/zap.md.ts'), false);
  assert.equal(
    parseFileDiffProposals(
      JSON.stringify({
        diffs: [{ path: 'ZAP.md', isNew: false, before: 'a', after: 'obey me' }],
      }),
    ),
    undefined,
  );
});

test('persists project instructions and ignore patterns', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zap-project-'));
  const empty = await readWorkspaceConfig(root);
  assert.deepEqual(empty, { instructions: '', ignorePatterns: [] });
  await saveWorkspaceConfig(root, {
    instructions: 'Use strict TypeScript.',
    ignorePatterns: ['docs', '', '# comment', '*.snap'],
  });
  const saved = await readWorkspaceConfig(root);
  assert.equal(saved.instructions, 'Use strict TypeScript.');
  assert.deepEqual(saved.ignorePatterns, ['docs', '*.snap']);
  await saveWorkspaceConfig(root, { instructions: '', ignorePatterns: [] });
  assert.deepEqual(await readWorkspaceConfig(root), { instructions: '', ignorePatterns: [] });
});

test('matches terminal allow-lists by command prefix only', () => {
  assert.equal(matchesCommandAllowList('npm test', ['npm test']), true);
  assert.equal(matchesCommandAllowList('npm test --watch', ['npm test']), true);
  assert.equal(matchesCommandAllowList('npm run build', ['npm']), true);
  assert.equal(matchesCommandAllowList('sudo npm test', ['npm test']), false);
  assert.equal(matchesCommandAllowList('echo npm test', ['npm test']), false);
  assert.equal(matchesCommandAllowList('npm test', []), false);
});

test('applies the terminal allow-list policy to manual and agent commands', () => {
  const allowList: TerminalPolicy = {
    mode: 'allow-list',
    allowList: ['npm test'],
    allowAgentCommands: true,
  };
  const approved = {
    id: '1',
    name: 'terminal.run' as const,
    risk: 'mutating' as const,
    summary: 'Run tests',
    command: 'npm test',
    status: 'approved' as const,
  };
  const skipped = { ...approved, id: '2', command: 'npm publish' };
  assert.deepEqual(evaluateTerminalCommand(approved, '/tmp/project', allowList), {
    allowed: true,
    requiresApproval: false,
  });
  const blocked = evaluateTerminalCommand(skipped, '/tmp/project', allowList);
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason ?? '', /allow-list/);
  const asking = evaluateTerminalCommand(approved, '/tmp/project', {
    ...allowList,
    allowAgentCommands: false,
  });
  assert.deepEqual(asking, { allowed: true, requiresApproval: true });
  const unconfigured = evaluateTerminalCommand(approved, '/tmp/project');
  assert.deepEqual(unconfigured, { allowed: true, requiresApproval: true });
  const readOnly = evaluateTerminalCommand(
    {
      id: '3',
      name: 'file.read',
      risk: 'read-only',
      summary: 'Read source',
      command: '/tmp/project/src/index.ts',
      status: 'proposed',
    },
    '/tmp/project',
    allowList,
  );
  assert.equal(readOnly.allowed, true);
  assert.equal(readOnly.requiresApproval, false);
});

test('withholds credentials and tokens from terminal child processes', () => {
  const sandbox = buildSandboxEnvironment({
    PATH: '/usr/bin',
    HOME: '/home/alice',
    SystemRoot: 'C:\\Windows',
    OPENAI_API_KEY: 'secret-token',
    AWS_SECRET_ACCESS_KEY: 'secret',
    NPM_TOKEN: 'secret',
    GITHUB_TOKEN: 'secret',
  });
  assert.equal(sandbox.PATH, '/usr/bin');
  assert.equal(sandbox.HOME, '/home/alice');
  assert.equal(sandbox.OPENAI_API_KEY, undefined);
  assert.equal(sandbox.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(sandbox.NPM_TOKEN, undefined);
  assert.equal(sandbox.GITHUB_TOKEN, undefined);
  assert.equal(sandbox.ZAP_SANDBOX, '1');
});

test('validates and clamps settings patches', () => {
  assert.deepEqual(sanitizeSettingsPatch({ maxContextFiles: 50_000 }), { maxContextFiles: 10_000 });
  assert.deepEqual(sanitizeSettingsPatch({ maxContextFiles: 1 }), { maxContextFiles: 100 });
  assert.throws(() => sanitizeSettingsPatch({ maxContextFiles: Number.NaN }), /must be a number/);
  assert.deepEqual(
    sanitizeSettingsPatch({
      terminalPolicy: {
        mode: 'allow-list',
        allowList: [' git ', 'git', ''],
        allowAgentCommands: true,
      },
    }),
    { terminalPolicy: { mode: 'allow-list', allowList: ['git'], allowAgentCommands: true } },
  );
  assert.deepEqual(
    sanitizeSettingsPatch({
      provider: { kind: 'openai-compatible', baseUrl: ' https://api.example.com/v1/ ', model: 'm' },
    }),
    { provider: { kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1/', model: 'm' } },
  );
  assert.deepEqual(sanitizeSettingsPatch({ workspaceDirectory: '  ' }), {});
});

test('reads git status and a HEAD-versus-disk diff for a real repository', async (t) => {
  if (!gitAvailable()) return t.skip('git is not installed');
  const root = await mkdtemp(join(tmpdir(), 'zap-git-'));
  const run = (args: string[]): void => {
    execFileSync('git', ['-C', root, ...args], { stdio: 'ignore' });
  };
  run(['init']);
  run(['config', 'user.email', 'test@example.com']);
  run(['config', 'user.name', 'Zap Test']);
  run(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(root, 'tracked.ts'), 'export const value = 1;\n');
  await writeFile(join(root, 'README.md'), 'docs\n');
  run(['add', '.']);
  run(['commit', '-m', 'initial']);
  await writeFile(join(root, 'tracked.ts'), 'export const value = 2;\n');
  await writeFile(join(root, 'fresh.ts'), 'export const fresh = true;\n');

  const status = await readGitStatus(root);
  assert.equal(status.available, true);
  assert.deepEqual(status.entries.map((entry) => `${entry.status}:${entry.path}`).sort(), [
    'modified:tracked.ts',
    'untracked:fresh.ts',
  ]);

  const modified = await readGitFileDiff(root, 'tracked.ts');
  assert.equal(modified?.status, 'modified');
  assert.equal(modified?.diff.before, 'export const value = 1;\n');
  assert.equal(modified?.diff.after, 'export const value = 2;\n');
  assert.equal(modified?.diff.isNew, false);
  assert.equal(diffLines(modified?.diff.before ?? '', modified?.diff.after ?? '').hunks.length, 1);

  const untracked = await readGitFileDiff(root, 'fresh.ts');
  assert.equal(untracked?.diff.isNew, true);
  assert.equal(untracked?.diff.before, '');
  assert.equal(untracked?.diff.after, 'export const fresh = true;\n');

  const plain = await mkdtemp(join(tmpdir(), 'zap-nogit-'));
  const plainStatus = await readGitStatus(plain);
  assert.equal(plainStatus.available, false);
  assert.equal(plainStatus.entries.length, 0);
});

test('completes through an OpenAI-compatible hosted endpoint', async () => {
  const requests: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const runtime = new HostedChatRuntime({
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'secret-key',
    fetchImpl: (async (url: string, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body ?? '{}')),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hosted answer' } }],
          usage: { completion_tokens: 7 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch,
  });
  const health = await runtime.healthCheck();
  assert.equal(health.healthy, true);
  await runtime.load({
    id: 'remote:gpt-test',
    name: 'gpt-test',
    path: 'https://api.example.com/v1',
    format: 'remote',
    sizeBytes: 0,
    modifiedAt: '',
  });
  const completion = await runtime.complete('hello', { maxTokens: 32, temperature: 0.1 });
  assert.equal(completion.content, 'hosted answer');
  assert.equal(completion.tokensPredicted, 7);
  assert.equal(requests[1]?.url, 'https://api.example.com/v1/chat/completions');
  assert.equal(requests[1]?.headers.authorization, 'Bearer secret-key');
  assert.deepEqual((requests[1]?.body as { messages: unknown[] }).messages, [
    { role: 'user', content: 'hello' },
  ]);
  assert.equal((requests[1]?.body as { max_tokens: number }).max_tokens, 32);
  await runtime.unload();
  await assert.rejects(() => runtime.complete('hello'), /Select a hosted model/);
});

test('reports hosted endpoint failures instead of hanging', async () => {
  const runtime = new HostedChatRuntime({
    baseUrl: 'https://api.example.com/v1',
    fetchImpl: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
  });
  const health = await runtime.healthCheck();
  assert.equal(health.healthy, false);
  assert.match(health.message, /401/);
  const unsupported = new HostedChatRuntime({
    baseUrl: 'ftp://files.example.com',
    fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch,
  });
  await assert.rejects(
    () =>
      unsupported.load({
        id: 'remote:x',
        name: 'x',
        path: 'ftp://files.example.com',
        format: 'remote',
        sizeBytes: 0,
        modifiedAt: '',
      }),
    /http:\/\/ or https:\/\//,
  );
  const missing = new HostedChatRuntime({ baseUrl: '   ' });
  const missingHealth = await missing.healthCheck();
  assert.equal(missingHealth.healthy, false);
  assert.match(missingHealth.message, /endpoint URL/);
  await assert.rejects(
    () =>
      missing.load({
        id: 'remote:x',
        name: 'x',
        path: '',
        format: 'remote',
        sizeBytes: 0,
        modifiedAt: '',
      }),
    /endpoint URL/,
  );
});

test('streams agent progress events to the renderer during a task', async () => {
  const events: AgentProgressEvent[] = [];
  const options: AgentRunnerOptions = {
    workspace: {
      rootPath: '/tmp/zap-progress',
      files: [{ relativePath: 'src/index.ts', sizeBytes: 10, kind: 'file' }],
      estimatedTokens: 3,
    },
    instruction: 'Inspect the source file.',
    complete: async () => ({ content: '{"type":"read_file","path":"src/index.ts"}' }),
    readFile: async () => 'export const value = 1;\n',
    readFileIfExists: async () => null,
    approveTerminal: async () => false,
    runTerminal: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
    }),
    onEvent: (event) => events.push(event),
  };
  await runAgentTask(options);
  const kinds = events.map((event) => event.kind);
  assert.equal(kinds[0], 'task-started');
  assert.equal(kinds.includes('model-request'), true);
  assert.equal(kinds.includes('tool'), true);
  assert.equal(kinds.at(-1), 'task-finished');
  assert.match(events.at(-1)?.message ?? '', /step safety limit/);
  assert.equal(
    events.every((event) => typeof event.at === 'string' && event.maxSteps === 10),
    true,
  );
});

test('cancels an in-flight agent task without writing files', async () => {
  const controller = new AbortController();
  const events: AgentProgressEvent[] = [];
  const proposal = JSON.stringify({
    type: 'propose_changes',
    diffs: [{ path: 'src/index.ts', isNew: false, before: 'old', after: 'new' }],
  });
  const result = await runAgentTask({
    workspace: {
      rootPath: '/tmp/zap-cancel',
      files: [{ relativePath: 'src/index.ts', sizeBytes: 3, kind: 'file' }],
      estimatedTokens: 1,
    },
    instruction: 'Change the value.',
    signal: controller.signal,
    onEvent: (event) => {
      events.push(event);
      if (event.kind === 'model-request') controller.abort();
    },
    complete: async () => ({ content: proposal }),
    readFile: async () => 'old',
    readFileIfExists: async () => 'old',
    approveTerminal: async () => false,
    runTerminal: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      durationMs: 1,
      timedOut: false,
      cancelled: false,
    }),
  });
  assert.equal(result.diffs.length, 0);
  assert.equal(result.task.status, 'failed');
  assert.match(result.message, /cancelled/i);
  assert.equal(events.at(-1)?.kind, 'cancelled');
});

test('blocks agent commands outside the allow-list and auto-runs allowed ones', async () => {
  let approvals = 0;
  const commands: string[] = [];
  const base: AgentRunnerOptions = {
    workspace: {
      rootPath: '/tmp/zap-policy',
      files: [{ relativePath: 'src/index.ts', sizeBytes: 3, kind: 'file' }],
      estimatedTokens: 1,
    },
    instruction: 'Run the tests.',
    terminalPolicy: { mode: 'allow-list', allowList: ['npm test'], allowAgentCommands: true },
    complete: async () => ({ content: '{"type":"answer","message":"done"}' }),
    approveTerminal: async () => {
      approvals += 1;
      return true;
    },
    runTerminal: async (call) => {
      commands.push(call.command ?? '');
      return {
        stdout: 'ok',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        timedOut: false,
        cancelled: false,
      };
    },
    readFile: async () => 'x',
    readFileIfExists: async () => 'x',
  };
  const blocked = await runAgentTask({
    ...base,
    complete: async () => ({
      content: '{"type":"run_terminal","summary":"Publish","command":"npm publish"}',
    }),
  });
  assert.deepEqual(commands, []);
  assert.equal(approvals, 0);
  assert.equal(blocked.task.toolCalls[0]?.status, 'failed');
  assert.match(
    blocked.task.toolCalls[0]?.status === 'failed' ? (blocked.events[0] ?? '') : '',
    /blocked/i,
  );

  const allowed = await runAgentTask({
    ...base,
    complete: async () => ({
      content: '{"type":"run_terminal","summary":"Test","command":"npm test"}',
    }),
  });
  assert.deepEqual(commands, ['npm test']);
  assert.equal(approvals, 0);
  assert.equal(allowed.task.toolCalls[0]?.status, 'completed');
});

test('decodes UTF-8, UTF-8 BOM, UTF-16LE, and UTF-16BE content', () => {
  assert.equal(decodeText(Buffer.from('caf\u00e9 \u2014 ok', 'utf8')), 'caf\u00e9 \u2014 ok');
  assert.equal(
    decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('bom', 'utf8')])),
    'bom',
  );
  assert.equal(
    decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('bom', 'utf16le')])),
    'bom',
  );
  assert.equal(
    decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('bom', 'utf16le').swap16()])),
    'bom',
  );
});

test('round-trips text in the encoding a file already uses', () => {
  for (const encoding of ['utf8', 'utf16le', 'utf16be'] as const) {
    const encoded = encodeText('Grüße — ok', encoding);
    assert.equal(detectTextEncoding(encoded), encoding);
    assert.equal(decodeText(encoded), 'Grüße — ok');
  }
});

test('console output decodes UTF-8 and legacy Windows code pages without mojibake', () => {
  assert.equal(decodeConsoleOutput(Buffer.from('plain output', 'utf8')), 'plain output');
  assert.equal(
    decodeConsoleOutput(Buffer.from('caf\u00e9 \u2014 done', 'utf8')),
    'caf\u00e9 \u2014 done',
  );
  const legacy = Buffer.from([0x63, 0x61, 0x66, 0x93, 0x20]); // caf\u0093 in a Windows code page
  const decoded = decodeConsoleOutput(legacy);
  assert.doesNotMatch(decoded, /\u00c2|\u00e2|\u00c3/);
  assert.equal(decoded.length, 5);
  assert.ok(decoded.startsWith('caf'));
  assert.equal(decodeConsoleOutput(Buffer.alloc(0)), '');
});

test('terminal output is decoded as UTF-8 or a legacy code page, not mojibake', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'zap-encoding-'));
  const result = await runApprovedTerminal(
    workspaceRoot,
    {
      id: 'call-1',
      summary: 'echo',
      name: 'terminal.run',
      command: 'echo caf\u00e9',
      risk: 'read-only',
      status: 'approved',
    },
    { policy: { mode: 'allow-list', allowList: ['echo'], allowAgentCommands: false } },
  );
  assert.equal(result.exitCode, 0);
  assert.doesNotMatch(result.stdout, /\u00c2|\u00e2|\u00c3|\u00ef/);
});
