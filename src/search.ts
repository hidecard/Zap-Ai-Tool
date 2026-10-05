import { isProtectedWorkspacePath } from './pathSafety.js';
import { readWorkspaceFile } from './tools.js';
import type { WorkspaceFile } from './domain.js';

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchOptions {
  caseSensitive?: boolean;
  isRegex?: boolean;
  maxResults?: number;
  maxFileBytes?: number;
  signal?: AbortSignal;
  contextLines?: number;
}

export interface SearchOutcome {
  query: string;
  matches: SearchMatch[];
  filesSearched: number;
  filesSkipped: number;
  truncated: boolean;
}

const DEFAULT_MAX_RESULTS = 400;
const DEFAULT_MAX_FILE_BYTES = 1_000_000;
const MAX_CONTEXT_LINE = 400;
const WORKERS = 8;

export class SearchCancelledError extends Error {
  constructor() {
    super('Search cancelled.');
    this.name = 'SearchCancelledError';
  }
}

function buildMatcher(
  query: string,
  options: SearchOptions,
): (line: string) => Array<{ column: number; length: number }> {
  if (options.isRegex) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(query, options.caseSensitive ? 'g' : 'gi');
    } catch {
      throw new Error(`Invalid regular expression: ${query}`);
    }
    return (line) => {
      const hits: Array<{ column: number; length: number }> = [];
      for (const match of line.matchAll(pattern)) {
        if (match.index === undefined) continue;
        hits.push({ column: match.index + 1, length: Math.max(1, match[0].length) });
        if (hits.length >= 50) break;
      }
      return hits;
    };
  }
  const needle = options.caseSensitive ? query : query.toLowerCase();
  return (line) => {
    const haystack = options.caseSensitive ? line : line.toLowerCase();
    const hits: Array<{ column: number; length: number }> = [];
    let from = 0;
    for (;;) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      hits.push({ column: index + 1, length: needle.length });
      from = index + Math.max(1, needle.length);
      if (hits.length >= 50) break;
    }
    return hits;
  };
}

function looksBinary(content: string): boolean {
  return content.includes('\u0000');
}

/**
 * Full-text search across the indexed workspace files. Protected paths and
 * binary or oversized files are skipped instead of failing the whole search.
 */
export async function searchWorkspaceFiles(
  workspaceRoot: string,
  files: WorkspaceFile[],
  query: string,
  options: SearchOptions = {},
): Promise<SearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { query, matches: [], filesSearched: 0, filesSkipped: 0, truncated: false };
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const matchLine = buildMatcher(trimmed, options);
  const matches: SearchMatch[] = [];
  let filesSearched = 0;
  let filesSkipped = 0;
  let truncated = false;

  const candidates = files.filter(
    (file) => file.kind === 'file' && !isProtectedWorkspacePath(file.relativePath),
  );
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (truncated) return;
      if (options.signal?.aborted) throw new SearchCancelledError();
      const file = candidates[cursor];
      cursor += 1;
      if (!file) return;
      let content: string;
      try {
        content = await readWorkspaceFile(workspaceRoot, file.relativePath, maxFileBytes);
      } catch {
        filesSkipped += 1;
        continue;
      }
      if (looksBinary(content)) {
        filesSkipped += 1;
        continue;
      }
      filesSearched += 1;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        for (const hit of matchLine(line)) {
          if (matches.length >= maxResults) {
            truncated = true;
            return;
          }
          matches.push({
            path: file.relativePath,
            line: index + 1,
            column: hit.column,
            text: line.length > MAX_CONTEXT_LINE ? `${line.slice(0, MAX_CONTEXT_LINE)}…` : line,
          });
        }
      }
    }
  };

  const workers = Array.from({ length: Math.min(WORKERS, candidates.length) }, () => worker());
  await Promise.all(workers);
  matches.sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.line - right.line || left.column - right.column,
  );
  return { query: trimmed, matches, filesSearched, filesSkipped, truncated };
}
