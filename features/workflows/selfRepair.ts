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
  const match = selector.match(/^#([A-Za-z][\w-]*)$/);
  return match?.[1] ?? '';
}

/** Controls that usually abort the task — never auto-pick these unless the recording was one. */
export const DESTRUCTIVE =
  /\b(cancel|delete|remove|back|reset|clear|discard|unsubscribe|sign ?out|log ?out|close|dismiss|no thanks)\b/i;

/** Labels that mean “go forward” — Continue ↔ Next style renames. */
export const FORWARD =
  /\b(continue|next|submit|save|confirm|proceed|done|send|apply|finish|create|add|sign ?in|log ?in|ok|yes|accept|update|post)\b/i;

const CHROME_LINK = /^(←|→|->|<-|back to|skip to|close dialog|×|✕)/i;
/** Whole-label nav chrome only — do not match a real button that merely contains “home” or “settings”. */
const NAV_PAGE =
  /^(automation challenges|northwind works.*|←.*portal|home|about|help|docs|dashboard|directory|settings|challenges?)$/i;

function isForward(label: string) {
  return FORWARD.test(normalize(label));
}

function isDestructive(label: string) {
  return DESTRUCTIVE.test(normalize(label));
}

function looksLikeNav(candidate: Candidate) {
  if (CHROME_LINK.test(candidate.label)) return true;
  if (candidate.tag !== 'a') return false;
  return NAV_PAGE.test(candidate.label);
}

export function scoreCandidate(label: string, selector: string, candidate: Candidate) {
  const recordedId = idOf(selector);
  const candidateId = idOf(candidate.selector);
  if (recordedId && recordedId === candidateId) return 1;

  const recorded = normalize(label);
  const found = normalize(candidate.label);
  if (recorded && recorded === found) return 1;

  let score = jaccard(tokens(label), tokens(candidate.label));
  if (recorded && found && (found.includes(recorded) || recorded.includes(found))) score += 0.15;

  // Renamed primary actions: Continue → Next, Submit → Save, etc.
  if (recorded && found && isForward(recorded) && isForward(found) && recorded !== found) {
    score = Math.max(score, 0.74);
  }

  // Prefer same control kind when the recording was a button.
  if (/button/i.test(candidate.tag) && /#|button|submit/i.test(selector)) score += 0.04;
  if (candidate.tag === 'a' && /button|submit/i.test(selector)) score -= 0.12;

  // Keep abort controls out of the lead unless that is what was recorded.
  if (!isDestructive(recorded) && isDestructive(found)) score *= 0.12;
  if (looksLikeNav(candidate)) score *= 0.15;

  return Math.max(0, Math.min(1, score));
}

/**
 * Drop page chrome and (usually) abort controls so the person and the model see a short, useful list.
 * Abort controls stay available only when the recording itself was destructive, or nothing else exists.
 */
export function filterRepairPool(label: string, candidates: Candidate[]) {
  const trimmed = candidates.filter((candidate) => {
    const text = candidate.label.trim();
    if (!text || text.length > 72) return false;
    if (looksLikeNav(candidate)) return false;
    return true;
  });

  let pool = trimmed.length ? trimmed : candidates.filter((candidate) => !looksLikeNav(candidate));
  if (!pool.length) pool = candidates;
  if (isDestructive(label)) return pool;

  const safe = pool.filter((candidate) => !isDestructive(candidate.label));
  return safe.length ? safe : pool;
}

export function rankCandidates(label: string, selector: string, candidates: Candidate[]) {
  const pool = filterRepairPool(label, candidates);
  const ranked = pool
    .map((candidate) => ({
      ...candidate,
      score: scoreCandidate(label, selector, candidate),
    }))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));

  const [best, second] = ranked;
  const clearMatch = Boolean(best && best.score >= 0.78 && (!second || best.score - second.score >= 0.18));
  const clearForward =
    Boolean(best) &&
    isForward(label) &&
    isForward(best!.label) &&
    !isDestructive(best!.label) &&
    best!.score >= 0.68 &&
    (!second || second.score < 0.4 || isDestructive(second.label));

  return {
    auto: clearMatch || clearForward ? best! : null,
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

export function parseNumberChoice(text: string, selectors: string[], allowed = selectors) {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  let data: { number?: unknown; reason?: unknown } = {};
  if (json) {
    try {
      data = JSON.parse(json);
    } catch {
      data = {};
    }
  }
  const number = Number(data.number ?? text.match(/\d+/)?.[0]);
  const selector = Number.isInteger(number) ? selectors[number - 1] : undefined;
  if (!selector || !allowed.includes(selector)) return null;
  return {
    selector,
    reason: typeof data.reason === 'string' && data.reason ? data.reason : 'The vision model chose this control.',
    sawPage: true as const,
  };
}
