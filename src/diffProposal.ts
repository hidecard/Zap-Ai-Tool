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
