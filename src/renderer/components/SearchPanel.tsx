import { useMemo, useState, type ReactElement } from 'react';
import type { WorkspaceContext } from '../../domain.js';
import type { SearchMatch } from '../../search.js';

export interface SearchPanelProps {
  workspace: WorkspaceContext | null;
  previewMode: boolean;
  previewFiles: Record<string, string[]>;
  onOpenResult: (path: string, line: number) => void;
}

interface GroupedMatch {
  path: string;
  matches: SearchMatch[];
}

function groupMatches(matches: SearchMatch[]): GroupedMatch[] {
  const groups = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const existing = groups.get(match.path);
    if (existing) existing.push(match);
    else groups.set(match.path, [match]);
  }
  return [...groups.entries()].map(([path, items]) => ({ path, matches: items }));
}

function searchPreviewFiles(
  files: Record<string, string[]>,
  query: string,
  caseSensitive: boolean,
  isRegex: boolean,
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  let pattern: RegExp | undefined;
  if (isRegex) {
    try {
      pattern = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch {
      return [];
    }
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  for (const [path, lines] of Object.entries(files)) {
    lines.forEach((line, index) => {
      if (pattern) {
        for (const match of line.matchAll(pattern))
          matches.push({ path, line: index + 1, column: (match.index ?? 0) + 1, text: line });
        return;
      }
      const haystack = caseSensitive ? line : line.toLowerCase();
      let column = haystack.indexOf(needle);
      while (column >= 0) {
        matches.push({ path, line: index + 1, column: column + 1, text: line });
        column = haystack.indexOf(needle, column + Math.max(1, needle.length));
      }
    });
  }
  return matches.slice(0, 400);
}

/** Project-wide text search. Runs locally and never leaves the machine. */
export function SearchPanel({
  workspace,
  previewMode,
  previewFiles,
  onOpenResult,
}: SearchPanelProps): ReactElement {
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => groupMatches(matches), [matches]);

  const runSearch = async (): Promise<void> => {
    if (!query.trim()) {
      setMatches([]);
      setSummary('');
      return;
    }
    setBusy(true);
    try {
      if (previewMode || !workspace) {
        const found = searchPreviewFiles(previewFiles, query, caseSensitive, isRegex);
        setMatches(found);
        setSummary(`${found.length} match(es) in the preview project.`);
        return;
      }
      const result = await window.zap.searchWorkspace(workspace.rootPath, query, {
        caseSensitive,
        isRegex,
      });
      setMatches(result.matches);
      setSummary(
        `${result.matches.length} match(es) in ${result.filesSearched} file(s)` +
          (result.filesSkipped > 0 ? ` · ${result.filesSkipped} skipped` : '') +
          (result.truncated ? ' · results truncated' : ''),
      );
    } catch (error) {
      setMatches([]);
      setSummary(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="utility-panel search-panel">
      <label>SEARCH PROJECT FILES</label>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void runSearch();
        }}
        placeholder="Find text in this project…"
        aria-label="Search text"
      />
      <div className="search-options">
        <label>
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
          />
          <span>Match case</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={isRegex}
            onChange={(event) => setIsRegex(event.target.checked)}
          />
          <span>Regex</span>
        </label>
        <button type="button" onClick={() => void runSearch()} disabled={busy || !query.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </button>
        {busy && !previewMode && (
          <button
            type="button"
            onClick={() => void window.zap.cancelSearch().catch(() => undefined)}
          >
            Stop
          </button>
        )}
      </div>
      {summary && <small>{summary}</small>}
      <div className="search-results">
        {groups.map((group) => (
          <div className="search-group" key={group.path}>
            <button
              type="button"
              className="search-group-head"
              onClick={() => onOpenResult(group.path, group.matches[0]?.line ?? 1)}
            >
              ⌕ {group.path} <b>{group.matches.length}</b>
            </button>
            {group.matches.slice(0, 40).map((match) => (
              <button
                type="button"
                className="search-hit"
                key={`${match.path}-${match.line}-${match.column}`}
                onClick={() => onOpenResult(match.path, match.line)}
              >
                <span className="search-hit-location">
                  {match.line}:{match.column}
                </span>
                <code>{match.text.trim() || '(blank line)'}</code>
              </button>
            ))}
            {group.matches.length > 40 && (
              <small>+{group.matches.length - 40} more in this file</small>
            )}
          </div>
        ))}
        {query.trim() && groups.length === 0 && !busy && (
          <small>No matches yet. Press Enter to search.</small>
        )}
      </div>
    </div>
  );
}
