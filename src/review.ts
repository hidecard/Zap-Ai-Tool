import type { FileDiff } from './domain.js';

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
  selected: boolean;
}

export interface FileReview {
  path: string;
  before: string;
  after: string;
  selected: boolean;
  hunks: DiffHunk[];
}

export interface ReviewSelection {
  path: string;
  selected?: boolean;
  hunkIds?: string[];
}

function splitLines(value: string): string[] {
  return value === '' ? [] : value.split(/\r?\n/);
}

/**
 * Creates review units without applying anything. A hunk is a contiguous run
 * of changed lines, padded with one unchanged line for useful review context.
 */
export function createFileReviews(diffs: FileDiff[]): FileReview[] {
  return diffs.map((diff) => {
    const before = splitLines(diff.before);
    const after = splitLines(diff.after);
    const max = Math.max(before.length, after.length);
    const changed: number[] = [];
    for (let index = 0; index < max; index += 1) {
      if (before[index] !== after[index]) changed.push(index);
    }
    if (changed.length === 0) {
      return { ...diff, selected: false, hunks: [] };
    }
    const ranges: Array<[number, number]> = [];
    for (const index of changed) {
      const start = Math.max(0, index - 1);
      const end = Math.min(max - 1, index + 1);
      const previous = ranges.at(-1);
      if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
      else ranges.push([start, end]);
    }
    const hunks = ranges.map(([start, end], hunkIndex) => {
      const content: string[] = [];
      for (let index = start; index <= end; index += 1) {
        const oldLine = before[index];
        const newLine = after[index];
        if (oldLine === newLine && oldLine !== undefined) content.push(` ${oldLine}`);
        else {
          if (oldLine !== undefined) content.push(`-${oldLine}`);
          if (newLine !== undefined) content.push(`+${newLine}`);
        }
      }
      return {
        id: `${diff.path}#${hunkIndex + 1}`,
        oldStart: start + 1,
        oldLines: Math.min(before.length - start, end - start + 1),
        newStart: start + 1,
        newLines: Math.min(after.length - start, end - start + 1),
        content: content.join('\n'),
        selected: true,
      };
    });
    return { ...diff, selected: true, hunks };
  });
}

/** Returns only whole-file approved diffs. Hunk selections are review metadata. */
export function selectReviewedDiffs(
  reviews: FileReview[],
  selections: ReviewSelection[],
): FileDiff[] {
  const selectedByPath = new Map(selections.map((selection) => [selection.path, selection]));
  return reviews
    .filter((review) => {
      const selection = selectedByPath.get(review.path);
      return selection?.selected ?? review.selected;
    })
    .map(({ path, before, after }) => ({ path, before, after }));
}
