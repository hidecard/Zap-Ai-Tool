import { useEffect, useState, type ReactElement } from 'react';
import type { ModelDescriptor, ModelManagerState } from '../index.js';

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
  const [loading, setLoading] = useState(true);

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

  const selected = models.find((model) => model.id === state.selectedId);
  const statusLabel =
    state.status === 'ready'
      ? 'Ready'
      : state.status === 'loading'
        ? 'Loading model…'
        : state.status === 'error'
          ? 'Needs attention'
          : 'No model loaded';

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
            <h2>Build with your local model</h2>
            <p>
              Select a model to begin. Zap Ai Tool will understand your project, propose changes,
              and wait for your approval before writing files.
            </p>
            <button className="primary-button" disabled={!selected || state.status === 'loading'}>
              Open project folder
            </button>
          </div>
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
              <p>Folder tree and instructions</p>
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
