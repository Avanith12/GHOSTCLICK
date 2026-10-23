import { describe, expect, it } from 'vitest';
import { parseMatches, selectPassages, splitPassages } from './relevance';

describe('selectPassages', () => {
  it('returns the text unchanged when it already fits the budget', () => {
    const text = 'short enough to keep';
    expect(selectPassages('anything', text, 100)).toBe(text);
  });

  it('keeps the passage that matches the question and drops the rest', () => {
    const context = [
      'The cafeteria menu changes every week and offers vegetarian options.',
      'Parking permits for the north garage are issued by the registrar.',
      'Students enroll in courses through the student portal each semester.',
    ].join('\n\n');
    const result = selectPassages('how do students enroll in courses', context, 90);
    expect(result).toContain('enroll in courses');
    expect(result).not.toContain('cafeteria');
    expect(result.length).toBeLessThanOrEqual(90);
  });

  it('falls back to a top-of-document clip when nothing matches', () => {
    const context = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
    const result = selectPassages('zzz nonexistent', context, 20);
    expect(result).toBe(context.slice(0, 20));
  });
});

describe('splitPassages', () => {
  it('groups lines into passages near the target size', () => {
    const text = Array.from({ length: 10 }, (_, i) => `line number ${i}`).join('\n');
    const passages = splitPassages(text, 30);
    expect(passages.length).toBeGreaterThan(1);
    expect(passages.every((passage) => passage.length <= 40)).toBe(true);
  });
});

describe('parseMatches', () => {
  it('reads the matches array and de-duplicates', () => {
    expect([...parseMatches('{"matches":[1,3,3,5]}', 5)].sort((a, b) => a - b)).toEqual([1, 3, 5]);
  });

  it('ignores numbers outside 1..max', () => {
    expect([...parseMatches('{"matches":[0,2,9]}', 4)]).toEqual([2]);
  });

  it('falls back to bare integers when there is no JSON', () => {
    expect([...parseMatches('items 2 and 4 match', 4)].sort((a, b) => a - b)).toEqual([2, 4]);
  });

  it('returns an empty set for an empty match list', () => {
    expect([...parseMatches('{"matches":[]}', 5)]).toEqual([]);
  });
});
