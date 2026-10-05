import { useMemo, useState, type ReactElement } from 'react';
import { diffLines } from '../../diff.js';
import type { FileDiff } from '../../domain.js';

const MAX_RENDERED_ROWS = 2_000;
const CONTEXT_ROWS = 1_500;

export interface DiffFileProps {
  diff: FileDiff;
  selectedHunkIds: ReadonlySet<string>;
  onToggleHunk?: ((hunkId: string) => void) | undefined;
  onToggleAll?: ((select: boolean) => void) | undefined;
  readOnly?: boolean;
}

/**
 * Side-by-side line diff with selectable hunks. Nothing here touches disk:
 * a selection only decides which hunks are handed to the approval step.
 */
export function DiffFile({
  diff,
  selectedHunkIds,
  onToggleHunk,
  onToggleAll,
  readOnly = false,
}: DiffFileProps): ReactElement {
  const computed = useMemo(() => diffLines(diff.before, diff.after), [diff.after, diff.before]);
  const [expanded, setExpanded] = useState(false);
  const allIds = useMemo(() => computed.hunks.map((hunk) => hunk.id), [computed.hunks]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedHunkIds.has(id));
  const renderedRows = expanded
    ? computed.rows.length
    : Math.min(CONTEXT_ROWS, computed.rows.length);
  const hiddenRows = computed.rows.length - renderedRows;

  return (
    <div className="diff-file">
      <div className="diff-file-toolbar">
        <label className="diff-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => onToggleAll?.(event.target.checked)}
            disabled={readOnly || computed.hunks.length === 0}
          />
          <span>{allSelected ? 'Unselect all hunks' : 'Select all hunks'}</span>
        </label>
        <span className="diff-stat added">+{computed.additions}</span>
        <span className="diff-stat removed">−{computed.deletions}</span>
        <span className="diff-stat">{computed.hunks.length} hunk(s)</span>
        {hiddenRows > 0 && (
          <button
            type="button"
            className="diff-expand"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? 'Collapse long diff' : `Show all ${computed.rows.length} lines`}
          </button>
        )}
      </div>
      <div className="diff-columns-head">
        <span>Before</span>
        <span>After</span>
      </div>
      <div className="diff-rows">
        {computed.hunks.length === 0 && (
          <p className="diff-empty">This file has no textual change.</p>
        )}
        {computed.hunks.map((hunk) => {
          const selected = selectedHunkIds.has(hunk.id);
          const truncated = !expanded && hunk.rows.length > CONTEXT_ROWS;
          const rows = truncated ? hunk.rows.slice(0, CONTEXT_ROWS) : hunk.rows;
          const added = hunk.rows.filter((row) => row.kind !== 'removed').length;
          const removed = hunk.rows.filter((row) => row.kind !== 'added').length;
          return (
            <section className={selected ? 'diff-hunk selected' : 'diff-hunk'} key={hunk.id}>
              <header className="diff-hunk-header">
                {!readOnly && (
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleHunk?.(hunk.id)}
                    aria-label={`Include hunk ${hunk.id}`}
                  />
                )}
                <code>{hunk.header}</code>
                <b>
                  +{added} −{removed}
                </b>
              </header>
              {rows.map((row, index) => (
                <div className={`diff-row ${row.kind}`} key={`${hunk.id}-${index}`}>
                  <span className="diff-ln">{row.oldLine ?? ''}</span>
                  <code className="diff-cell old">{row.oldText ?? ''}</code>
                  <span className="diff-ln">{row.newLine ?? ''}</span>
                  <code className="diff-cell new">{row.newText ?? ''}</code>
                </div>
              ))}
              {truncated && (
                <p className="diff-truncated">
                  {(hunk.rows.length - CONTEXT_ROWS).toLocaleString()} more lines hidden · expand
                  the diff to review every line.
                </p>
              )}
            </section>
          );
        })}
        {hiddenRows > 0 && computed.rows.length > MAX_RENDERED_ROWS && (
          <p className="diff-truncated">
            Very large diff: {computed.rows.length.toLocaleString()} lines total.
          </p>
        )}
      </div>
    </div>
  );
}
