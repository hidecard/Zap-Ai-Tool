import { useMemo, type ReactElement } from 'react';
import { diffLines } from '../../diff.js';
import type { ReviewSelections } from '../../review.js';
import type { FileDiff } from '../../domain.js';
import { DiffFile } from './DiffFile.js';

export type { ReviewSelections };

export interface ReviewDialogProps {
  title: string;
  subtitle: string;
  diffs: FileDiff[];
  selections: ReviewSelections;
  readOnly?: boolean;
  busy?: boolean;
  feedback: string;
  statusLine?: string;
  onSelectFile: (path: string, selected: boolean) => void;
  onSetHunkSelection: (path: string, hunkIds: string[]) => void;
  onSelectAllFiles: (selected: boolean) => void;
  onFeedbackChange: (feedback: string) => void;
  onApply: () => void;
  onReject: () => void;
  onClose: () => void;
}

/** Full-screen review surface: pick files, pick hunks, then approve explicitly. */
export function ReviewDialog({
  title,
  subtitle,
  diffs,
  selections,
  readOnly = false,
  busy = false,
  feedback,
  statusLine,
  onSelectFile,
  onSetHunkSelection,
  onSelectAllFiles,
  onFeedbackChange,
  onApply,
  onReject,
  onClose,
}: ReviewDialogProps): ReactElement {
  const computed = useMemo(
    () =>
      diffs.map((diff) => {
        const hunks = diffLines(diff.before, diff.after).hunks;
        return { diff, ids: hunks.map((hunk) => hunk.id) };
      }),
    [diffs],
  );
  const activePath = computed.find(({ diff }) => {
    const state = selections[diff.path];
    return state?.selected !== false;
  })?.diff.path;

  const selectedFiles = computed.filter(({ diff }) => selections[diff.path]?.selected !== false);
  const selectedHunks = selectedFiles.reduce((total, { diff, ids }) => {
    const state = selections[diff.path];
    return total + (state?.hunkIds ?? ids).length;
  }, 0);

  return (
    <div className="review-backdrop" role="presentation" onClick={() => !busy && onClose()}>
      <section
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="review-header">
          <div>
            <p className="eyebrow">{subtitle}</p>
            <h2 id="review-title">{title}</h2>
          </div>
          <button onClick={onClose} disabled={busy} type="button">
            ×
          </button>
        </div>
        <div className="review-files-layout">
          <div className="review-file-list" aria-label="Files in proposed change">
            {!readOnly && (
              <label className="review-file-row select-all">
                <input
                  type="checkbox"
                  checked={selectedFiles.length === diffs.length}
                  onChange={(event) => onSelectAllFiles(event.target.checked)}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => onSelectAllFiles(selectedFiles.length !== diffs.length)}
                >
                  <span>All files</span>
                </button>
              </label>
            )}
            {computed.map(({ diff, ids }) => {
              const state = selections[diff.path];
              const selected = state?.selected !== false;
              const hunkIds = new Set(state?.hunkIds ?? ids);
              return (
                <div
                  className={selected ? 'review-file-row selected' : 'review-file-row'}
                  key={diff.path}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => onSelectFile(diff.path, event.target.checked)}
                    aria-label={`Include ${diff.path}`}
                    disabled={busy || readOnly}
                  />
                  <button
                    className={activePath === diff.path ? 'active' : ''}
                    onClick={() => onSelectFile(diff.path, true)}
                    disabled={busy}
                    type="button"
                  >
                    <span>{diff.path}</span>
                    {diff.isNew && <small>NEW</small>}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="review-file-detail">
            {computed
              .filter(({ diff }) => (selections[diff.path]?.selected !== false ? true : false))
              .map(({ diff, ids }) => {
                const state = selections[diff.path];
                const selectedHunkIds = new Set(state?.hunkIds ?? ids);
                return (
                  <DiffFile
                    key={diff.path}
                    diff={diff}
                    readOnly={readOnly}
                    selectedHunkIds={selectedHunkIds}
                    onToggleHunk={
                      readOnly
                        ? undefined
                        : (hunkId) => {
                            const next = new Set(selectedHunkIds);
                            if (next.has(hunkId)) next.delete(hunkId);
                            else next.add(hunkId);
                            onSetHunkSelection(diff.path, [...next]);
                          }
                    }
                    onToggleAll={
                      readOnly
                        ? undefined
                        : (select) => {
                            if (select) onSelectFile(diff.path, true);
                            onSetHunkSelection(diff.path, select ? ids : []);
                          }
                    }
                  />
                );
              })}
            {diffs.length === 0 && <p className="diff-empty">Nothing to review.</p>}
          </div>
        </div>
        {!readOnly && (
          <textarea
            value={feedback}
            onChange={(event) => onFeedbackChange(event.target.value)}
            placeholder="Optional feedback for the agent…"
            disabled={busy}
          />
        )}
        <div className="review-footer">
          <span>
            {readOnly
              ? (statusLine ?? 'Read-only view of the working tree.')
              : `${selectedFiles.length} of ${diffs.length} file(s), ${selectedHunks} hunk(s) selected · nothing is written until you approve.`}
          </span>
          <div>
            {readOnly ? (
              <button type="button" className="approve-button" onClick={onClose}>
                Close
              </button>
            ) : (
              <>
                <button className="reject-button" type="button" onClick={onReject} disabled={busy}>
                  Reject
                </button>
                <button
                  className="approve-button"
                  type="button"
                  onClick={onApply}
                  disabled={busy || selectedFiles.length === 0 || selectedHunks === 0}
                >
                  {busy ? 'Applying…' : 'Approve & Apply'}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
