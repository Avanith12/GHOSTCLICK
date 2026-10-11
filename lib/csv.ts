import type { Row } from './types';

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);

  const [header = [], ...body] = rows;
  const headers = header.map((name) => name.trim());
  return body.map((values) => {
    const record: Row = {};
    headers.forEach((name, index) => {
      record[name] = (values[index] ?? '').trim();
    });
    return record;
  });
}

function escape(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(columns: string[], rows: Row[]) {
  const lines = [columns.map(escape).join(',')];
  for (const row of rows) lines.push(columns.map((column) => escape(row[column] ?? '')).join(','));
  return lines.join('\n');
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function mapColumns(headers: string[], fields: { key: string; label: string }[]) {
  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const header = headers.find(
      (name) => normalize(name) === normalize(field.key) || normalize(name) === normalize(field.label),
    );
    if (header) mapping[field.key] = header;
  }
  return mapping;
}
