import { describe, expect, it } from 'vitest';
import { candidateActions, formatPage, goalTerms } from './agentPrompt';
import type { PageObservation } from './types';

describe('goalTerms', () => {
  it('pulls names and quoted phrases out of a goal, not sentence-start verbs', () => {
    expect(goalTerms('Open the Employee Directory, find Jordan Lee, and open their profile.')).toEqual(['Employee Directory', 'Jordan Lee']);
    expect(goalTerms('Add the "Clarity 27 QHD" monitor; compare with Clarity 24')).toEqual(['Clarity 27 QHD', 'Clarity 24']);
    expect(goalTerms('Go to Settings and switch to dark mode')).toEqual(['Settings']);
  });
});

describe('formatPage hints', () => {
  const page: PageObservation = {
    url: 'http://x/directory.html',
    title: 'Directory',
    elements: [
      { id: 3, kind: 'input', type: 'search', label: 'Search', inView: true },
      { id: 9, kind: 'button', label: 'Add Lumen Air to cart', inView: true },
    ],
    hidden: 0,
    text: '',
    problems: [],
    password: false,
    captcha: false,
    atBottom: true,
    fingerprint: 'f',
  };

  it('points to elements that carry the goal names', () => {
    expect(formatPage(page, 'Add one Lumen Air laptop')).toContain('Goal names on this page: "Lumen Air": [9] button "Add Lumen Air to cart"');
  });

  it('says what is missing and where the search box is', () => {
    expect(formatPage(page, 'find Jordan Lee')).toContain('Not on this page: "Jordan Lee". The search box is [3].');
  });
});

describe('candidateActions', () => {
  const base = { hidden: 0, text: '', problems: [], password: false, captcha: false, atBottom: true, fingerprint: 'f', title: 'Directory' };
  it('offers a search for goal names the page does not show, and clicks for ones it does', () => {
    const page = {
      ...base,
      url: 'http://x/directory.html',
      elements: [
        { id: 3, kind: 'link' as const, label: 'Employee Directory', href: '/directory.html', inView: true },
        { id: 10, kind: 'input' as const, type: 'search', label: 'Search people', inView: true },
        { id: 12, kind: 'button' as const, label: 'View details for Jordan Lee', inView: true },
      ],
    };
    expect(candidateActions(page, 'Open the Employee Directory and find Jordan Lee')).toEqual([
      '{"action":"CLICK","id":12} (button "View details for Jordan Lee")',
    ]);
    const empty = { ...page, elements: page.elements.slice(0, 2) };
    expect(candidateActions(empty, 'find Jordan Lee')).toEqual(['{"action":"TYPE","id":10,"text":"Jordan Lee","submit":true} (search for "Jordan Lee")']);
  });

  it('leaves out controls the agent just used', () => {
    const page = { ...base, url: 'http://x/', elements: [{ id: 5, kind: 'button' as const, label: 'Add Lumen Air to cart', inView: true }] };
    expect(candidateActions(page, 'Add a Lumen Air', ['CLICK [5] "Add Lumen Air to cart"'])).toEqual([]);
  });
});
