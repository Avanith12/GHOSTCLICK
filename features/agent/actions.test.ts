import { describe, expect, it } from 'vitest';
import { actionKey, firstJsonObject, isBlocked, needsApproval, normalizeUrl, parseAction, siteList, validateAction } from './actions';
import type { ObservedElement, PageObservation } from './types';

const field: ObservedElement = { id: 1, kind: 'input', label: 'Email', inView: true, formFields: 3 };
const password: ObservedElement = { id: 2, kind: 'input', label: 'Password', password: true, inView: true, formFields: 3 };
const submit: ObservedElement = { id: 3, kind: 'button', label: 'Request access', submit: true, formFields: 3, inView: true };
const buy: ObservedElement = { id: 4, kind: 'button', label: 'Place order', inView: true };
const search: ObservedElement = { id: 5, kind: 'input', label: 'Search', inView: true, formFields: 1 };
const dropdown: ObservedElement = { id: 6, kind: 'select', label: 'Term', options: ['Fall', 'Spring'], inView: true };
const page: PageObservation = {
  url: 'https://example.com/',
  title: 'Example',
  elements: [field, password, submit, buy, search, dropdown],
  hidden: 0,
  text: '',
  problems: [],
  password: true,
  captcha: false,
  atBottom: true,
  fingerprint: 'x',
};

describe('parseAction', () => {
  it('reads the first JSON object and forgives casing and aliases', () => {
    const action = parseAction('Sure! {"say":"Type the email","action":"fill","element":"[1]","value":"a@b.co"} and more {"x":1}');
    expect(action).toMatchObject({ action: 'TYPE', id: 1, text: 'a@b.co', say: 'Type the email' });
  });

  it('keeps braces inside strings intact', () => {
    expect(firstJsonObject('{"action":"NOTE","text":"price is {not} known"}')?.text).toBe('price is {not} known');
  });

  it('reads action names written with their field notation, as Phi-3.5 did in the benchmark', () => {
    expect(parseAction('{"say":"go","action":"NAVIGATE url","url":"/directory.html"}')).toMatchObject({ action: 'NAVIGATE', url: '/directory.html' });
    expect(parseAction('{"action":"CLICK id","id":4}')).toMatchObject({ action: 'CLICK', id: 4 });
  });

  it('resolves site paths against the current page', () => {
    const checked = validateAction({ action: 'NAVIGATE', url: '/directory.html', say: '' }, { ...page, url: 'http://127.0.0.1:4173/index.html' }, 1);
    expect(checked.ok && checked.action.url).toBe('http://127.0.0.1:4173/directory.html');
    expect(normalizeUrl('settings.html', 'http://127.0.0.1:4173/a/b.html')).toBe('http://127.0.0.1:4173/a/settings.html');
    expect(normalizeUrl('/x', undefined)).toBeNull();
  });

  it('repairs plain verb slips but not ones whose intent is unclear', () => {
    const link: ObservedElement = { id: 7, kind: 'link', label: 'Quinn Adams', inView: true };
    const box: ObservedElement = { id: 8, kind: 'input', label: 'Search', inView: true };
    const withPage = { ...page, elements: [...page.elements, link, box] };
    expect(validateAction({ action: 'SELECT', id: 7, say: '' }, withPage, 1)).toMatchObject({ ok: true, action: { action: 'CLICK' } });
    expect(validateAction({ action: 'SELECT', id: 7, text: 'Jordan Lee', say: '' }, withPage, 1)).toMatchObject({ ok: false });
    expect(validateAction({ action: 'SELECT', id: 8, option: 'Jordan Lee', say: '' }, withPage, 1)).toMatchObject({ ok: true, action: { action: 'TYPE', text: 'Jordan Lee' } });
    expect(validateAction({ action: 'CLICK', id: 6, text: 'Fall', say: '' }, withPage, 1)).toMatchObject({ ok: true, action: { action: 'SELECT', option: 'Fall' } });
  });

  it('rejects unknown actions and non-JSON replies', () => {
    expect(parseAction('{"action":"RUN_SCRIPT","code":"alert(1)"}')).toBeNull();
    expect(parseAction('I would click the button')).toBeNull();
  });

  it('reads FINISH success and WAIT seconds', () => {
    expect(parseAction('{"action":"FINISH","result":"nope","success":false}')).toMatchObject({ action: 'FINISH', text: 'nope', success: false });
    expect(parseAction('{"action":"WAIT","seconds":2}')?.ms).toBe(2000);
  });
});

describe('validateAction', () => {
  it('refuses ids that are not on the page', () => {
    const result = validateAction({ action: 'CLICK', id: 99, say: '' }, page, 1);
    expect(result).toMatchObject({ ok: false });
  });

  it('refuses to type passwords', () => {
    const result = validateAction({ action: 'TYPE', id: 2, text: 'hunter2', say: '' }, page, 1);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/password/i);
  });

  it('only allows http(s) navigation and adds a scheme', () => {
    expect(validateAction({ action: 'NAVIGATE', url: 'javascript:alert(1)', say: '' }, page, 1).ok).toBe(false);
    expect(validateAction({ action: 'NAVIGATE', url: 'file:///etc/passwd', say: '' }, page, 1).ok).toBe(false);
    const checked = validateAction({ action: 'NAVIGATE', url: 'books.toscrape.com', say: '' }, page, 1);
    expect(checked.ok && checked.action.url).toBe('https://books.toscrape.com/');
  });

  it('checks tab numbers against the open tabs', () => {
    expect(validateAction({ action: 'SWITCH_TAB', tab: 3, say: '' }, page, 2).ok).toBe(false);
    expect(validateAction({ action: 'SWITCH_TAB', tab: 2, say: '' }, page, 2).ok).toBe(true);
    expect(validateAction({ action: 'CLOSE_TAB', say: '' }, page, 1).ok).toBe(false);
  });

  it('points to SELECT for dropdowns and to CLICK for other controls', () => {
    expect(validateAction({ action: 'SELECT', id: 6, option: 'Fall', say: '' }, page, 1).ok).toBe(true);
    expect(validateAction({ action: 'SELECT', id: 3, option: 'Fall', say: '' }, page, 1).ok).toBe(false);
    expect(validateAction({ action: 'TYPE', id: 6, text: 'x', say: '' }, page, 1).ok).toBe(false);
  });

  it('needs a page for page actions', () => {
    expect(validateAction({ action: 'EXTRACT', say: '' }, null, 1).ok).toBe(false);
    expect(validateAction({ action: 'SEARCH', text: 'laptops', say: '' }, null, 1).ok).toBe(true);
  });
});

describe('needsApproval', () => {
  it('asks before consequential clicks and form submissions', () => {
    expect(needsApproval({ action: 'CLICK', id: 4, say: '' }, buy)).toMatch(/Place order/);
    expect(needsApproval({ action: 'CLICK', id: 3, say: '' }, submit)).toMatch(/submits a form/);
    expect(needsApproval({ action: 'SUBMIT', id: 1, say: '' }, field)).toBeTruthy();
    expect(needsApproval({ action: 'TYPE', id: 1, text: 'x', submit: true, say: '' }, field)).toBeTruthy();
  });

  it('does not ask for filters, wizard steps, ticking boxes, or look-alike words', () => {
    const inForm = { inView: true, formFields: 3, submit: true, kind: 'button' as const };
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { ...inForm, id: 1, label: 'Apply' })).toBeNull();
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { ...inForm, id: 1, label: 'Next' })).toBeNull();
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { id: 1, kind: 'button', label: 'Add Pico Book 11 to cart', inView: true })).toBeNull();
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { id: 1, kind: 'checkbox', label: 'I agree to the terms', inView: true })).toBeNull();
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { id: 1, kind: 'button', label: 'Checkout', inView: true })).toBeNull();
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { ...inForm, id: 1, label: 'Submit application' })).toMatch(/Submit application/);
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { id: 1, kind: 'button', label: 'Apply now', inView: true })).toBeTruthy();
    expect(needsApproval({ action: 'CLICK', id: 1, say: '' }, { ...inForm, id: 1, label: 'Save changes' })).toBeTruthy();
  });

  it('does not ask for search boxes or plain typing', () => {
    expect(needsApproval({ action: 'TYPE', id: 5, text: 'laptops', submit: true, say: '' }, search)).toBeNull();
    expect(needsApproval({ action: 'SUBMIT', id: 5, say: '' }, search)).toBeNull();
    expect(needsApproval({ action: 'TYPE', id: 1, text: 'a@b.co', say: '' }, field)).toBeNull();
  });
});

describe('sites', () => {
  it('matches blocked hosts and their subdomains', () => {
    const blocked = siteList('https://mybank.com/login, *.example.org\nshop.test');
    expect(blocked).toEqual(['mybank.com', 'example.org', 'shop.test']);
    expect(isBlocked('https://www.mybank.com/x', blocked)).toBe(true);
    expect(isBlocked('https://notmybank.com/', blocked)).toBe(false);
  });

  it('normalizes only real web addresses', () => {
    expect(normalizeUrl('localhost:4173/x')).toBe('https://localhost:4173/x');
    expect(normalizeUrl('chrome://settings')).toBeNull();
    expect(normalizeUrl('hello')).toBeNull();
  });

  it('treats the same action on the same control as a repeat', () => {
    expect(actionKey({ action: 'CLICK', id: 3, say: 'a' }, submit)).toBe(actionKey({ action: 'CLICK', id: 9, say: 'b' }, submit));
  });
});
