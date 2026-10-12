import type { Candidate } from '@/shared/types';

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value: string) {
  return new Set(normalize(value).split(' ').filter((token) => token.length > 1));
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
}

function idOf(selector: string) {
  const match = selector.match(/#([A-Za-z][\w-]*)/);
  return match?.[1] ?? '';
}

export function scoreCandidate(label: string, selector: string, candidate: Candidate) {
  const recordedId = idOf(selector);
  const candidateId = idOf(candidate.selector);
  if (recordedId && recordedId === candidateId) return 1;

  const recorded = normalize(label);
  const found = normalize(candidate.label);
  if (recorded && recorded === found) return 1;

  const overlap = jaccard(tokens(label), tokens(candidate.label));
  const contains =
    recorded && found && (found.includes(recorded) || recorded.includes(found)) ? 0.15 : 0;
  return Math.min(1, overlap + contains);
}

export function rankCandidates(label: string, selector: string, candidates: Candidate[]) {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(label, selector, candidate),
    }))
    .sort((left, right) => right.score - left.score);

  const [best, second] = ranked;
  const auto =
    best && best.score >= 0.78 && (!second || best.score - second.score >= 0.18) ? best : null;

  return {
    auto,
    ranked: ranked.slice(0, 6),
  };
}

export function parseModelChoice(text: string, selectors: string[]) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { selector?: unknown; reason?: unknown };
    const selector = String(data.selector ?? '');
    if (!selectors.includes(selector)) return null;
    return {
      selector,
      reason: String(data.reason ?? 'The model chose this control.'),
    };
  } catch {
    return null;
  }
}
