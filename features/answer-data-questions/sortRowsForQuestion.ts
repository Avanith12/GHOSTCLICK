import { toCsv } from '@/shared/csv';
import { keywordFilter } from '@/features/find-items/keywordSearch';
import type { Row } from '@/shared/types';

const LOW = /\b(cheapest|cheaper|lowest|least expensive|least|smallest|fewest|shortest|min(?:imum)?|bottom)\b/i;
const HIGH_STRONG = /\b(most expensive|costliest|priciest|dearest|expensive|highest|largest|biggest|longest|max(?:imum)?|top|best)\b/i;
const HIGH = new RegExp(`${HIGH_STRONG.source}|\\b(most|popular)\\b`, 'i');
const MONEY = /[$£€¥₹]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:USD|EUR|GBP|€|zł|kr)\b/i;

export function numberOf(value: string) {
  if (/^https?:\/\//.test(value)) return Number.NaN;
  const money = value.match(MONEY);
  if (money) return Number.parseFloat((money[1] ?? money[2] ?? '').replace(/,/g, ''));
  const match = value
    .replace(/-?\d+(?:\.\d+)?\s?%/g, ' ')
    .replace(/,/g, '')
    .match(/-?\d+(?:\.\d+)?/);
  if (!match) return Number.NaN;
  const number = Number.parseFloat(match[0]);
  return /\d\s*k\b/i.test(value) ? number * 1000 : /\d\s*m\b/i.test(value) ? number * 1_000_000 : number;
}

function numericColumns(columns: string[], rows: Row[]) {
  return columns.filter((column) => {
    const values = rows.map((row) => row[column] ?? '').filter(Boolean);
    return values.length >= rows.length / 2 && values.filter((value) => !Number.isNaN(numberOf(value))).length >= values.length * 0.8;
  });
}

export function rankRows(question: string, columns: string[], rows: Row[]) {
  const low = LOW.test(question);
  const direction = low && HIGH_STRONG.test(question) ? 'both' : low ? 'low' : HIGH.test(question) ? 'high' : null;
  if (!direction) return null;
  const numeric = numericColumns(columns, rows);
  if (numeric.length === 0) return null;
  const words = question.toLowerCase();
  const column =
    numeric.find((name) => words.includes(name.toLowerCase().replace(/s$/, ''))) ??
    (/\b(cheap|expensive|pric|cost)/i.test(question) ? numeric.find((name) => /price|cost|£|\$/i.test(name + (rows[0]?.[name] ?? ''))) : undefined) ??
    numeric[0]!;
  const priced = rows.filter((row) => !Number.isNaN(numberOf(row[column] ?? '')));
  const ascending = [...priced].sort((left, right) => numberOf(left[column] ?? '') - numberOf(right[column] ?? ''));
  return { column, direction, ascending, rows: direction === 'high' ? [...ascending].reverse() : ascending };
}

function readableColumns(question: string, columns: string[], rows: Row[]) {
  const isUrl = (column: string) => rows.slice(0, 10).every((row) => !row[column] || /^https?:\/\//.test(row[column]!));
  const wantsLinks = /\b(links?|urls?)\b/i.test(question);
  const wantsImages = /\b(images?|pictures?|photos?)\b/i.test(question);
  const kept = columns.filter((column) => {
    if (!isUrl(column)) return true;
    if (wantsImages && /image|photo|picture|thumb|avatar/i.test(column)) return true;
    return wantsLinks && /url|link|href/i.test(column);
  });
  return kept.length ? kept : columns;
}

export function dataContext(question: string, columns: string[], rows: Row[], limit = 80) {
  const ranked = rankRows(question, columns, rows);
  const shown = readableColumns(question, columns, rows);
  if (!ranked) {
    const matching = keywordFilter(question, rows);
    if (matching.length === 0 || matching.length === rows.length) {
      return `${rows.length} rows in total.\n${toCsv(shown, rows.slice(0, limit))}`;
    }
    const first = new Set(matching);
    const ordered = [...matching.map((index) => rows[index]!), ...rows.filter((_, index) => !first.has(index))];
    return `${rows.length} rows in total. The first ${matching.length} rows contain words from the question.\n${toCsv(shown, ordered.slice(0, limit))}`;
  }
  const named = question.match(/\b(\d{1,2})\b/)?.[1];
  if (ranked.direction === 'both') {
    const each = Math.max(1, Number(named ?? 3));
    const lowest = ranked.ascending.slice(0, each);
    const highest = [...ranked.ascending].reverse().slice(0, each);
    return [
      `The ${lowest.length} rows with the lowest ${ranked.column} (first row is the lowest):`,
      toCsv(shown, lowest),
      '',
      `The ${highest.length} rows with the highest ${ranked.column} (first row is the highest):`,
      toCsv(shown, highest),
    ].join('\n');
  }
  const top = ranked.rows.slice(0, Math.min(limit, Math.max(1, Number(named ?? 5))));
  const order = ranked.direction === 'low' ? 'lowest' : 'highest';
  return `The ${top.length} rows with the ${order} ${ranked.column}, in order (first row is the ${order}):\n${toCsv(shown, top)}`;
}
