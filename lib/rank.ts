import { toCsv } from './csv';
import type { Row } from './types';

const LOW = /\b(cheapest|lowest|least|smallest|fewest|shortest|min(?:imum)?|bottom)\b/i;
const HIGH = /\b(most expensive|priciest|highest|most|largest|biggest|longest|max(?:imum)?|top|best|popular)\b/i;

export function numberOf(value: string) {
  if (/^https?:\/\//.test(value)) return Number.NaN;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
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
  const direction = LOW.test(question) ? 'low' : HIGH.test(question) ? 'high' : null;
  if (!direction) return null;
  const numeric = numericColumns(columns, rows);
  if (numeric.length === 0) return null;
  const words = question.toLowerCase();
  const column =
    numeric.find((name) => words.includes(name.toLowerCase().replace(/s$/, ''))) ??
    (/\b(cheap|expensive|pric|cost)/i.test(question) ? numeric.find((name) => /price|cost|£|\$/i.test(name + (rows[0]?.[name] ?? ''))) : undefined) ??
    numeric[0]!;
  const sorted = [...rows].sort((left, right) => {
    const a = numberOf(left[column] ?? '');
    const b = numberOf(right[column] ?? '');
    return direction === 'low' ? a - b : b - a;
  });
  return { column, direction, rows: sorted };
}

function readableColumns(question: string, columns: string[], rows: Row[]) {
  if (/\b(links?|urls?|images?|pictures?)\b/i.test(question)) return columns;
  const kept = columns.filter((column) => !rows.slice(0, 10).every((row) => !row[column] || /^https?:\/\//.test(row[column]!)));
  return kept.length ? kept : columns;
}

export function dataContext(question: string, columns: string[], rows: Row[], limit = 80) {
  const ranked = rankRows(question, columns, rows);
  const shown = readableColumns(question, columns, rows);
  if (!ranked) return toCsv(shown, rows.slice(0, limit));
  const wanted = Number(question.match(/\b(\d{1,2})\b/)?.[1] ?? 5);
  const top = ranked.rows.slice(0, Math.min(limit, Math.max(1, wanted)));
  const order = ranked.direction === 'low' ? 'lowest' : 'highest';
  return `The ${top.length} rows with the ${order} ${ranked.column}, in order (first row is the ${order}):\n${toCsv(shown, top)}`;
}
