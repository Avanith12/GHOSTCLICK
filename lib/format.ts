import type { WorkflowStep } from './types';

export function pageKey(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function variableSegment(segment: string) {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8,}$/i.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) ||
    (segment.length >= 16 && /\d/.test(segment) && /[a-z]/i.test(segment))
  );
}

export function pageMatches(recorded: string, current: string) {
  let left: URL;
  let right: URL;
  try {
    left = new URL(recorded);
    right = new URL(current);
  } catch {
    return recorded === current;
  }
  if (left.origin !== right.origin) return false;
  const a = left.pathname.replace(/\/+$/, '').split('/');
  const b = right.pathname.replace(/\/+$/, '').split('/');
  if (a.length !== b.length) return false;
  return a.every((segment, index) => {
    const other = b[index] ?? '';
    return segment === other || (variableSegment(segment) && variableSegment(other));
  });
}

export function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

export function stepSummary(step: WorkflowStep) {
  if (step.kind === 'navigate') return 'Open the recorded page';
  if (step.kind === 'fill') return `Fill ${step.label}`;
  if (step.kind === 'check') return `Set ${step.label}`;
  if (step.kind === 'extract') return `Scrape ${step.label}`;
  if (step.kind === 'assert') return `Check the page shows “${step.expectedText ?? ''}”`;
  return `Click ${step.label}`;
}

export function cleanText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export function words(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  );
}
