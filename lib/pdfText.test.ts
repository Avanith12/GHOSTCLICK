import { describe, expect, it } from 'vitest';
import { chunkPages, linesFromItems, relevantText, UNVERIFIED, verifyRows } from './pdfText';

const at = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] });

describe('linesFromItems', () => {
  it('rebuilds lines top to bottom and left to right', () => {
    const text = linesFromItems([at('Credits', 300, 700), at('Course', 50, 700), at('CS 101', 50, 680), at('3', 300, 681)]);
    expect(text).toBe('Course Credits\nCS 101 3');
  });
});

describe('chunkPages', () => {
  it('keeps page labels and splits long text', () => {
    const chunks = chunkPages(['a'.repeat(50), 'b'.repeat(50)], 70);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('[Page 1]');
  });
});

describe('verifyRows', () => {
  it('flags values the model made up', () => {
    const rows = verifyRows([{ course: 'CS 101', credits: '4' }], 'CS 101 Intro to Programming 3 credits');
    expect(rows[0]?.[UNVERIFIED]).toBe('credits');
  });
});

describe('relevantText', () => {
  it('prefers chunks that mention the question words', () => {
    expect(relevantText(['alpha beta', 'refund policy details'], 'What is the refund policy?', 20)).toContain('refund');
  });
});
