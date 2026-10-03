import { useEffect, useState, type DragEvent, type ReactElement } from 'react';
import type { ModelDescriptor, ModelManagerState, WorkspaceContext } from '../index.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function App(): ReactElement {
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [state, setState] = useState<ModelManagerState>({
    available: [],
    selectedId: undefined,
    loadedId: undefined,
    status: 'idle',
    error: undefined,
  });
  const [workspace, setWorkspace] = useState<WorkspaceContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | undefined>();

  const refreshModels = async (): Promise<void> => {
    setLoading(true);
    try {
      const result = await window.zap.listModels();
      setModels(result.models);
      setState(result.state);
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
      setWorkspace(await window.zap.loadWorkspace(rootPath));
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const chooseWorkspace = async (): Promise<void> => {
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
  const visibleFiles = workspace?.files.filter((file) => file.kind === 'file').slice(0, 7) ?? [];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">Z</div>
        <div>
          <p className="eyebrow">LOCAL AI SOFTWARE ENGINEER</p>
          <h1>Zap Ai Tool</h1>
        </div>
        <div className="topbar-spacer" />
        <span className={`status-dot ${state.status}`} />
        <span className="status-text">{statusLabel}</span>
      </header>
      <section className="workspace-grid">
        <aside className="sidebar panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SETTINGS</p>
              <h2>Model Management</h2>
            </div>
            <button
              className="icon-button"
              onClick={() => void refreshModels()}
              title="Refresh models"
            >
              ↻
            </button>
          </div>
          <label className="field-label" htmlFor="model-select">
            Active model
          </label>
          <select
            id="model-select"
            value={state.selectedId ?? ''}
            onChange={(event) => void selectModel(event.target.value)}
            disabled={loading || models.length === 0}
          >
            <option value="">
              {loading
                ? 'Scanning Models…'
                : models.length === 0
                  ? 'No .gguf models found'
                  : 'Choose a model…'}
            </option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          <div className="helper-text">
            Place local <code>.gguf</code> files in the <code>Models/</code> folder.
          </div>
          {selected && (
            <div className="model-card">
              <div className="model-card-title">{selected.name}</div>
              <div className="model-meta">
                <span>GGUF</span>
                <span>{formatBytes(selected.sizeBytes)}</span>
              </div>
              <div className="model-path" title={selected.path}>
                {selected.path}
              </div>
            </div>
          )}
          {state.error && <div className="error-box">{state.error}</div>}
          <div className="sidebar-footer">
            <span className="tiny-label">MODEL DIRECTORY</span>
            <span className="directory">Models/</span>
          </div>
        </aside>
        <section className="main-panel">
          <div className="welcome-card panel">
            <div className="welcome-icon">✦</div>
            <p className="eyebrow">WORKSPACE</p>
            <h2>{workspace ? 'Project context is ready' : 'Build with your local model'}</h2>
            <p>
              {workspace
                ? `Zap Ai Tool indexed ${workspace.files.length} safe entries from your project. Review the context below before starting a task.`
                : 'Select a model and load a project. Zap Ai Tool will understand your project, propose changes, and wait for your approval before writing files.'}
            </p>
            <button
              className="primary-button"
              onClick={() => void chooseWorkspace()}
              disabled={!selected || state.status === 'loading' || workspaceBusy}
            >
              {workspaceBusy ? 'Loading folder…' : 'Choose project folder'}
            </button>
          </div>
          <div
            className="drop-zone panel"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
          >
            <span className="drop-icon">⇩</span>
            <div>
              <strong>Drag and drop a project folder</strong>
              <span>or choose a folder using the button above</span>
            </div>
          </div>
          {workspace && (
            <div className="context-card panel">
              <div className="context-heading">
                <div>
                  <p className="eyebrow">PROJECT CONTEXT</p>
                  <h3 title={workspace.rootPath}>{workspace.rootPath}</h3>
                </div>
                <span className="token-count">
                  ~{workspace.estimatedTokens.toLocaleString()} tokens
                </span>
              </div>
              <div className="context-files">
                {visibleFiles.map((file) => (
                  <div className="context-file" key={file.relativePath}>
                    <span>◇</span>
                    <span>{file.relativePath}</span>
                    <span>{formatBytes(file.sizeBytes)}</span>
                  </div>
                ))}
                {workspace.files.filter((file) => file.kind === 'file').length >
                  visibleFiles.length && (
                  <div className="context-more">
                    +{' '}
                    {workspace.files.filter((file) => file.kind === 'file').length -
                      visibleFiles.length}{' '}
                    more files
                  </div>
                )}
              </div>
            </div>
          )}
          {workspaceError && <div className="error-box">{workspaceError}</div>}
          <div className="module-row">
            <div className="module-card panel">
              <span className="module-number">01</span>
              <h3>Model Management</h3>
              <p>
                {models.length} local model{models.length === 1 ? '' : 's'} discovered
              </p>
            </div>
            <div className="module-card panel">
              <span className="module-number">02</span>
              <h3>Project Context</h3>
              <p>
                {workspace
                  ? `${workspace.files.length} safe entries indexed`
                  : 'Folder tree and instructions'}
              </p>
            </div>
            <div className="module-card panel">
              <span className="module-number">03</span>
              <h3>Human Review</h3>
              <p>Diffs before every change</p>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
