// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { formatPage } from './agentPrompt';
import { observePage, performAction } from './observePage';

beforeAll(() => {
  if (!globalThis.CSS?.escape) {
    globalThis.CSS = { escape: (value: string) => value.replace(/([^\w-])/g, '\\$1') } as typeof CSS;
  }
  // jsdom does no layout; give every element a box unless it is display:none.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
    let node: Element | null = this;
    while (node) {
      if ((node as HTMLElement).style?.display === 'none' || node.hasAttribute('hidden')) return [] as unknown as DOMRectList;
      node = node.parentElement;
    }
    return [{ width: 100, height: 20 }] as unknown as DOMRectList;
  });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, left: 10, bottom: 30, right: 200, width: 190, height: 20, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
  Element.prototype.scrollIntoView = () => undefined;
});

const FORM = `
  <h1>Advising hold release</h1>
  <form id="hold">
    <label for="name">Student name</label><input id="name" name="studentName" required />
    <label for="email">Email</label><input id="email" name="email" type="email" />
    <label for="pw">Password</label><input id="pw" type="password" />
    <label for="term">Term</label>
    <select id="term" name="term"><option value="">Choose</option><option value="f26">Fall 2026</option><option value="s27">Spring 2027</option></select>
    <label><input type="checkbox" name="agree" /> I agree</label>
    <button type="submit">Submit request</button>
  </form>
  <a href="/help">Help</a>
  <button style="display:none">Hidden</button>
`;

function idOf(label: string) {
  return observePage('submit the hold form').elements.find((element) => element.label === label)!.id;
}

describe('observePage', () => {
  it('lists visible controls with labels, kinds, and form facts', () => {
    document.body.innerHTML = FORM;
    const page = observePage('submit the hold form');
    const labels = page.elements.map((element) => `${element.kind}:${element.label}`);
    expect(labels).toEqual([
      'input:Student name',
      'input:Email',
      'input:Password',
      'select:Term',
      'checkbox:I agree',
      'button:Submit request',
      'link:Help',
    ]);
    expect(page.elements.find((element) => element.label === 'Password')?.password).toBe(true);
    expect(page.elements.find((element) => element.label === 'Submit request')).toMatchObject({ submit: true, formFields: 4 });
    expect(page.password).toBe(true);
    const text = formatPage(page);
    expect(text).toContain('[4] select "Term" selected "Choose" options: Choose | Fall 2026 | Spring 2027');
    expect(text).toContain('-> /help');
  });

  it('lists only the open dialog when one covers the page', () => {
    document.body.innerHTML = `${FORM}<div role="dialog" aria-label="Cookies"><button>Accept all</button><button>Reject</button></div>`;
    const page = observePage('anything');
    expect(page.dialog).toBe('Cookies');
    expect(page.elements.map((element) => element.label)).toEqual(['Accept all', 'Reject']);
  });

  it('names dialogs and switches from aria-labelledby', () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true" aria-labelledby="t"><h2 id="t">Jordan Lee</h2><p>Operations</p><button>Close</button></section>
      <span id="sw">Email notifications</span><button role="switch" aria-checked="false" aria-labelledby="sw"></button>`;
    const page = observePage('x');
    expect(page.dialog).toBe('Jordan Lee');
    document.querySelector('[role="dialog"]')!.remove();
    expect(observePage('x').elements.find((element) => element.kind === 'checkbox')).toMatchObject({ label: 'Email notifications', checked: false });
  });

  it('changes the fingerprint when the page changes', () => {
    document.body.innerHTML = FORM;
    const before = observePage('x').fingerprint;
    (document.getElementById('name') as HTMLInputElement).value = 'Ada';
    expect(observePage('x').fingerprint).not.toBe(before);
  });
});

describe('performAction', () => {
  it('fills a form and returns replayable steps', () => {
    document.body.innerHTML = FORM;
    const typed = performAction({ action: 'TYPE', id: idOf('Student name'), text: 'Grace Hopper', say: '' });
    expect(typed.result).toMatchObject({ ok: true });
    expect(typed.result.step).toMatchObject({ kind: 'fill', value: 'Grace Hopper', variableKey: 'studentname' });
    expect((document.getElementById('name') as HTMLInputElement).value).toBe('Grace Hopper');

    const selected = performAction({ action: 'SELECT', id: idOf('Term'), option: 'spring 2027', say: '' });
    expect(selected.result.step).toMatchObject({ kind: 'fill', value: 'Spring 2027' });
    expect((document.getElementById('term') as HTMLSelectElement).value).toBe('s27');

    const checked = performAction({ action: 'CLICK', id: idOf('I agree'), say: '' });
    expect(checked.result.step).toMatchObject({ kind: 'check', value: 'on' });
    checked.later?.();
    expect((document.querySelector('input[name="agree"]') as HTMLInputElement).checked).toBe(true);
  });

  it('runs clicks after replying, so a navigation cannot swallow the reply', () => {
    document.body.innerHTML = FORM;
    // jsdom does not submit forms from button clicks, so watch the click itself.
    const clicked = vi.fn((event: Event) => event.preventDefault());
    document.querySelector('button[type="submit"]')!.addEventListener('click', clicked);
    const click = performAction({ action: 'CLICK', id: idOf('Submit request'), say: '' });
    expect(click.result.step).toMatchObject({ kind: 'click', label: 'Submit request' });
    expect(clicked).not.toHaveBeenCalled();
    click.later?.();
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('never types into password fields', () => {
    document.body.innerHTML = FORM;
    const result = performAction({ action: 'TYPE', id: idOf('Password'), text: 'secret', say: '' });
    expect(result.result.ok).toBe(false);
    expect((document.getElementById('pw') as HTMLInputElement).value).toBe('');
  });

  it('finds an element again after the page re-renders it', () => {
    document.body.innerHTML = FORM;
    const id = idOf('Email');
    // A framework re-render replaces the node with an identical one.
    const fresh = document.getElementById('email')!.cloneNode(true);
    document.getElementById('email')!.replaceWith(fresh);
    const result = performAction({ action: 'TYPE', id, text: 'grace@navy.mil', say: '' });
    expect(result.result.ok).toBe(true);
    expect(result.result.message).toMatch(/found it again/);
    expect((fresh as HTMLInputElement).value).toBe('grace@navy.mil');
  });

  it('reports elements that are gone for good', () => {
    document.body.innerHTML = FORM;
    const id = idOf('Help');
    document.body.innerHTML = '<p>Nothing here</p>';
    expect(performAction({ action: 'CLICK', id, say: '' }).result).toMatchObject({ ok: false });
  });

  it('verifies text and records a page check', () => {
    document.body.innerHTML = '<p>Request submitted for Grace Hopper</p>';
    expect(performAction({ action: 'VERIFY', text: 'request submitted', say: '' }).result.step).toMatchObject({ kind: 'assert' });
    expect(performAction({ action: 'VERIFY', text: 'Error', say: '' }).result.ok).toBe(false);
  });

  it('presses Enter by submitting the field form', () => {
    document.body.innerHTML = '<form id="s"><input name="q" aria-label="Search" /></form>';
    const submitted = vi.fn((event: Event) => event.preventDefault());
    document.getElementById('s')!.addEventListener('submit', submitted);
    const typed = performAction({ action: 'TYPE', id: idOf('Search'), text: 'laptops', submit: true, say: '' });
    expect(typed.result.step).toMatchObject({ kind: 'fill', pressEnter: true });
    typed.later?.();
    expect(submitted).toHaveBeenCalledOnce();
  });
});
