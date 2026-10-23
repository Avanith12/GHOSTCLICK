import type { Row } from '@/shared/types';

export type TextItem = {
  str: string;
  transform: number[];
};

export function linesFromItems(items: TextItem[]) {
  const lines: { y: number; parts: { x: number; text: string }[] }[] = [];
  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
    if (!line) {
      line = { y, parts: [] };
      lines.push(line);
    }
    line.parts.push({ x, text: item.str });
  }
  return lines
    .sort((top, bottom) => bottom.y - top.y)
    .map((line) =>
      line.parts
        .sort((left, right) => left.x - right.x)
        .map((part) => part.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

export function pdfMarkdown(title: string, source: string, pages: string[]) {
  return [`# ${title}`, `Source: ${source}`, ...pages.map((text, index) => `## Page ${index + 1}\n\n${text}`)].join('\n\n');
}

export function chunkPages(pages: string[], size = 3000) {
  const chunks: string[] = [];
  let current = '';
  pages.forEach((text, index) => {
    const block = `[Page ${index + 1}]\n${text}`;
    if (current && current.length + block.length > size) {
      chunks.push(current);
      current = '';
    }
    if (block.length > size) {
      for (let start = 0; start < block.length; start += size) chunks.push(block.slice(start, start + size));
    } else {
      current = current ? `${current}\n\n${block}` : block;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s,]+/g, ' ').trim();
}

export const UNVERIFIED = 'not found in PDF';

export function cleanRows(rows: Row[], keys: string[]) {
  const names = new Set(['key', 'value', ...keys, ...rows.flatMap((row) => Object.keys(row))].map((key) => key.trim().toLowerCase()));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const values = Object.values(row).map((value) => value.trim().toLowerCase()).filter(Boolean);
    if (values.length === 0 || values.every((value) => names.has(value))) return false;
    const signature = values.join('\u0000');
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function verifyRows(rows: Row[], source: string) {
  const haystack = normalize(source);
  return rows.map((row) => {
    const missing = Object.entries(row)
      .filter(([, value]) => value.trim() && !haystack.includes(normalize(value)))
      .map(([key]) => key);
    return { ...row, [UNVERIFIED]: missing.join(', ') };
  });
}

export function relevantText(chunks: string[], question: string, limit = 5000) {
  if (!chunks.length) return '';
  const lowerQuestion = question.toLowerCase();
  const overview = /\b(summar(?:y|ise|ize)|overview|abstract|tl;?dr|main (?:idea|points)|what is this|about this)\b/i.test(
    question,
  );
  const words = [...new Set(lowerQuestion.split(/[^a-z0-9]+/).filter((word) => word.length > 2))];
  const ranked = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (!lower.includes(word)) continue;
      // Prefer rarer / longer matches so “deadline” beats “the”.
      score += Math.min(3, 1 + Math.floor(word.length / 4));
      const hits = lower.split(word).length - 1;
      if (hits > 1) score += Math.min(2, hits - 1);
    }
    // Keep early pages in play for overviews and short docs.
    if (overview && index < 2) score += 8;
    else if (index === 0) score += 1;
    return { chunk, index, score };
  });
  ranked.sort((left, right) => right.score - left.score || left.index - right.index);

  const picked = new Set<number>();
  const order: number[] = [];
  const take = (index: number) => {
    if (index < 0 || index >= chunks.length || picked.has(index)) return;
    picked.add(index);
    order.push(index);
  };

  // Always seed with the best hit (or page 1 for overviews).
  if (overview) take(0);
  for (const item of ranked) {
    if (order.length >= chunks.length) break;
    take(item.index);
    // Pull a neighbor so answers keep surrounding sentences.
    if (item.score > 0) {
      take(item.index - 1);
      take(item.index + 1);
    }
  }
  if (!order.length) take(0);

  let text = '';
  for (const index of order) {
    const chunk = chunks[index] ?? '';
    if (!text && chunk.length > limit) return chunk.slice(0, limit);
    if (text.length + chunk.length + 2 > limit) {
      if (!text) return chunk.slice(0, limit);
      break;
    }
    text += `${chunk}\n\n`;
  }
  return text.trim();
}
