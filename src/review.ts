import type { FileDiff } from './domain.js';
import { applySelectedHunks, diffLines, type DiffRow } from './diff.js';

export interface ReviewHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  rows: DiffRow[];
  selected: boolean;
}

export interface FileReview {
  path: string;
  before: string;
  after: string;
  isNew?: boolean;
  selected: boolean;
  hunks: ReviewHunk[];
}

export interface ReviewSelection {
  path: string;
  selected?: boolean;
  hunkIds?: string[];
}

/** Per-file review state used by the renderer while a batch is being reviewed. */
export interface FileReviewSelection {
  selected: boolean;
  hunkIds: string[];
}

export type ReviewSelections = Record<string, FileReviewSelection>;

/** Starts every proposed file and hunk selected, which is the safe default. */
export function createReviewSelections(diffs: FileDiff[]): ReviewSelections {
  const selections: ReviewSelections = {};
  for (const diff of diffs)
    selections[diff.path] = {
      selected: true,
      hunkIds: diffLines(diff.before, diff.after).hunks.map((hunk) => hunk.id),
    };
  return selections;
}

/**
 * Turns review state into the diffs that may be written. Unselected files and
 * hunks never reach this list, and a hunk selection cannot alter the recorded
 * before-content used for the disk conflict check.
 */
export function narrowReviewedDiffs(diffs: FileDiff[], selections: ReviewSelections): FileDiff[] {
  const narrowed: FileDiff[] = [];
  for (const diff of diffs) {
    const selection = selections[diff.path];
    if (selection?.selected === false) continue;
    const hunks = diffLines(diff.before, diff.after).hunks;
    const ids = selection?.hunkIds ?? hunks.map((hunk) => hunk.id);
    if (ids.length === 0) continue;
    const after = applySelectedHunks(diff.before, hunks, new Set(ids));
    if (after === diff.before) continue;
    narrowed.push({
      path: diff.path,
      before: diff.before,
      after,
      ...(diff.isNew === undefined ? {} : { isNew: diff.isNew }),
    });
  }
  return narrowed;
}

function hunkContent(rows: DiffRow[]): string {
  return rows
    .map((row) => {
      if (row.kind === 'context') return ` ${row.oldText ?? ''}`;
      if (row.kind === 'removed') return `-${row.oldText ?? ''}`;
      if (row.kind === 'added') return `+${row.newText ?? ''}`;
      return `-${row.oldText ?? ''}\n+${row.newText ?? ''}`;
    })
    .join('\n');
}

/**
 * Creates review units without applying anything. A hunk is a contiguous run
 * of changed lines, padded with unchanged lines for useful review context.
 */
export function createFileReviews(diffs: FileDiff[]): FileReview[] {
  return diffs.map((diff) => {
    const computed = diffLines(diff.before, diff.after);
    const hunks: ReviewHunk[] = computed.hunks.map((hunk) => ({
      id: `${diff.path}#${hunk.id}`,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      content: hunkContent(hunk.rows),
      rows: hunk.rows,
      selected: true,
    }));
    if (hunks.length === 0)
      return {
        path: diff.path,
        before: diff.before,
        after: diff.after,
        ...(diff.isNew === undefined ? {} : { isNew: diff.isNew }),
        selected: false,
        hunks,
      };
    return {
      path: diff.path,
      before: diff.before,
      after: diff.after,
      ...(diff.isNew === undefined ? {} : { isNew: diff.isNew }),
      selected: true,
      hunks,
    };
  });
}

/**
 * Resolves human review choices into the diffs that may be written. Hunk
 * selections produce a narrowed `after` content; unselected files are dropped.
 */
export function selectReviewedDiffs(
  reviews: FileReview[],
  selections: ReviewSelection[],
): FileDiff[] {
  const selectedByPath = new Map(selections.map((selection) => [selection.path, selection]));
  const diffs: FileDiff[] = [];
  for (const review of reviews) {
    const selection = selectedByPath.get(review.path);
    if (!(selection?.selected ?? review.selected)) continue;
    const original = diffLines(review.before, review.after);
    const after =
      selection?.hunkIds === undefined
        ? review.after
        : applySelectedHunks(
            review.before,
            original.hunks.map((hunk) => ({ ...hunk, id: `${review.path}#${hunk.id}` })),
            new Set(selection.hunkIds),
          );
    if (after === review.before) continue;
    diffs.push({
      path: review.path,
      before: review.before,
      after,
      ...(review.isNew === undefined ? {} : { isNew: review.isNew }),
    });
  }
  return diffs;
}
