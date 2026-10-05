import type { FileDiff } from './domain.js';

function parseCandidate(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? raw.trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

export function parseFileDiffProposal(raw: string, expectedPath?: string): FileDiff | undefined {
  const value = parseCandidate(raw);
  if (!value || typeof value !== 'object') return undefined;
  const proposal = value as { path?: unknown; before?: unknown; after?: unknown };
  if (
    typeof proposal.path !== 'string' ||
    typeof proposal.before !== 'string' ||
    typeof proposal.after !== 'string' ||
    proposal.path.trim() === '' ||
    (expectedPath !== undefined && proposal.path !== expectedPath)
  )
    return undefined;
  return { path: proposal.path, before: proposal.before, after: proposal.after };
}

function normalizeProposalPath(value: string): string | undefined {
  const path = value.replaceAll('\\', '/').trim();
  if (
    !path ||
    path.startsWith('/') ||
    /^[a-z]:/i.test(path) ||
    path.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    return undefined;
  const segments = path.split('/');
  const basename = segments.at(-1)?.toLowerCase() ?? '';
  if (
    segments.some((segment) =>
      ['.zap-backups', '.git', 'node_modules', 'dist', 'build', 'target'].includes(
        segment.toLowerCase(),
      ),
    ) ||
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename === 'id_rsa' ||
    basename === 'id_ed25519'
  )
    return undefined;
  return path;
}

/** Parses at most eight whole-file edits. Paths are normalized and constrained to the workspace. */
export function parseFileDiffProposals(raw: string): FileDiff[] | undefined {
  const value = parseCandidate(raw);
  if (!value || typeof value !== 'object') return undefined;

  const object = value as { diffs?: unknown; path?: unknown; before?: unknown; after?: unknown };
  const candidates = Array.isArray(object.diffs)
    ? object.diffs
    : 'path' in object
      ? [object]
      : undefined;
  if (!candidates || candidates.length === 0 || candidates.length > 8) return undefined;

  const seen = new Set<string>();
  const diffs: FileDiff[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') return undefined;
    const diff = candidate as {
      path?: unknown;
      before?: unknown;
      after?: unknown;
      isNew?: unknown;
    };
    if (
      typeof diff.path !== 'string' ||
      typeof diff.before !== 'string' ||
      typeof diff.after !== 'string' ||
      typeof diff.isNew !== 'boolean'
    )
      return undefined;
    const path = normalizeProposalPath(diff.path);
    if (!path || seen.has(path.toLowerCase())) return undefined;
    seen.add(path.toLowerCase());
    if (diff.before === diff.after) continue;
    diffs.push({ path, before: diff.before, after: diff.after, isNew: diff.isNew });
  }
  return diffs.length === 0 ? undefined : diffs;
}
