import { words } from '@/shared/textHelpers';

// Break long text into passages of roughly `size` characters, split on line boundaries.
// Keeps whole lines together so a passage stays readable on its own.
export function splitPassages(text: string, size = 600): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const passages: string[] = [];
  let buffer = '';
  for (const line of lines) {
    if (buffer && buffer.length + line.length + 1 > size) {
      passages.push(buffer);
      buffer = '';
    }
    buffer = buffer ? `${buffer}\n${line}` : line;
  }
  if (buffer) passages.push(buffer);
  return passages;
}

// Keep the passages most relevant to the question, in their original order, up to
// `budget` characters. Returns the whole text unchanged when it already fits the budget,
// and falls back to a plain top-of-document clip when the question shares no keyword with
// any passage (the previous behaviour). This stops a long page or PDF from being answered
// from only its first few thousand characters when the relevant part is lower down.
export function selectPassages(question: string, context: string, budget: number): string {
  const text = context.trim();
  if (text.length <= budget) return text;

  const wanted = words(question);
  if (wanted.size === 0) return text.slice(0, budget);

  const size = Math.min(600, Math.max(120, Math.floor(budget / 6)));
  const passages = splitPassages(text, size);
  const scored = passages.map((passage, index) => {
    const have = words(passage);
    let overlap = 0;
    for (const word of wanted) if (have.has(word)) overlap += 1;
    return { index, passage, score: overlap };
  });
  if (scored.every((item) => item.score === 0)) return text.slice(0, budget);

  const chosen = new Set<number>();
  let used = 0;
  for (const item of [...scored].sort((left, right) => right.score - left.score || left.index - right.index)) {
    if (item.score === 0) break;
    if (used + item.passage.length + 2 > budget) continue;
    chosen.add(item.index);
    used += item.passage.length + 2;
  }

  const picked = scored
    .filter((item) => chosen.has(item.index))
    .map((item) => item.passage)
    .join('\n\n');
  return (picked || text.slice(0, budget)).slice(0, budget);
}

// Parse a batch relevance reply shaped like {"matches":[1,3]} into a set of 1-based
// numbers, ignoring anything outside 1..max. Falls back to any in-range integers in the
// text when the JSON is missing or malformed, so a chatty model still gets read.
export function parseMatches(text: string, max: number): Set<number> {
  const out = new Set<number>();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const data = JSON.parse(json) as { matches?: unknown };
      if (Array.isArray(data.matches)) {
        for (const value of data.matches) {
          const num = Number(value);
          if (Number.isInteger(num) && num >= 1 && num <= max) out.add(num);
        }
        return out;
      }
    } catch {
      // fall through to loose integer parsing
    }
  }
  for (const match of text.matchAll(/\d+/g)) {
    const num = Number(match[0]);
    if (num >= 1 && num <= max) out.add(num);
  }
  return out;
}
