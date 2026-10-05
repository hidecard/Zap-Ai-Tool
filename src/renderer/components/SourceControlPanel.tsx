import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { WorkspaceContext } from '../../domain.js';
import type { GitStatusEntry } from '../../git.js';

export interface SourceControlPanelProps {
  workspace: WorkspaceContext | null;
  previewMode: boolean;
  changedFiles: string[];
  pendingCount: number;
  canUndo: boolean;
  busy: boolean;
  onOpenPending: () => void;
  onOpenGitDiff: (path: string) => void;
  onUndo: () => void;
}

const STATUS_LABEL: Record<GitStatusEntry['status'], string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  conflicted: '!',
  typechange: 'T',
};

export function SourceControlPanel({
  workspace,
  previewMode,
  changedFiles,
  pendingCount,
  canUndo,
  busy,
  onOpenPending,
  onOpenGitDiff,
  onUndo,
}: SourceControlPanelProps): ReactElement {
  const [entries, setEntries] = useState<GitStatusEntry[]>([]);
  const [branch, setBranch] = useState<string | undefined>();
  const [message, setMessage] = useState<string>('');
  const [gitBusy, setGitBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (previewMode || !workspace) {
      setEntries([]);
      setMessage('Open a project to read Git status.');
      return;
    }
    setGitBusy(true);
    try {
      const snapshot = await window.zap.gitStatus(workspace.rootPath);
      setEntries(snapshot.entries);
      setBranch(snapshot.branch);
      setMessage(snapshot.available ? '' : (snapshot.message ?? ''));
    } catch (error) {
      setEntries([]);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGitBusy(false);
    }
  }, [previewMode, workspace?.rootPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="utility-panel source-panel">
      <label>SOURCE CONTROL</label>
      {branch && (
        <div className="setting-row">
          <span>Branch</span>
          <b>{branch}</b>
        </div>
      )}
      {pendingCount > 0 && (
        <button className="change-row pending-change" type="button" onClick={onOpenPending}>
          <span>R</span>
          <span>{pendingCount} change(s) awaiting review</span>
          <b>REVIEW</b>
        </button>
      )}
      {changedFiles.map((path) => (
        <div className="change-row" key={`applied-${path}`}>
          <span>M</span>
          <span>{path}</span>
          <b>APPLIED</b>
        </div>
      ))}
      {canUndo && (
        <button className="settings-action" type="button" onClick={onUndo} disabled={busy}>
          Undo last change
        </button>
      )}
      <div className="setting-row">
        <span>Working tree</span>
        <b>
          <button className="settings-action inline" type="button" onClick={() => void refresh()}>
            {gitBusy ? 'Reading…' : 'Refresh'}
          </button>
        </b>
      </div>
      {message && <small className="inline-error">{message}</small>}
      <div className="git-list">
        {entries.map((entry) => (
          <button
            className="change-row git-row"
            type="button"
            key={entry.path}
            onClick={() => onOpenGitDiff(entry.path)}
          >
            <span className={entry.status}>{STATUS_LABEL[entry.status]}</span>
            <span>{entry.path}</span>
            <b>{entry.staged ? 'STAGED' : 'UNSTAGED'}</b>
          </button>
        ))}
        {!previewMode && workspace && entries.length === 0 && !gitBusy && !message && (
          <small>No Git changes in this project.</small>
        )}
      </div>
      <small>Only reviewed and approved changes are written to disk.</small>
    </div>
  );
}
