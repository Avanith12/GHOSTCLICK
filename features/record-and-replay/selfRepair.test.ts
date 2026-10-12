import { describe, expect, it } from 'vitest';
import { parseModelChoice, parseNumberChoice, rankCandidates } from './selfRepair';
import type { Candidate } from '@/shared/types';

function candidate(selector: string, label: string): Candidate {
  return { selector, label, tag: 'button', score: 0 };
}

describe('rankCandidates', () => {
  it('picks the control whose label still matches', () => {
    const result = rankCandidates('Continue', '#continue', [
      candidate('#next', 'Next'),
      candidate('#continue', 'Continue'),
    ]);

    expect(result.auto?.selector).toBe('#continue');
  });

  it('leaves a renamed button for a person to confirm', () => {
    const result = rankCandidates('Continue', '#continue', [
      candidate('#next-step', 'Next'),
      candidate('#cancel-request', 'Cancel'),
    ]);

    expect(result.auto).toBeNull();
    expect(result.ranked.map((item) => item.label)).toEqual(['Next', 'Cancel']);
  });
});

describe('parseModelChoice', () => {
  it('accepts a selector from the list', () => {
    const choice = parseModelChoice(
      'Sure. {"selector":"#next-step","reason":"Next continues the form."}',
      ['#next-step', '#cancel-request'],
    );

    expect(choice).toEqual({
      selector: '#next-step',
      reason: 'Next continues the form.',
    });
  });

  it('rejects a selector the page did not offer', () => {
    expect(parseModelChoice('{"selector":"#made-up","reason":"no"}', ['#next-step'])).toBeNull();
  });
});

describe('parseNumberChoice', () => {
  const selectors = ['#next-step', '#cancel-request', '#help'];

  it('maps the numbered tag the model chose to its control', () => {
    expect(parseNumberChoice('{"number":1,"reason":"Next continues the form."}', selectors)).toEqual({
      selector: '#next-step',
      reason: 'Next continues the form.',
    });
  });

  it('accepts a bare number', () => {
    expect(parseNumberChoice('3', selectors)?.selector).toBe('#help');
  });

  it('rejects numbers without a tag and controls that were filtered out', () => {
    expect(parseNumberChoice('{"number":7}', selectors)).toBeNull();
    expect(parseNumberChoice('{"number":2}', selectors, ['#next-step', '#help'])).toBeNull();
  });
});
