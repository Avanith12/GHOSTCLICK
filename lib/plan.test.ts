import { describe, expect, it } from 'vitest';
import { rulesPlan, validatePlan } from './plan';
import type { Workflow } from './types';

const hold: Workflow = {
  id: 'hold',
  name: 'Advising hold release',
  goal: 'Clear an advising hold for a student',
  createdAt: 0,
  steps: [
    { id: '1', kind: 'fill', url: 'http://x/', selector: '#n', fallbacks: [], label: 'Student name', variableKey: 'studentname', value: 'Ada' },
    { id: '2', kind: 'fill', url: 'http://x/', selector: '#e', fallbacks: [], label: 'Email', variableKey: 'email', value: 'a@x.edu' },
    { id: '3', kind: 'fill', url: 'http://x/', selector: '#i', fallbacks: [], label: 'Student ID', variableKey: 'studentid', value: '1' },
  ],
};

describe('rulesPlan', () => {
  it('matches a saved workflow and pulls obvious values from the sentence', () => {
    const plan = rulesPlan('Clear the advising hold for Grace Hopper, ID 55667788, grace@navy.mil', [hold], false);
    expect(plan.action).toBe('run');
    expect(plan.workflowId).toBe('hold');
    expect(plan.variables).toEqual({ studentname: 'Grace Hopper', email: 'grace@navy.mil', studentid: '55667788' });
  });

  it('routes scraping and page saving requests', () => {
    expect(rulesPlan('scrape the books on this page', [hold], false)).toMatchObject({ action: 'find', question: '' });
    expect(rulesPlan('let me pick the list myself', [hold], false).action).toBe('scrape');
    expect(rulesPlan('save this article as a clean document', [hold], false).action).toBe('save_page');
    expect(rulesPlan('pull the course list out of this PDF', [hold], false).action).toBe('read_pdf');
    expect(rulesPlan('get all the book titles and prices on this page', [hold], false).action).toBe('find');
  });

  it('turns a described filter into a find plan', () => {
    const plan = rulesPlan('in the trending repos i want every repo that is related to diagram design or something', [hold], false);
    expect(plan).toMatchObject({ action: 'find', question: 'diagram design' });
    expect(rulesPlan('find the stories about rust on this page', [hold], false).question).toBe('rust');
  });

  it('ignores filler words when matching workflows', () => {
    const wiki = { ...hold, id: 'wiki', name: 'Test https://en.wikipedia.org/wiki/Main_Page', goal: '' };
    expect(rulesPlan('open the page about dentists', [wiki], false).action).toBe('record');
  });

  it('asks to record when nothing matches', () => {
    expect(rulesPlan('book a dentist appointment', [hold], false).action).toBe('record');
  });
});

describe('validatePlan', () => {
  it('drops fields the workflow does not have', () => {
    const plan = validatePlan(
      { action: 'run', workflowId: 'hold', variables: { studentname: 'Grace', password: 'x' } },
      [hold],
      '',
    );
    expect(plan?.variables).toEqual({ studentname: 'Grace' });
  });

  it('rejects unknown workflows', () => {
    expect(validatePlan({ action: 'run', workflowId: 'nope' }, [hold], '')).toBeNull();
  });
});
