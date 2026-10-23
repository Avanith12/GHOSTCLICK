import { pageMarkdown } from '@/features/data/pageToMarkdown';
import { selectPassages } from '@/features/local-ai/relevance';
import { captchaPending } from '@/features/workflows/detectCaptcha';
import {
  describeElement,
  findStepElement,
  labelFor,
  pressEnter,
  setNativeValue,
  type DescribedElement,
} from '@/features/workflows/elementSelectors';
import { cleanText, words } from '@/shared/textHelpers';
import type { WorkflowStep } from '@/shared/types';
import type { ActResult, AgentAction, ElementKind, ObservedElement, PageObservation } from './types';

// Runs inside the web page. Builds the compact page description the model reads, and carries out
// one validated action at a time on the elements from the latest description.

const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'summary',
  '[contenteditable="true"]',
  '[contenteditable=""]',
  ...['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'option', 'combobox'].map((role) => `[role="${role}"]`),
].join(', ');
const OWN = '[data-ghostclick="hud"], [data-ghostclick="outline"], [data-ghostclick="marks"], [data-ghostclick="stop"]';
const DIALOG = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const MAX_LISTED = 40;
const TEXT_BUDGET = 700;
const READ_BUDGET = 2500;
const TEXT_FIELD = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="reset"]):not([type="image"]), textarea, select';

type Entry = { element: Element; described: DescribedElement; kind: ElementKind };

let registry: Entry[] = [];

function shown(element: Element) {
  if (element.closest(OWN)) return false;
  if (element.getClientRects().length === 0) return false;
  return getComputedStyle(element).visibility !== 'hidden';
}

function kindOf(element: Element): ElementKind {
  const tag = element.tagName;
  const role = element.getAttribute('role');
  if (element instanceof HTMLInputElement) {
    if (['submit', 'button', 'reset', 'image'].includes(element.type)) return 'button';
    if (element.type === 'checkbox') return 'checkbox';
    if (element.type === 'radio') return 'radio';
    return 'input';
  }
  if (tag === 'TEXTAREA') return 'textarea';
  if (tag === 'SELECT') return 'select';
  // An explicit role wins over the tag: <button role="switch"> is a toggle with an on/off state.
  if (role === 'checkbox' || role === 'switch') return 'checkbox';
  if (role === 'radio') return 'radio';
  if (tag === 'BUTTON' || tag === 'SUMMARY') return 'button';
  if (tag === 'A') return 'link';
  if (role === 'link') return 'link';
  if (element instanceof HTMLElement && element.isContentEditable) return 'editable';
  if (role) return 'button';
  return 'other';
}

/** The accessible name, roughly as a screen reader computes it: aria-labelledby wins, then labels and text. */
function nameOf(element: Element) {
  const labelledBy = (element.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => cleanText(id ? document.getElementById(id)?.textContent : ''))
    .filter(Boolean)
    .join(' ');
  if (labelledBy) return labelledBy.slice(0, 80);
  let label = labelFor(element);
  if (!label || label === element.tagName.toLowerCase()) {
    label = cleanText(element.getAttribute('title')) || cleanText(element.querySelector('img[alt]')?.getAttribute('alt')) || label;
  }
  // Drop leading icon glyphs ("▦Dashboard") that only cost tokens.
  return label.replace(/^[^\p{L}\p{N}"'(£$€]+/u, '').slice(0, 80);
}

function shortHref(anchor: Element) {
  const raw = anchor instanceof HTMLAnchorElement ? anchor.href : (anchor.getAttribute('href') ?? '');
  try {
    const url = new URL(raw, location.href);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    const text = url.origin === location.origin ? `${url.pathname}${url.search}` : `${url.host}${url.pathname}`;
    return text.slice(0, 80);
  } catch {
    return undefined;
  }
}

function inViewport(element: Element) {
  const box = element.getBoundingClientRect();
  return box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
}

function submits(element: Element) {
  if (element instanceof HTMLButtonElement) return Boolean(element.form) && element.type === 'submit';
  return element instanceof HTMLInputElement && Boolean(element.form) && (element.type === 'submit' || element.type === 'image');
}

function formFieldCount(element: Element) {
  const form = element.closest('form');
  return form ? form.querySelectorAll(TEXT_FIELD).length : undefined;
}

function topDialog() {
  const open = [...document.querySelectorAll(DIALOG)].filter(
    (dialog) => shown(dialog) && dialog.querySelector(INTERACTIVE) && dialog.getBoundingClientRect().width > 120,
  );
  return open.at(-1) ?? null;
}

function invalidMessage(element: Element) {
  if (element.getAttribute('aria-invalid') === 'true') return 'marked invalid';
  if (
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) &&
    element.value &&
    !element.validity.valid
  ) {
    return element.validationMessage || 'invalid value';
  }
  return undefined;
}

function describe(element: Element, id: number, kind: ElementKind): ObservedElement {
  const item: ObservedElement = { id, kind, label: nameOf(element), inView: inViewport(element) };
  if (element instanceof HTMLInputElement) {
    item.type = element.type;
    if (element.type === 'password') item.password = true;
    else if (kind === 'input' && element.value) item.value = element.value.slice(0, 60);
    if (kind === 'checkbox' || kind === 'radio') item.checked = element.checked;
    item.required = element.required || undefined;
  } else if (element instanceof HTMLTextAreaElement) {
    if (element.value) item.value = element.value.slice(0, 60);
    item.required = element.required || undefined;
  } else if (element instanceof HTMLSelectElement) {
    item.options = [...element.options].slice(0, 12).map((option) => cleanText(option.textContent)).filter(Boolean);
    item.value = cleanText(element.selectedOptions[0]?.textContent) || undefined;
    item.required = element.required || undefined;
  } else if (kind === 'checkbox' || kind === 'radio') {
    item.checked = element.getAttribute('aria-checked') === 'true';
  } else if (kind === 'editable') {
    const text = cleanText(element.textContent);
    if (text) item.value = text.slice(0, 60);
  }
  if (kind === 'link') item.href = shortHref(element);
  if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') item.disabled = true;
  if (submits(element)) item.submit = true;
  const fields = formFieldCount(element);
  if (fields !== undefined) item.formFields = fields;
  const invalid = invalidMessage(element);
  if (invalid) item.invalid = invalid;
  return item;
}

function bodyText() {
  const body = document.body;
  if (!body) return '';
  return (body.innerText ?? body.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function pageProblems() {
  const problems = new Set<string>();
  for (const node of document.querySelectorAll('[role="alert"], .error, .error-message, .invalid-feedback, .field-error')) {
    const text = cleanText(node.textContent).slice(0, 140);
    if (text && shown(node)) problems.add(text);
    if (problems.size >= 5) break;
  }
  return [...problems];
}

function hash(text: string) {
  let value = 5381;
  for (let index = 0; index < text.length; index += 1) value = ((value << 5) + value + text.charCodeAt(index)) | 0;
  return (value >>> 0).toString(36);
}

/** Describe the current page for the model. Element ids stay valid until the next call. */
export function observePage(goal: string): PageObservation {
  const dialog = topDialog();
  const root: ParentNode = dialog ?? document;
  const wanted = words(goal);
  const found = [...root.querySelectorAll(INTERACTIVE)].filter((element) => {
    if (!shown(element)) return false;
    // A control nested inside another listed control (an icon button inside a link) is one target.
    return !element.parentElement?.closest('a[href], button');
  });

  const labels = found.map((element) => nameOf(element).toLowerCase());
  // Weight goal words by how rare they are among the labels: "profile" on fifty "Open …'s profile"
  // links says nothing, while "jordan" on one link says a lot.
  const weight = new Map(
    [...wanted].map((word) => {
      const hits = labels.filter((label) => label.includes(word)).length;
      return [word, hits === 0 ? 0 : hits <= 2 ? 6 : hits <= 6 ? 2 : 0.3];
    }),
  );
  const scored = found.map((element, order) => {
    const kind = kindOf(element);
    const label = labels[order]!;
    let score = inViewport(element) ? 3 : 0;
    for (const word of wanted) if (label.includes(word)) score += weight.get(word) ?? 0;
    if (['input', 'textarea', 'select', 'editable'].includes(kind)) score += 2;
    // Search boxes are how a person finds what is not on screen.
    if (/search/.test(label) || (element instanceof HTMLInputElement && element.type === 'search')) score += 4;
    if (submits(element)) score += 1;
    return { element, kind, order, score };
  });
  const kept = [...scored]
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .slice(0, MAX_LISTED)
    .sort((left, right) => left.order - right.order);

  registry = kept.map(({ element, kind }) => ({ element, kind, described: describeElement(element) }));
  const elements = kept.map(({ element, kind, score }, index) => ({ ...describe(element, index + 1, kind), priority: score }));

  // Leave out lines that only repeat a listed control's name or are stray symbols; the model already
  // sees those in the element list.
  const listed = new Set(elements.map((element) => element.label.toLowerCase()));
  const lines = bodyText()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 2 && !listed.has(line.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()));
  const text = selectPassages(goal, lines.join('\n'), TEXT_BUDGET);
  const problems = pageProblems();
  for (const element of elements) if (element.invalid) problems.push(`"${element.label}": ${element.invalid}`);
  const root2 = document.scrollingElement ?? document.documentElement;
  const dialogName = dialog
    ? cleanText(dialog.getAttribute('aria-label')) ||
      (dialog.getAttribute('aria-labelledby') ? nameOf(dialog) : '') ||
      cleanText(dialog.querySelector('h1, h2, h3, [role="heading"]')?.textContent).slice(0, 80) ||
      'a dialog'
    : undefined;

  return {
    url: location.href,
    title: cleanText(document.title).slice(0, 120),
    elements,
    hidden: Math.max(0, found.length - kept.length),
    text,
    dialog: dialogName,
    problems: problems.slice(0, 6),
    password: [...document.querySelectorAll('input[type="password"]')].some(shown),
    captcha: captchaPending(),
    atBottom: window.innerHeight + window.scrollY >= root2.scrollHeight - 4,
    fingerprint: hash(`${location.href}|${elements.map((item) => `${item.label}=${item.value ?? ''}${item.checked ?? ''}`).join(',')}|${text.length}|${dialogName ?? ''}`),
  };
}

/** Find the element behind an id, rediscovering it from its recorded selectors if the page re-rendered it. */
function resolve(id: number | undefined) {
  const entry = id ? registry[id - 1] : undefined;
  if (!entry) return null;
  if (entry.element.isConnected && shown(entry.element)) return { ...entry, healed: false };
  const again = findStepElement({
    kind: entry.kind === 'link' || entry.kind === 'button' ? 'click' : 'fill',
    selector: entry.described.selector,
    fallbacks: entry.described.fallbacks,
    label: entry.described.label,
  });
  return again ? { ...entry, element: again, healed: true } : null;
}

function stepFor(element: Element, kind: WorkflowStep['kind'], value?: string, extra: Partial<WorkflowStep> = {}): WorkflowStep {
  const described = describeElement(element);
  return {
    id: crypto.randomUUID(),
    kind,
    url: location.href,
    selector: described.selector,
    fallbacks: described.fallbacks,
    label: described.label,
    value,
    variableKey: kind === 'click' ? undefined : described.variableKey,
    inputType: described.inputType,
    ...extra,
  };
}

function flash(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const previous = element.style.outline;
  element.style.outline = '3px solid #c4552a';
  window.setTimeout(() => {
    element.style.outline = previous;
  }, 900);
}

function clickElement(element: Element) {
  if (element instanceof HTMLElement) element.click();
  else element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function typeInto(element: Element, text: string) {
  if (element instanceof HTMLElement) element.focus();
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, text);
    return;
  }
  // Rich editors listen for real editing commands; fall back to plain text where those are missing.
  const selection = window.getSelection();
  selection?.selectAllChildren(element);
  let inserted = false;
  try {
    inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

function readPage(query: string) {
  let source = '';
  try {
    source = pageMarkdown().markdown;
  } catch {
    source = '';
  }
  if (source.length < 200) source = bodyText();
  return query ? selectPassages(query, source, READ_BUDGET) : source.slice(0, READ_BUDGET);
}

export type Performed = { result: ActResult; later?: () => void };

/**
 * Run one action in the page. Anything that can navigate away is returned as `later`, so the
 * caller can answer the side panel first; otherwise the page unload would swallow the reply.
 */
export function performAction(action: AgentAction): Performed {
  const fail = (message: string): Performed => ({ result: { ok: false, message } });
  const needsElement = ['CLICK', 'TYPE', 'CLEAR', 'SELECT', 'HOVER', 'SUBMIT', 'DOWNLOAD'].includes(action.action);
  const target = needsElement || (action.action === 'SCROLL' && action.id) ? resolve(action.id) : null;
  if ((needsElement || (action.action === 'SCROLL' && action.id)) && !target) {
    return fail(`Element [${action.id}] is no longer on the page. Look at the updated element list.`);
  }
  const healed = target?.healed ? ' (found it again after the page changed)' : '';
  const element = target?.element;

  switch (action.action) {
    case 'CLICK': {
      if (!element) break;
      const label = nameOf(element);
      if (element instanceof HTMLSelectElement) return fail(`[${action.id}] is a dropdown. Use SELECT with an option.`);
      element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
      flash(element);
      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        const on = element.type === 'radio' ? true : !element.checked;
        return {
          result: { ok: true, message: `${on ? 'Checked' : 'Unchecked'} "${label}"${healed}.`, step: stepFor(element, 'check', on ? 'on' : 'off') },
          later: () => {
            if (element.checked !== on) element.click();
          },
        };
      }
      return {
        result: { ok: true, message: `Clicked "${label}"${healed}.`, step: stepFor(element, 'click') },
        later: () => clickElement(element),
      };
    }
    case 'TYPE':
    case 'CLEAR': {
      if (!element) break;
      if (element instanceof HTMLInputElement && element.type === 'password') {
        return fail('Ghostclick never types passwords. Use ASK_USER so the person can type it.');
      }
      const text = action.action === 'CLEAR' ? '' : (action.text ?? '');
      typeInto(element, text);
      flash(element);
      const label = nameOf(element);
      const submit = action.action === 'TYPE' && Boolean(action.submit);
      const step = element instanceof HTMLElement && !element.isContentEditable
        ? stepFor(element, 'fill', text, submit ? { pressEnter: true } : {})
        : undefined;
      return {
        result: {
          ok: true,
          message: action.action === 'CLEAR' ? `Cleared "${label}"${healed}.` : `Typed "${text}" into "${label}"${submit ? ' and pressed Enter' : ''}${healed}.`,
          step,
        },
        later: submit ? () => pressEnter(element) : undefined,
      };
    }
    case 'SELECT': {
      if (!(element instanceof HTMLSelectElement)) return fail(`[${action.id}] is not a dropdown.`);
      const wanted = (action.option ?? '').trim().toLowerCase();
      const options = [...element.options];
      const option =
        options.find((item) => item.value.toLowerCase() === wanted || cleanText(item.textContent).toLowerCase() === wanted) ??
        options.find((item) => cleanText(item.textContent).toLowerCase().includes(wanted));
      if (!option) {
        return fail(`"${action.option}" is not an option. Options: ${options.map((item) => cleanText(item.textContent)).slice(0, 12).join(' | ')}`);
      }
      const text = cleanText(option.textContent);
      setNativeValue(element, option.value);
      flash(element);
      return { result: { ok: true, message: `Selected "${text}" in "${nameOf(element)}"${healed}.`, step: stepFor(element, 'fill', text) } };
    }
    case 'HOVER': {
      if (!element) break;
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: !type.endsWith('enter'), view: window }));
      }
      return { result: { ok: true, message: `Hovered over "${nameOf(element)}".` } };
    }
    case 'SCROLL': {
      if (element) {
        element.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        return { result: { ok: true, message: `Scrolled to "${nameOf(element)}".` } };
      }
      const direction = action.direction ?? 'down';
      if (direction === 'top') window.scrollTo(0, 0);
      else if (direction === 'bottom') window.scrollTo(0, document.documentElement.scrollHeight);
      else window.scrollBy(0, (direction === 'up' ? -0.85 : 0.85) * window.innerHeight);
      return { result: { ok: true, message: `Scrolled ${direction}.` } };
    }
    case 'READ': {
      const text = readPage(action.text ?? '');
      return { result: { ok: Boolean(text), message: text ? `Read ${text.length} characters of the page.` : 'The page has no readable text.', text } };
    }
    case 'VERIFY': {
      const expected = (action.text ?? '').trim();
      const passed = bodyText().toLowerCase().includes(expected.toLowerCase());
      return {
        result: {
          ok: passed,
          message: passed ? `Verified: the page shows "${expected}".` : `Not verified: "${expected}" is not on the page.`,
          step: passed
            ? { id: crypto.randomUUID(), kind: 'assert', url: location.href, selector: '', fallbacks: [], label: 'Page check', expectedText: expected.slice(0, 200) }
            : undefined,
        },
      };
    }
    case 'SUBMIT': {
      if (!element) break;
      const form = element instanceof HTMLFormElement ? element : element.closest('form');
      if (!form) return fail(`[${action.id}] is not inside a form. CLICK its submit button instead.`);
      const button = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
      if (button && shown(button)) {
        flash(button);
        return {
          result: { ok: true, message: `Submitted the form with "${nameOf(button)}".`, step: stepFor(button, 'click') },
          later: () => clickElement(button),
        };
      }
      return {
        result: { ok: true, message: 'Submitted the form.' },
        later: () => (typeof form.requestSubmit === 'function' ? form.requestSubmit() : form.submit()),
      };
    }
    case 'DOWNLOAD': {
      if (!element) break;
      const href = element instanceof HTMLAnchorElement ? element.href : element.getAttribute('href');
      return href ? { result: { ok: true, message: `Found the file link "${nameOf(element)}".`, href } } : fail('That element has no link.');
    }
    default:
      return fail(`${action.action} does not run inside the page.`);
  }
  return fail(`Element [${action.id}] could not be used.`);
}

/** Exposed for tests: how many elements the last observation listed. */
export function listedCount() {
  return registry.length;
}
