import type { Row } from '@/shared/types';

const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'are', 'with', 'about', 'related', 'relating', 'any', 'all', 'every',
  'some', 'something', 'stuff', 'things', 'ones', 'kind', 'like', 'which', 'what', 'into', 'from', 'only',
]);

export function rowText(row: Row, limit = 240) {
  return Object.values(row)
    .filter((value) => value && !/^https?:\/\//.test(value))
    .join(' · ')
    .slice(0, limit);
}

export function rowWords(row: Row, limit = 300) {
  return Object.values(row)
    .filter((value) => value && !/^https?:\/\//.test(value) && (value.match(/[a-z]/gi)?.length ?? 0) >= 4 && !/^built by$/i.test(value))
    .join(' — ')
    .slice(0, limit);
}

export function rowTitle(row: Row) {
  if (row.title && row.title.length > 3) return row.title;
  return Object.values(row).find((value) => value && value.length > 3 && !/^https?:\/\//.test(value)) ?? '';
}

function stem(word: string) {
  return word.replace(/(ing|ings|ed|es|s)$/, '');
}

export function bestKeywordMatches(filter: string, rows: Row[]) {
  const ranked = keywordFilter(filter, rows);
  if (ranked.length === 0) return [];
  const hits = keywordHits(filter, rows);
  const most = hits[ranked[0]!]!;
  return ranked.filter((index) => hits[index] === most).sort((left, right) => left - right);
}

function keywordHits(filter: string, rows: Row[]) {
  const patterns = keywordPatterns(filter);
  return rows.map((row) => {
    const text = rowText(row, 2000);
    return patterns.filter((pattern) => pattern.test(text)).length;
  });
}

function keywordPatterns(filter: string) {
  return filter
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem)
    .filter((word) => word.length > 1)
    .map((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(word.length <= 3 ? `\\b${escaped}\\b` : word.length === 4 ? `\\b${escaped}` : escaped, 'i');
    });
}

export function keywordFilter(filter: string, rows: Row[], everyWord = false) {
  const patterns = keywordPatterns(filter);
  if (patterns.length === 0) return rows.map((_, index) => index);
  const hits = keywordHits(filter, rows);
  return hits
    .map((count, index) => ({ index, hits: count }))
    .filter((item) => (everyWord ? item.hits === patterns.length : item.hits > 0))
    .sort((left, right) => right.hits - left.hits || left.index - right.index)
    .map((item) => item.index);
}

export function parseVotes(text: string, count: number) {
  const yes = new Set<number>();
  for (const [, number, vote] of text.matchAll(/(\d+)\s*[:.)\-]\s*\**\s*(yes|no)\b/gi)) {
    const value = Number(number);
    if (value >= 1 && value <= count && vote!.toLowerCase() === 'yes') yes.add(value - 1);
  }
  return [...yes].sort((left, right) => left - right);
}

export function filterPhrase(request: string) {
  const match = request.match(
    /\b(?:related to|relating to|about|regarding|that (?:mentions?|involves?|(?:are|is) about|relates? to|(?:are|is) related to|use|uses)|which (?:mentions?|(?:are|is) about)|containing|mentioning|matching|on the topic of|to do with|with|for)\s+(.+)$/i,
  );
  return (match?.[1] ?? '')
    .replace(/\s+(?:on|from|in) (?:this|the) (?:page|site|list|website)\b.*$/i, '')
    .replace(/\s+here\b.*$/i, '')
    .replace(/\s+(?:or something|or so|etc\.?)$/i, '')
    .replace(/[.?!]+$/, '')
    .trim();
}
