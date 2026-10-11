import { cleanText, slug } from './format';
import type { WorkflowStep } from './types';

export type DescribedElement = {
  selector: string;
  fallbacks: string[];
  label: string;
  variableKey?: string;
  inputType?: string;
  value?: string;
};

function stableId(id: string) {
  if (!id || id.length > 40) return false;
  if (/[:.]/.test(id)) return false;
  return !/^(ember|react|radix|mui|headless)/i.test(id);
}

function cssPath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.body && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = [...parent.children].filter((child) => child.tagName === current?.tagName);
    const index = sameTag.indexOf(current) + 1;
    parts.unshift(`${tag}:nth-of-type(${index})`);
    current = parent;
  }
  return parts.join(' > ');
}

export function labelFor(element: Element) {
  if (element.id) {
    const explicit = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    const explicitText = cleanText(explicit?.textContent);
    if (explicitText) return explicitText;
  }

  const wrapping = element.closest('label');
  if (wrapping) {
    const clone = wrapping.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea, button').forEach((node) => node.remove());
    const wrappingText = cleanText(clone.textContent);
    if (wrappingText) return wrappingText;
  }

  const aria = element.getAttribute('aria-label');
  if (aria) return cleanText(aria);
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return cleanText(placeholder);

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.getAttribute('name') || element.id || element.tagName.toLowerCase();
  }

  return cleanText(element.textContent) || element.getAttribute('value') || element.tagName.toLowerCase();
}

function formScoped(element: Element) {
  const submit =
    element.tagName === 'BUTTON' ||
    (element instanceof HTMLInputElement && (element.type === 'submit' || element.type === 'button'));
  const form = element.closest('form');
  if (!submit || !form) return '';
  const action = form.getAttribute('action');
  const formSelector =
    form.id && stableId(form.id)
      ? `#${CSS.escape(form.id)}`
      : action
        ? `form[action="${CSS.escape(action)}"]`
        : '';
  if (!formSelector) return '';
  const type = element.getAttribute('type');
  const selector = `${formSelector} ${element.tagName.toLowerCase()}${type ? `[type="${CSS.escape(type)}"]` : ''}`;
  try {
    return document.querySelector(selector) === element ? selector : '';
  } catch {
    return '';
  }
}

function visible(element: Element) {
  return element.getClientRects().length > 0;
}

export function describeElement(element: Element): DescribedElement {
  const fallbacks: string[] = [];
  if (element.id && stableId(element.id)) fallbacks.push(`#${CSS.escape(element.id)}`);

  const testId = element.getAttribute('data-testid');
  if (testId) fallbacks.push(`[data-testid="${CSS.escape(testId)}"]`);

  const name = element.getAttribute('name');
  if (name) fallbacks.push(`${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`);

  const aria = element.getAttribute('aria-label');
  if (aria) fallbacks.push(`[aria-label="${CSS.escape(aria)}"]`);

  const label = labelFor(element);
  const isButton =
    element.tagName === 'BUTTON' ||
    element.tagName === 'A' ||
    element.getAttribute('role') === 'button';
  const scoped = formScoped(element);
  if (scoped) fallbacks.push(scoped);
  if (isButton && label && label.length < 48) fallbacks.push(`text:${label}`);

  const path = cssPath(element);
  if (path) fallbacks.push(path);

  const selector = fallbacks[0] ?? path;
  const field =
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement;
  const variableKey = field ? slug(name || (stableId(element.id) ? element.id : label)) : undefined;

  return {
    selector,
    fallbacks: fallbacks.filter((item) => item !== selector),
    label,
    variableKey: variableKey || undefined,
    inputType: element instanceof HTMLInputElement ? element.type : undefined,
    value: readValue(element),
  };
}

export function readValue(element: Element) {
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    return element.checked ? 'on' : 'off';
  }
  if (element instanceof HTMLInputElement && element.type === 'password') return '';
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  ) {
    return element.value;
  }
  return undefined;
}

export function findBySelector(selector: string) {
  if (selector.startsWith('text:')) {
    const expected = selector.slice(5).trim().toLowerCase();
    const nodes = document.querySelectorAll('button, a, [role="button"], input[type="submit"]');
    let fallback: Element | null = null;
    for (const node of nodes) {
      if (node.closest('[data-ghostclick]')) continue;
      const text = cleanText(node.textContent || node.getAttribute('value')).toLowerCase();
      if (text !== expected) continue;
      if (visible(node)) return node;
      fallback ??= node;
    }
    return fallback;
  }

  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function accepts(element: Element, selector: string, step: Pick<WorkflowStep, 'kind' | 'label'>) {
  if (step.kind !== 'click') return true;
  const specific =
    selector.startsWith('#') ||
    selector.startsWith('text:') ||
    selector.includes('[name=') ||
    selector.includes('data-testid') ||
    selector.includes('aria-label');
  if (specific) return true;
  return cleanText(element.textContent || element.getAttribute('value')).toLowerCase() === step.label.toLowerCase();
}

export function findStepElement(step: Pick<WorkflowStep, 'kind' | 'selector' | 'fallbacks' | 'label'>) {
  for (const selector of [step.selector, ...step.fallbacks]) {
    const element = findBySelector(selector);
    if (element && !element.closest('[data-ghostclick]') && accepts(element, selector, step)) {
      return element;
    }
  }
  return null;
}

export function setNativeValue(element: HTMLElement, value: string) {
  if (element instanceof HTMLSelectElement) {
    const option = [...element.options].find(
      (item) => item.value === value || cleanText(item.textContent) === value,
    );
    if (option) element.value = option.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const prototype =
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export function clickableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest(
    'button, a, [role="button"], input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"]',
  );
}

export function fieldTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const field = target.closest('input, textarea, select');
  if (!(field instanceof HTMLElement)) return null;
  if (field instanceof HTMLInputElement && ['checkbox', 'radio', 'submit', 'button', 'file'].includes(field.type)) {
    return null;
  }
  return field;
}

export function collectCandidates() {
  const nodes = document.querySelectorAll('button, a, input, select, textarea, [role="button"]');
  const candidates = [];
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || node.closest('[data-ghostclick]') || !visible(node)) continue;
    if (node instanceof HTMLInputElement && ['hidden', 'file'].includes(node.type)) continue;
    const described = describeElement(node);
    candidates.push({
      selector: described.selector,
      label: described.label || node.tagName.toLowerCase(),
      tag: node.tagName.toLowerCase(),
      score: 0,
    });
    if (candidates.length >= 400) break;
  }
  return candidates;
}
