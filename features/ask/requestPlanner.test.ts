import { describe, expect, it } from 'vitest';
import { choosePlan, rulesPlan, validatePlan } from './requestPlanner';
import type { Workflow } from '@/shared/types';

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
    expect(rulesPlan('find the headphones on this page', [hold], false)).toMatchObject({ action: 'find', question: 'headphones' });
    expect(rulesPlan('show me water bottles on this page', [hold], false)).toMatchObject({ action: 'find', question: 'water bottles' });
    expect(rulesPlan('find me a water bottle from this page', [hold], false)).toMatchObject({ action: 'find', question: 'water bottle' });
    expect(rulesPlan('fine me a water bottle in this page', [hold], false)).toMatchObject({ action: 'find', question: 'water bottle' });
    expect(rulesPlan('is there a smartwatch on this page?', [hold], false)).toMatchObject({ action: 'find', question: 'smartwatch' });
    expect(rulesPlan('find me a water bottle', [hold], false)).toMatchObject({ action: 'find', question: 'water bottle' });
    expect(rulesPlan('show you how to clear a hold', [], false).action).toBe('record');
    expect(rulesPlan('save this page', [hold], false).action).toBe('save_page');
  });

  it('answers page questions instead of recording', () => {
    expect(rulesPlan('what is this page about?', [hold], false)).toMatchObject({ action: 'ask_page' });
    expect(rulesPlan('summarize this page', [hold], false)).toMatchObject({ action: 'ask_page' });
    expect(rulesPlan('who is this person?', [hold], false)).toMatchObject({ action: 'ask_page' });
  });

  it('answers ranking questions from scraped rows when there are some', () => {
    expect(rulesPlan('Which three are cheapest?', [hold], true).action).toBe('ask_data');
    expect(rulesPlan('show me the most expensive one', [hold], true).action).toBe('ask_data');
    expect(rulesPlan('Which three are cheapest?', [hold], false).action).toBe('ask_page');
    expect(rulesPlan('what is this page about?', [hold], true).action).toBe('ask_page');
  });

  it('ignores filler words when matching workflows', () => {
    const wiki = { ...hold, id: 'wiki', name: 'Test https://en.wikipedia.org/wiki/Main_Page', goal: '' };
    // "open" is page work for the agent, not a fuzzy match on a Wikipedia-named workflow.
    expect(rulesPlan('open the page about dentists', [wiki], false).action).toBe('agent');
  });

  it('sends imperative page work to the agent when no workflow fits', () => {
    expect(rulesPlan('book a dentist appointment', [hold], false).action).toBe('agent');
    expect(rulesPlan('Add one Lumen Air laptop to the cart', [], false).action).toBe('agent');
    expect(rulesPlan('click Submit on this form', [], false).action).toBe('agent');
  });
});

describe('choosePlan', () => {
  const request = 'Clear the advising hold for Grace Hopper, ID 55667788, grace@navy.mil';

  it('keeps a confident rule plan when the model picks a different action', () => {
    const model = { action: 'scrape' as const, reply: '', source: 'model' as const };
    expect(choosePlan(model, rulesPlan(request, [hold], false), request).action).toBe('run');
  });

  it('drops model values that were not in the request', () => {
    const model = {
      action: 'run' as const,
      workflowId: 'hold',
      variables: { studentname: 'Grace Hopper', email: 'invented@example.com' },
      reply: '',
      source: 'model' as const,
    };
    const plan = choosePlan(model, rulesPlan(request, [hold], false), request);
    expect(plan.variables).toEqual({ studentname: 'Grace Hopper', email: 'grace@navy.mil', studentid: '55667788' });
  });

  it('does not turn a page question into a list search or a recording', () => {
    // Imperative booking is agent work; a model "find" guess must not win over confident rules.
    const model = { action: 'find' as const, question: 'book a dentist appointment', reply: '', source: 'model' as const };
    const text = 'book a dentist appointment on this site';
    expect(choosePlan(model, rulesPlan(text, [hold], false), text).action).toBe('agent');
    const record = { action: 'record' as const, name: 'about', reply: '', source: 'model' as const };
    expect(choosePlan(record, rulesPlan('what is this page about', [hold], false), 'what is this page about').action).toBe(
      'ask_page',
    );
  });

  it('trims a wordy model filter down to the topic', () => {
    const model = { action: 'find' as const, question: 'Find repositories related to diagram design', reply: '', source: 'model' as const };
    const rules = rulesPlan('which ones would help me draw', [hold], false);
    expect(choosePlan(model, rules, 'which ones would help me draw').question).toBe('diagram design');
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
