import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { documentNeedsOcr, ocrImage, pageNeedsOcr } from './ocrText';

const root = dirname(fileURLToPath(import.meta.url));
const sample = join(root, 'fixtures', 'ocr-sample.png');

describe('pageNeedsOcr / documentNeedsOcr', () => {
  it('flags empty pages and sparse documents', () => {
    expect(pageNeedsOcr('')).toBe(true);
    expect(pageNeedsOcr('hi')).toBe(true);
    expect(pageNeedsOcr('This page has plenty of selectable text for Ghostclick.')).toBe(false);
    expect(documentNeedsOcr(['', ''])).toBe(true);
    expect(documentNeedsOcr(['A long enough block of selectable PDF text that should skip OCR entirely.'])).toBe(false);
  });
});

describe('ocrImage', () => {
  it(
    'reads printed English from a sample scan image',
    async () => {
      const text = await ocrImage(sample);
      const normalized = text.toUpperCase().replace(/\s+/g, ' ');
      expect(normalized).toContain('GHOSTCLICK');
      expect(normalized).toContain('OCR');
      expect(normalized).toContain('4242');
    },
    120_000,
  );
});
