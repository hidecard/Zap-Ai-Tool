export type DiffRowKind = 'context' | 'added' | 'removed' | 'changed';

export interface DiffRow {
  kind: DiffRowKind;
  oldLine: number | undefined;
  oldText: string | undefined;
  newLine: number | undefined;
  newText: string | undefined;
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  rows: DiffRow[];
  selected: boolean;
}

export interface LineDiff {
  rows: DiffRow[];
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  identical: boolean;
}

/** Split file content into comparable lines, tolerating CRLF and a missing final newline. */
export function splitDiffLines(value: string): string[] {
  return value === '' ? [] : value.split(/\r?\n/);
}

const MAX_MATRIX_CELLS = 4_000_000;

interface Change {
  kind: 'equal' | 'removed' | 'added';
  oldIndex: number | undefined;
  newIndex: number | undefined;
}

/**
 * Longest-common-subsequence alignment of two line arrays. Falls back to a
 * single replace block when the inputs are too large for an exact matrix so
 * review never becomes unbounded in memory.
 */
function alignLines(oldLines: string[], newLines: string[]): Change[] {
  const oldCount = oldLines.length;
  const newCount = newLines.length;
  if (oldCount === 0 || newCount === 0 || oldCount * newCount > MAX_MATRIX_CELLS) {
    const changes: Change[] = [];
    for (let index = 0; index < oldCount; index += 1)
      changes.push({ kind: 'removed', oldIndex: index, newIndex: undefined });
    for (let index = 0; index < newCount; index += 1)
      changes.push({ kind: 'added', oldIndex: undefined, newIndex: index });
    return changes;
  }

  const width = newCount + 1;
  const table = new Uint32Array((oldCount + 1) * width);
  for (let oldIndex = oldCount - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newCount - 1; newIndex >= 0; newIndex -= 1) {
      const offset = oldIndex * width + newIndex;
      table[offset] =
        oldLines[oldIndex] === newLines[newIndex]
          ? (table[offset + width + 1] ?? 0) + 1
          : Math.max(table[offset + width] ?? 0, table[offset + 1] ?? 0);
    }
  }

  const changes: Change[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldCount && newIndex < newCount) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      changes.push({ kind: 'equal', oldIndex, newIndex });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    const down = table[(oldIndex + 1) * width + newIndex] ?? 0;
    const right = table[oldIndex * width + newIndex + 1] ?? 0;
    if (down >= right) {
      changes.push({ kind: 'removed', oldIndex, newIndex: undefined });
      oldIndex += 1;
    } else {
      changes.push({ kind: 'added', oldIndex: undefined, newIndex });
      newIndex += 1;
    }
  }
  while (oldIndex < oldCount) {
    changes.push({ kind: 'removed', oldIndex, newIndex: undefined });
    oldIndex += 1;
  }
  while (newIndex < newCount) {
    changes.push({ kind: 'added', oldIndex: undefined, newIndex });
    newIndex += 1;
  }
  return changes;
}

/** Pairs adjacent removed/added runs into single side-by-side rows. */
function toRows(oldLines: string[], newLines: string[], changes: Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < changes.length) {
    const change = changes[index];
    if (change?.kind === 'equal') {
      rows.push({
        kind: 'context',
        oldLine: (change.oldIndex ?? 0) + 1,
        oldText: oldLines[change.oldIndex ?? 0],
        newLine: (change.newIndex ?? 0) + 1,
        newText: newLines[change.newIndex ?? 0],
      });
      index += 1;
      continue;
    }
    const removed: number[] = [];
    const added: number[] = [];
    while (index < changes.length && changes[index]?.kind === 'removed') {
      removed.push(changes[index]?.oldIndex ?? 0);
      index += 1;
    }
    while (index < changes.length && changes[index]?.kind === 'added') {
      added.push(changes[index]?.newIndex ?? 0);
      index += 1;
    }
    const pairs = Math.max(removed.length, added.length);
    for (let pair = 0; pair < pairs; pair += 1) {
      const oldIndex = removed[pair];
      const newIndex = added[pair];
      const oldText = oldIndex === undefined ? undefined : oldLines[oldIndex];
      const newText = newIndex === undefined ? undefined : newLines[newIndex];
      const kind: DiffRowKind =
        oldText !== undefined && newText !== undefined
          ? 'changed'
          : oldText !== undefined
            ? 'removed'
            : 'added';
      rows.push({
        kind,
        oldLine: oldIndex === undefined ? undefined : oldIndex + 1,
        oldText,
        newLine: newIndex === undefined ? undefined : newIndex + 1,
        newText,
      });
    }
  }
  return rows;
}

function hunkRanges(rows: DiffRow[], contextLines: number): Array<[number, number]> {
  const changed = rows
    .map((row, index) => (row.kind === 'context' ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  for (const index of changed) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(rows.length - 1, index + contextLines);
    const previous = ranges.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else ranges.push([start, end]);
  }
  return ranges;
}

export function formatHunkHeader(
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
): string {
  return `@@ -${oldStart},${oldLines} +${newStart},${newLines} @@`;
}

/** Computes a line-level diff with selectable, context-padded hunks. */
export function diffLines(before: string, after: string, contextLines = 3): LineDiff {
  const oldLines = splitDiffLines(before);
  const newLines = splitDiffLines(after);
  const rows = toRows(oldLines, newLines, alignLines(oldLines, newLines));
  const additions = rows.filter((row) => row.kind === 'added' || row.kind === 'changed').length;
  const deletions = rows.filter((row) => row.kind === 'removed' || row.kind === 'changed').length;
  const hunks: DiffHunk[] = [];
  for (const [start, end] of hunkRanges(rows, contextLines)) {
    const slice = rows.slice(start, end + 1);
    const oldNumbers = slice.flatMap((row) => (row.oldLine === undefined ? [] : [row.oldLine]));
    const newNumbers = slice.flatMap((row) => (row.newLine === undefined ? [] : [row.newLine]));
    const oldStart = oldNumbers[0] ?? 1;
    const newStart = newNumbers[0] ?? 1;
    hunks.push({
      id: `hunk-${hunks.length + 1}`,
      oldStart,
      oldLines: oldNumbers.length,
      newStart,
      newLines: newNumbers.length,
      header: formatHunkHeader(oldStart, oldNumbers.length, newStart, newNumbers.length),
      rows: slice,
      selected: true,
    });
  }
  return { rows, hunks, additions, deletions, identical: before === after };
}

/**
 * Rebuilds file content from `before` keeping only the selected hunks. Each
 * hunk range is defined against `before`, so unselected hunks keep their
 * original lines exactly.
 */
export function applySelectedHunks(
  before: string,
  hunks: DiffHunk[],
  selectedIds: ReadonlySet<string>,
): string {
  const source = splitDiffLines(before);
  const ordered = hunks
    .slice()
    .sort((left, right) => left.oldStart - right.oldStart || left.newStart - right.newStart);
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of ordered) {
    const start = Math.max(0, Math.min(source.length, hunk.oldStart - 1));
    if (start > cursor) output.push(...source.slice(cursor, start));
    if (selectedIds.has(hunk.id)) {
      const oldLength = hunk.rows.filter((row) => row.oldLine !== undefined).length;
      const replacement = hunk.rows
        .filter((row) => row.kind !== 'removed')
        .flatMap((row) => (row.newText === undefined ? [] : [row.newText]));
      output.push(...replacement);
      cursor = start + oldLength;
    } else {
      cursor = start;
    }
  }
  output.push(...source.slice(cursor));
  return output.join('\n');
}

/** Adds or removes only the selected hunks from a proposed change. */
export function applySelectedHunksToChange(
  diff: { before: string; after: string },
  hunks: DiffHunk[],
  selectedIds: ReadonlySet<string>,
): { before: string; after: string } {
  return {
    before: diff.before,
    after: applySelectedHunks(diff.before, hunks, selectedIds),
  };
}
