import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

export interface EditorProps {
  activePath: string;
  content: string;
  busy: boolean;
  error?: string | undefined;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  canEdit: boolean;
  jumpLine?: number | undefined;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onReload: () => void;
}

/** Read view with line numbers plus an explicit manual edit mode. */
export function Editor({
  activePath,
  content,
  busy,
  error,
  editing,
  dirty,
  saving,
  canEdit,
  jumpLine,
  onStartEdit,
  onStopEdit,
  onChange,
  onSave,
  onReload,
}: EditorProps): ReactElement {
  const lines = activePath ? content.split(/\r?\n/) : [];
  const [cursor, setCursor] = useState(1);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    if (!jumpLine) return;
    highlightRef.current?.scrollIntoView({ block: 'center' });
    if (editing) {
      const area = textareaRef.current;
      if (!area) return;
      const offset = lines.slice(0, jumpLine - 1).join('\n').length + (jumpLine > 1 ? 1 : 0);
      area.focus();
      area.setSelectionRange(offset, offset);
    }
    // Scrolling is intentionally tied to an explicit jump request only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpLine, editing]);

  useEffect(() => {
    setCursor(1);
  }, [activePath]);

  if (!activePath)
    return <div className="editor-state">Open a project and choose a file to inspect it.</div>;
  if (busy) return <div className="editor-state">Loading file…</div>;
  if (error) return <div className="editor-state error">Could not read file: {error}</div>;

  if (editing)
    return (
      <div className="code-view editing">
        <textarea
          ref={textareaRef}
          value={content}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              onSave();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              onStopEdit();
            }
          }}
          aria-label={`Editing ${activePath}`}
        />
        <div className="editor-edit-status">
          <span>{dirty ? 'Unsaved changes' : 'No changes'} · Ctrl+S to save · Esc to cancel</span>
          <button type="button" onClick={onSave} disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onStopEdit} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    );

  return (
    <div className="code-view">
      <div className="editor-status-strip">
        <span>
          {lines.length} lines · cursor line {cursor}
          {dirty ? ' · edited (not saved)' : ''}
        </span>
        {canEdit && (
          <button type="button" onClick={onStartEdit}>
            Edit file
          </button>
        )}
        {!canEdit && <span className="muted">Read-only file</span>}
      </div>
      {lines.map((line, index) => (
        <div
          className={jumpLine === index + 1 ? 'code-line highlighted' : 'code-line'}
          key={`${activePath}-${index}`}
          ref={
            jumpLine === index + 1
              ? (node: HTMLDivElement | null) => {
                  highlightRef.current = node;
                }
              : undefined
          }
          onClick={() => setCursor(index + 1)}
        >
          <span className="line-number">{index + 1}</span>
          <code>{line || ' '}</code>
        </div>
      ))}
      <button className="editor-reload-bottom" type="button" onClick={onReload}>
        Reload from disk
      </button>
    </div>
  );
}
