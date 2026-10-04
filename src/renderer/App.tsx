import { useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react';
import type { ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

const previewModels: ModelDescriptor[] = [
  {
    id: 'qwen2.5-coder-7b.gguf',
    name: 'Qwen2.5 Coder 7B',
    path: 'Models/qwen2.5-coder-7b.gguf',
    format: 'gguf',
    sizeBytes: 4.2 * 1024 ** 3,
    modifiedAt: new Date().toISOString(),
  },
  {
    id: 'deepseek-coder-6.7b.gguf',
    name: 'DeepSeek Coder 6.7B',
    path: 'Models/deepseek-coder-6.7b.gguf',
    format: 'gguf',
    sizeBytes: 3.8 * 1024 ** 3,
    modifiedAt: new Date().toISOString(),
  },
];

const previewWorkspace: WorkspaceContext = {
  rootPath: '/Users/you/Projects/atlas-dashboard',
  files: [
    { relativePath: 'src', sizeBytes: 0, kind: 'directory' },
    { relativePath: 'src/renderer', sizeBytes: 0, kind: 'directory' },
    { relativePath: 'src/renderer/App.tsx', sizeBytes: 12480, kind: 'file' },
    { relativePath: 'src/renderer/styles.css', sizeBytes: 8920, kind: 'file' },
    { relativePath: 'src/domain.ts', sizeBytes: 3610, kind: 'file' },
    { relativePath: 'package.json', sizeBytes: 2180, kind: 'file' },
    { relativePath: 'README.md', sizeBytes: 6040, kind: 'file' },
  ],
  estimatedTokens: 8100,
};

const previewCode: Record<string, string[]> = {
  'App.tsx': [
    "import { useState } from 'react';",
    "import { AgentPanel } from './components/AgentPanel';",
    '',
    'export function App() {',
    "  const [task, setTask] = useState('');",
    '',
    '  return (',
    '    <main className="workspace">',
    '      <Editor />',
    '      <AgentPanel task={task} onChange={setTask} />',
    '    </main>',
    '  );',
    '}',
  ],
  'styles.css': [
    ':root {',
    '  --canvas: #0b1220;',
    '  --panel: #101c2e;',
    '  --accent: #a8e6cf;',
    '}',
    '',
    '.workspace {',
    '  display: grid;',
    '  grid-template-columns: 1fr 380px;',
    '  min-height: 100vh;',
    '}',
  ],
  'domain.ts': [
    "export type ToolName = 'file.read' | 'terminal.run';",
    "export type ToolRisk = 'read-only' | 'mutating' | 'network';",
    '',
    'export interface FileDiff {',
    '  path: string;',
    '  before: string;',
    '  after: string;',
    '}',
  ],
};

function createPreviewState(selectedId = previewModels[0]?.id): ModelManagerState {
  return {
    available: previewModels,
    selectedId,
    loadedId: selectedId,
    status: 'ready',
    error: undefined,
  };
}

function fileIcon(path: string): string {
  if (path.endsWith('.tsx')) return 'TS';
  if (path.endsWith('.css')) return '#';
  if (path.endsWith('.json')) return '{}';
  if (path.endsWith('.md')) return 'M';
  return '◇';
}

export function App(): ReactElement {
  const previewMode = typeof window.zap === 'undefined';
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [state, setState] = useState<ModelManagerState>({
    available: [],
    selectedId: undefined,
    loadedId: undefined,
    status: 'idle',
    error: undefined,
  });
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(
    previewMode ? previewWorkspace : null,
  );
  const [loading, setLoading] = useState(!previewMode);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | undefined>();
  const [activeFile, setActiveFile] = useState('App.tsx');
  const [activeView, setActiveView] = useState('explorer');
  const [prompt, setPrompt] = useState('');
  const [agentMode, setAgentMode] = useState<'build' | 'ask'>('build');
  const [activity, setActivity] = useState('Ready for your next task.');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDecision, setReviewDecision] = useState<'pending' | 'approved' | 'rejected'>(
    'pending',
  );
  const [feedback, setFeedback] = useState('');
  const [activityLog, setActivityLog] = useState<string[]>(['Workspace ready · local-only mode']);
  const [splitEditor, setSplitEditor] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const refreshModels = async (): Promise<void> => {
    setLoading(true);
    try {
      if (previewMode) {
        setModels(previewModels);
        setState(createPreviewState());
      } else {
        const result = await window.zap.listModels();
        setModels(result.models);
        setState(result.state);
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refreshModels();
  }, []);

  const selectModel = async (modelId: string): Promise<void> => {
    if (!modelId) return;
    if (previewMode) {
      setState({ ...createPreviewState(modelId), status: 'loading', loadedId: undefined });
      window.setTimeout(() => setState(createPreviewState(modelId)), 450);
      return;
    }
    setState((current) => ({
      ...current,
      selectedId: modelId,
      status: 'loading',
      error: undefined,
    }));
    try {
      setState(await window.zap.selectModel(modelId));
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  const loadWorkspace = async (rootPath: string): Promise<void> => {
    setWorkspaceBusy(true);
    setWorkspaceError(undefined);
    try {
      setWorkspace(
        previewMode ? { ...previewWorkspace, rootPath } : await window.zap.loadWorkspace(rootPath),
      );
      setActivity('Project context refreshed.');
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceBusy(false);
    }
  };
  const chooseWorkspace = async (): Promise<void> => {
    if (previewMode) {
      await loadWorkspace(previewWorkspace.rootPath);
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceError(undefined);
    try {
      const result = await window.zap.chooseWorkspace();
      if (result) setWorkspace(result);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceBusy(false);
    }
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0) as (File & { path?: string }) | null;
    if (file?.path) void loadWorkspace(file.path);
    else if (previewMode) void loadWorkspace(previewWorkspace.rootPath);
    else setWorkspaceError('Drop a folder from your file manager, or use Choose folder.');
  };

  const selected = models.find((model) => model.id === state.selectedId);
  const statusLabel =
    state.status === 'ready'
      ? 'Ready'
      : state.status === 'loading'
        ? 'Loading model…'
        : state.status === 'error'
          ? 'Needs attention'
          : 'No model loaded';
  const files = useMemo(
    () =>
      workspace?.files.filter(
        (file) =>
          file.kind === 'file' &&
          file.relativePath.toLowerCase().includes(searchQuery.toLowerCase()),
      ) ?? [],
    [searchQuery, workspace],
  );
  const code = previewCode[activeFile] ?? [
    '// Select a file to inspect its context.',
    '// Zap will keep your project local and safe.',
  ];
  const activePath =
    files.find((file) => file.relativePath.split('/').pop() === activeFile)?.relativePath ??
    activeFile;
  const proposedDiff = {
    path: activePath,
    before: "const mode = 'draft';\n",
    after: "const mode = 'approved';\nsetActivity('Ready for validation');\n",
  };
  const runPrompt = (): void => {
    if (!prompt.trim()) return;
    const request = prompt.trim();
    setActivity(`Drafting a plan for: ${request}`);
    setActivityLog((items) => [`Agent started · ${request}`, ...items].slice(0, 5));
    if (agentMode === 'build') {
      setReviewDecision('pending');
      setReviewOpen(true);
    }
    setPrompt('');
  };
  const decideReview = async (decision: 'approved' | 'rejected'): Promise<void> => {
    if (decision === 'approved' && !previewMode && workspace) {
      try {
        const result = await window.zap.applyPatches(workspace.rootPath, [proposedDiff]);
        setActivity(`Approved change · backup ${result.backupId}`);
      } catch (error) {
        setActivity(`Patch blocked · ${error instanceof Error ? error.message : String(error)}`);
        setActivityLog((items) => ['Patch blocked · no files changed', ...items].slice(0, 5));
        return;
      }
    }
    setReviewDecision(decision);
    setReviewOpen(false);
    setActivity(
      decision === 'approved'
        ? 'Approved change · backup created'
        : 'Rejected draft · feedback saved',
    );
    setActivityLog((items) =>
      [
        decision === 'approved'
          ? 'Change approved · backup created'
          : 'Draft rejected · no files changed',
        ...items,
      ].slice(0, 5),
    );
  };

  return (
    <main className="ide-shell">
      <header className="ide-titlebar">
        <div className="brand-mark">Z</div>
        <span className="brand-name">Zap Ai Tool</span>
        <span className="title-divider">/</span>
        <span className="project-title">
          {workspace ? workspace.rootPath.split('/').pop() : 'No workspace'}
        </span>
        <div className="topbar-spacer" />
        {previewMode && <span className="preview-badge">BROWSER PREVIEW</span>}
        <span className={`status-dot ${state.status}`} />
        <span className="status-text">{statusLabel}</span>
      </header>
      <div className="ide-body">
        <nav className="activity-bar" aria-label="Primary navigation">
          <button
            className={activeView === 'explorer' ? 'activity-button active' : 'activity-button'}
            onClick={() => setActiveView('explorer')}
            title="Explorer"
          >
            ▱<span>1</span>
          </button>
          <button
            className={activeView === 'search' ? 'activity-button active' : 'activity-button'}
            onClick={() => setActiveView('search')}
            title="Search"
          >
            ⌕
          </button>
          <button
            className={activeView === 'source' ? 'activity-button active' : 'activity-button'}
            onClick={() => setActiveView('source')}
            title="Source control"
          >
            ⑂
          </button>
          <div className="activity-spacer" />
          <button
            className={activeView === 'settings' ? 'activity-button active' : 'activity-button'}
            title="Settings"
            onClick={() => setActiveView('settings')}
          >
            ⚙
          </button>
        </nav>
        <aside className="explorer-panel">
          <div className="explorer-heading">
            <span>EXPLORER</span>
            <button onClick={() => void chooseWorkspace()} title="Open folder">
              ＋
            </button>
          </div>
          <div className="workspace-name">
            ⌄ &nbsp; {workspace ? workspace.rootPath.split('/').pop() : 'NO FOLDER OPENED'}
          </div>
          {activeView === 'search' ? (
            <div className="utility-panel">
              <label>SEARCH PROJECT</label>
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search files…"
              />
              <small>{files.length} indexed files · local only</small>
            </div>
          ) : activeView === 'source' ? (
            <div className="utility-panel">
              <label>SOURCE CONTROL</label>
              <div className="change-row">
                <span>M</span>
                <span>App.tsx</span>
                <b>1</b>
              </div>
              <small>Changes are reviewable before apply.</small>
            </div>
          ) : activeView === 'settings' ? (
            <div className="utility-panel">
              <label>SETTINGS</label>
              <div className="setting-row">
                <span>Local-only mode</span>
                <b>ON</b>
              </div>
              <div className="setting-row">
                <span>Approval gate</span>
                <b>ON</b>
              </div>
            </div>
          ) : workspace ? (
            <div className="file-tree">
              {files.map((file) => {
                const name = file.relativePath.split('/').pop() ?? file.relativePath;
                return (
                  <button
                    className={activeFile === name ? 'tree-file selected' : 'tree-file'}
                    key={file.relativePath}
                    onClick={() => setActiveFile(name)}
                  >
                    <span className="file-icon">{fileIcon(name)}</span>
                    <span>{name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="empty-explorer">
              <span>◫</span>
              <strong>Open a folder</strong>
              <small>Load a project to start editing</small>
              <button onClick={() => void chooseWorkspace()}>Open Folder</button>
            </div>
          )}
          <div className="explorer-footer">
            <span className="tiny-label">MODEL</span>
            <select
              value={state.selectedId ?? ''}
              onChange={(event) => void selectModel(event.target.value)}
              disabled={loading || models.length === 0}
            >
              <option value="">{loading ? 'Scanning…' : 'Select model'}</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            {selected && (
              <small>
                {formatBytes(selected.sizeBytes)} · {selected.path}
              </small>
            )}
          </div>
        </aside>
        <section className="editor-area">
          <div className="editor-tabs">
            <div className="editor-tab active">
              <span className="file-icon">{fileIcon(activeFile)}</span>
              {activeFile}
              <button
                className="tab-close"
                title="Close file"
                onClick={() => setActiveFile(files[0]?.relativePath.split('/').pop() ?? 'App.tsx')}
              >
                ×
              </button>
            </div>
            <div className="editor-actions">
              <button title="Split editor" onClick={() => setSplitEditor((value) => !value)}>
                ▥
              </button>
              <button
                title="More actions"
                onClick={() => setActivity('Editor actions ready · no files changed')}
              >
                •••
              </button>
            </div>
          </div>
          <div className="editor-content">
            <div className="breadcrumb">
              src <span>/</span> renderer <span>/</span> <strong>{activeFile}</strong>
            </div>
            <div className={splitEditor ? 'code-view split' : 'code-view'}>
              {code.map((line, index) => (
                <div className="code-line" key={`${activeFile}-${index}`}>
                  <span className="line-number">{index + 1}</span>
                  <code>{line || ' '}</code>
                </div>
              ))}
              {splitEditor && (
                <div className="split-preview">
                  <span className="tiny-label">SIDE-BY-SIDE PREVIEW</span>
                  <code>{code.slice(0, 5).join('\n')}</code>
                </div>
              )}
            </div>
          </div>
          <div className="terminal-panel">
            <div className="terminal-tabs">
              <span className="terminal-tab active">TERMINAL</span>
              <span>OUTPUT</span>
              <span>
                PROBLEMS <b>0</b>
              </span>
              <span className="terminal-clear">⌃</span>
            </div>
            <div className="terminal-content">
              <span className="terminal-prompt">zap@local</span>
              <span className="terminal-path"> {workspace?.rootPath ?? '~/workspace'}</span>
              <span className="terminal-cursor"> $ {activity}</span>
              <div className="activity-log">
                {activityLog.map((item) => (
                  <span key={item}>› {item}</span>
                ))}
              </div>
            </div>
          </div>
        </section>
        <aside className="agent-panel">
          <div className="agent-header">
            <div>
              <p className="eyebrow">ZAP AGENT</p>
              <h2>AI pair programmer</h2>
            </div>
            <span className="agent-live">● LOCAL</span>
          </div>
          <div className="agent-context">
            <span className="context-icon">✦</span>
            <div>
              <strong>Context ready</strong>
              <small>
                {files.length} files · ~{workspace?.estimatedTokens.toLocaleString() ?? '0'} tokens
              </small>
            </div>
          </div>
          <div className="agent-message">
            <span className="agent-avatar">Z</span>
            <div>
              <strong>How can I help?</strong>
              <p>
                Ask me to inspect your code, explain a file, or draft a change. I’ll show a diff
                before anything is written.
              </p>
            </div>
          </div>
          <div className="suggestion-list">
            <button onClick={() => setPrompt('Explain this file and suggest improvements')}>
              ⌁ <span>Explain this file</span>
              <b>›</b>
            </button>
            <button onClick={() => setPrompt('Find and fix the next issue')}>
              ⌁ <span>Find the next issue</span>
              <b>›</b>
            </button>
            <button onClick={() => setPrompt('Add tests for this module')}>
              ⌁ <span>Add tests for this module</span>
              <b>›</b>
            </button>
          </div>
          <div className="agent-composer">
            <div className="mode-switch">
              <button
                className={agentMode === 'build' ? 'active' : ''}
                onClick={() => setAgentMode('build')}
              >
                Build
              </button>
              <button
                className={agentMode === 'ask' ? 'active' : ''}
                onClick={() => setAgentMode('ask')}
              >
                Ask
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  runPrompt();
                }
              }}
              placeholder={
                agentMode === 'build' ? 'Describe a change to make…' : 'Ask about your code…'
              }
            />
            <div className="composer-footer">
              <span>↵ to send · Shift+↵ for newline</span>
              <button className="send-button" onClick={runPrompt} disabled={!prompt.trim()}>
                ↑
              </button>
            </div>
          </div>
          <div className="agent-safety">
            <span>✓</span>
            <span>Changes require your approval</span>
          </div>
        </aside>
      </div>
      <footer className="statusbar">
        <span>⎇ main</span>
        <span>✓ 0 problems</span>
        <span>UTF-8</span>
        <span>TypeScript React</span>
        <span className="statusbar-spacer" />
        <span>Ln 1, Col 1</span>
        <span>Spaces: 2</span>
        <span>◉ Local workspace</span>
      </footer>
      <div
        className="drop-catcher"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      />
      {workspaceError && <div className="toast-error">{workspaceError}</div>}
      {reviewOpen && (
        <div className="review-backdrop" role="presentation" onClick={() => setReviewOpen(false)}>
          <section
            className="review-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="review-header">
              <div>
                <p className="eyebrow">PROPOSED CHANGE · REVIEW REQUIRED</p>
                <h2 id="review-title">Update {activeFile}</h2>
              </div>
              <button onClick={() => setReviewOpen(false)}>×</button>
            </div>
            <div className="diff-meta">
              <span>src/renderer/{activeFile}</span>
              <span className="diff-count">+2 −1</span>
            </div>
            <div className="diff-view">
              <div className="diff-line removed">
                <span>−</span>
                <code>const mode = 'draft';</code>
              </div>
              <div className="diff-line added">
                <span>+</span>
                <code>const mode = 'approved';</code>
              </div>
              <div className="diff-line added">
                <span>+</span>
                <code>setActivity('Ready for validation');</code>
              </div>
            </div>
            <textarea
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              placeholder="Optional feedback for the agent…"
            />
            <div className="review-footer">
              <span>Original files stay untouched until approval.</span>
              <div>
                <button className="reject-button" onClick={() => void decideReview('rejected')}>
                  Reject
                </button>
                <button className="approve-button" onClick={() => void decideReview('approved')}>
                  Approve &amp; Apply
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
