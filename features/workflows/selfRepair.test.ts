import { describe, expect, it } from 'vitest';
import { filterRepairPool, parseModelChoice, parseNumberChoice, rankCandidates, scoreCandidate } from './selfRepair';
import type { Candidate } from '@/shared/types';

function candidate(selector: string, label: string, tag = 'button'): Candidate {
  return { selector, label, tag, score: 0 };
}

describe('rankCandidates', () => {
  it('picks the control whose label still matches', () => {
    const result = rankCandidates('Continue', '#continue', [
      candidate('#next', 'Next'),
      candidate('#continue', 'Continue'),
    ]);

    expect(result.auto?.selector).toBe('#continue');
  });

  it('auto-picks Next when Continue was renamed and Cancel is the only other option', () => {
    const result = rankCandidates('Continue', '#continue', [
      candidate('#cancel-request', 'Cancel'),
      candidate('#next-step', 'Next'),
    ]);

    expect(result.auto?.selector).toBe('#next-step');
    expect(result.ranked.map((item) => item.label)).toEqual(['Next']);
  });

  it('asks a person when two forward actions look equally plausible', () => {
    const result = rankCandidates('Continue', '#continue', [
      candidate('#next-step', 'Next'),
      candidate('#save-draft', 'Save'),
    ]);

    expect(result.auto).toBeNull();
    expect(result.ranked.map((item) => item.label)).toEqual(['Next', 'Save']);
  });
});

describe('scoreCandidate', () => {
  it('penalizes Cancel when the recording was Continue', () => {
    expect(scoreCandidate('Continue', '#continue', candidate('#cancel', 'Cancel'))).toBeLessThan(0.2);
    expect(scoreCandidate('Continue', '#continue', candidate('#next', 'Next'))).toBeGreaterThan(0.6);
  });
});

describe('filterRepairPool', () => {
  it('hides Cancel and nav chrome for a Continue repair', () => {
    const pool = filterRepairPool('Continue', [
      candidate('#cancel', 'Cancel'),
      candidate('#next', 'Next'),
      candidate('a.home', '← Northwind Works portal', 'a'),
      candidate('a.challenges', 'Automation Challenges', 'a'),
    ]);
    expect(pool.map((item) => item.label)).toEqual(['Next']);
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
      sawPage: true,
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
