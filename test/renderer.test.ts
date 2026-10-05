import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/renderer/App.js';
import { DiffFile } from '../src/renderer/components/DiffFile.js';
import { ReviewDialog } from '../src/renderer/components/ReviewDialog.js';
import { SearchPanel } from '../src/renderer/components/SearchPanel.js';
import { SettingsPanel } from '../src/renderer/components/SettingsPanel.js';
import { SourceControlPanel } from '../src/renderer/components/SourceControlPanel.js';
import { diffLines } from '../src/diff.js';
import { createReviewSelections } from '../src/review.js';
import type { FileDiff, WorkspaceContext } from '../src/domain.js';
import type { AppSettings } from '../src/settings.js';

// The renderer only touches `window.zap` inside effects and handlers, so an empty
// window object is enough to exercise every component in preview mode.
(globalThis as { window?: unknown }).window = {};

const workspace: WorkspaceContext = {
  rootPath: '/tmp/zap-render',
  files: [
    { relativePath: 'src/index.ts', sizeBytes: 120, kind: 'file' },
    { relativePath: 'README.md', sizeBytes: 40, kind: 'file' },
  ],
  estimatedTokens: 40,
};

const before = ['one', 'two', 'three', 'four'].join('\n');
const after = ['one', 'TWO', 'three', 'four'].join('\n');
const diff: FileDiff = { path: 'src/index.ts', before, after, isNew: false };
const noop = async (): Promise<void> => undefined;

test('renders the whole IDE shell in preview mode', () => {
  const markup = renderToStaticMarkup(h(App));
  assert.match(markup, /Zap Ai Tool/);
  assert.match(markup, /BROWSER PREVIEW/);
  assert.match(markup, /EXPLORER/);
  assert.match(markup, /atlas-dashboard/);
  assert.match(markup, /Context ready/);
  assert.match(markup, /Terminal ready/);
});

test('renders a side-by-side diff with per-hunk selection controls', () => {
  const hunks = diffLines(before, after).hunks.map((hunk) => hunk.id);
  const markup = renderToStaticMarkup(
    h(DiffFile, { diff, selectedHunkIds: new Set(hunks), onToggleHunk: () => undefined }),
  );
  assert.match(markup, /@@ -\d+,\d+ \+\d+,\d+ @@/);
  assert.match(markup, /class="diff-cell old">two</);
  assert.match(markup, /class="diff-cell new">TWO</);
  assert.match(markup, /aria-label="Include hunk hunk-1"/);
  assert.match(markup, /Unselect all hunks/);
  assert.match(markup, /<span class="diff-stat added">\+1<\/span>/);
});

test('renders the review dialog with per-file checkboxes and an approval footer', () => {
  const markup = renderToStaticMarkup(
    h(ReviewDialog, {
      title: 'Review 1 file',
      subtitle: 'PROPOSED CHANGES · REVIEW REQUIRED',
      diffs: [diff],
      selections: createReviewSelections([diff]),
      feedback: '',
      onFeedbackChange: () => undefined,
      onSelectFile: () => undefined,
      onSetHunkSelection: () => undefined,
      onSelectAllFiles: () => undefined,
      onApply: () => undefined,
      onReject: () => undefined,
      onClose: () => undefined,
    }),
  );
  assert.match(markup, /Approve &amp; Apply/);
  assert.match(markup, /1 of 1 file\(s\), 1 hunk\(s\) selected/);
  assert.match(markup, /Include src\/index\.ts/);
});

test('renders the search panel controls', () => {
  const markup = renderToStaticMarkup(
    h(SearchPanel, {
      workspace,
      previewMode: true,
      previewFiles: { 'src/index.ts': ['const value = 1;'] },
      onOpenResult: () => undefined,
    }),
  );
  assert.match(markup, /Find text in this project/);
  assert.match(markup, /Match case/);
  assert.match(markup, /Regex/);
});

test('renders the source control panel with the undo action', () => {
  const markup = renderToStaticMarkup(
    h(SourceControlPanel, {
      workspace,
      previewMode: true,
      changedFiles: ['src/index.ts'],
      pendingCount: 2,
      canUndo: true,
      busy: false,
      onOpenPending: () => undefined,
      onOpenGitDiff: () => undefined,
      onUndo: () => undefined,
    }),
  );
  assert.match(markup, /2 change\(s\) awaiting review/);
  assert.match(markup, /Undo last change/);
  assert.match(markup, /APPLIED/);
});

test('renders provider, terminal policy, and project rule settings', () => {
  const settings: AppSettings = {
    modelsDirectory: '/models',
    maxContextFiles: 1500,
    provider: { kind: 'openai-compatible', baseUrl: 'https://api.example.com/v1', model: 'm' },
    terminalPolicy: { mode: 'allow-list', allowList: ['npm test'], allowAgentCommands: true },
  };
  const markup = renderToStaticMarkup(
    h(SettingsPanel, {
      settings,
      workspace,
      previewMode: true,
      busy: false,
      error: undefined,
      healthMessage: '',
      onUpdateSettings: noop,
      onChooseModelsDirectory: noop,
      onChooseModelFile: noop,
      onCheckHealth: noop,
      onSaveProjectConfig: noop,
    }),
  );
  assert.match(markup, /<option value="openai-compatible">Hosted \/ OpenAI-compatible endpoint/);
  assert.match(markup, /aria-label="Workspace entry limit"/);
  assert.match(markup, /Only allow listed commands/);
  assert.match(markup, /Save terminal policy/);
  assert.match(markup, /aria-label="Project instructions"/);
  assert.match(markup, /aria-label="Ignored paths"/);
  assert.match(markup, /Save project rules/);
  assert.match(markup, /Check runtime health/);
});
