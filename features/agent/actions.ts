import { ACTION_NAMES, type ActionName, type AgentAction, type ObservedElement, type PageObservation } from './types';

const NEEDS_ELEMENT = new Set<ActionName>(['CLICK', 'TYPE', 'CLEAR', 'SELECT', 'HOVER', 'DOWNLOAD', 'SUBMIT', 'UPLOAD_FILE']);
const NEEDS_TEXT = new Set<ActionName>(['TYPE', 'SEARCH', 'VERIFY', 'NOTE', 'ASK_USER', 'FINISH']);
const ALIASES: Record<string, ActionName> = {
  GOTO: 'NAVIGATE',
  OPEN: 'NAVIGATE',
  OPEN_URL: 'NAVIGATE',
  FILL: 'TYPE',
  INPUT: 'TYPE',
  PRESS: 'CLICK',
  TAP: 'CLICK',
  BACK: 'GO_BACK',
  FORWARD: 'GO_FORWARD',
  DONE: 'FINISH',
  ANSWER: 'FINISH',
  SCRAPE: 'EXTRACT',
  ASK: 'ASK_USER',
  NEW_TAB: 'OPEN_TAB',
  CHECK: 'CLICK',
  REMEMBER: 'NOTE',
};

/** Pull the first complete JSON object out of a model reply, ignoring any text around it. */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1));
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const match = typeof value === 'string' ? value.match(/\d+/) : null;
  return match ? Number(match[0]) : undefined;
}

function asText(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text ? text.slice(0, 2000) : undefined;
}

/** Turn loose model JSON into an action object; field names and casing are forgiven, unknown actions are not. */
export function parseAction(reply: string): AgentAction | null {
  const raw = firstJsonObject(reply);
  if (!raw) return null;
  const name = String(raw.action ?? raw.type ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  // Models sometimes copy notation such as "NAVIGATE url"; fall back to the first word.
  const known = (value: string) => ((ACTION_NAMES as readonly string[]).includes(value) ? (value as ActionName) : ALIASES[value]);
  const action = known(name) ?? known(name.replace(/_(URL|ID|TEXT|OPTION|TAB)$/, '')) ?? known(name.split('_')[0] ?? '');
  if (!action) return null;
  const direction = String(raw.direction ?? '').toLowerCase();
  return {
    action,
    say: (asText(raw.say ?? raw.reason ?? raw.thought) ?? '').slice(0, 240),
    id: asNumber(raw.id ?? raw.element ?? raw.index),
    text: asText(raw.text ?? raw.value ?? raw.query ?? raw.result ?? raw.question ?? raw.answer),
    url: asText(raw.url ?? raw.href),
    option: asText(raw.option ?? raw.choice ?? raw.value),
    direction: ['up', 'down', 'top', 'bottom'].includes(direction) ? (direction as AgentAction['direction']) : undefined,
    submit: raw.submit === true || raw.submit === 'true' || raw.enter === true,
    tab: asNumber(raw.tab),
    ms: asNumber(raw.ms) ?? (raw.seconds === undefined ? undefined : asNumber(Number(raw.seconds) * 1000)),
    success: raw.success === undefined ? undefined : raw.success === true || raw.success === 'true',
  };
}

/**
 * Make a model-written address safe to open: only http(s), with a scheme added when missing. Paths
 * such as "/directory.html" or "page.html" resolve against `base`, the page the agent is on.
 */
export function normalizeUrl(value: string | undefined, base?: string): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const relative = /^(\/|\.\.?\/|\?|#)/.test(text) || /^[\w-]+\.(html?|php|aspx?)([?#].*)?$/i.test(text);
  if (relative) {
    if (!base || !/^https?:/i.test(base)) return null;
    try {
      return new URL(text, base).href;
    } catch {
      return null;
    }
  }
  // "localhost:4173" looks like a scheme to URL(), so only treat "x://" and known non-web schemes as one.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(javascript|data|mailto|about|blob|chrome|file|vbscript|view-source):/i.test(text);
  const withScheme = hasScheme ? text : `https://${text.replace(/^\/+/, '')}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    return url.href;
  } catch {
    return null;
  }
}

export function siteList(text: string) {
  return text
    .split(/[\s,]+/)
    .map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, ''))
    .filter(Boolean);
}

export function isBlocked(url: string, blocked: string[]) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return blocked.some((site) => host === site || host.endsWith(`.${site}`));
}

export type Checked = { ok: true; action: AgentAction; element?: ObservedElement } | { ok: false; error: string };

/**
 * Fix an action whose verb plainly does not fit its element, when the intent is unambiguous: SELECT on
 * a text box means TYPE, CLICK with an option on a dropdown means SELECT, and SELECT on a link or
 * button means CLICK only if no other text was asked for (otherwise the model wanted something else).
 */
function repairKind(action: AgentAction, element: ObservedElement | undefined): AgentAction {
  if (!element) return action;
  const wanted = action.option ?? action.text;
  if (action.action === 'SELECT' && element.kind !== 'select') {
    if (['input', 'textarea', 'editable'].includes(element.kind) && wanted) return { ...action, action: 'TYPE', text: wanted };
    const matches = !wanted || element.label.toLowerCase().includes(wanted.toLowerCase());
    if (['link', 'button', 'checkbox', 'radio', 'other'].includes(element.kind) && matches) return { ...action, action: 'CLICK' };
  }
  if (action.action === 'CLICK' && element.kind === 'select' && wanted) return { ...action, action: 'SELECT', option: wanted };
  return action;
}

/** Check an action against the current page before anything runs. */
export function validateAction(proposed: AgentAction, page: PageObservation | null, tabCount: number): Checked {
  const element = proposed.id === undefined ? undefined : page?.elements.find((item) => item.id === proposed.id);
  const action = repairKind(proposed, element);
  if (NEEDS_ELEMENT.has(action.action)) {
    if (!page) return { ok: false, error: `${action.action} needs a web page. Use NAVIGATE or SEARCH first.` };
    if (action.id === undefined) return { ok: false, error: `${action.action} needs "id", the [number] of an element in the list.` };
    if (!element) return { ok: false, error: `There is no element [${action.id}] on this page. Use an id from the current list.` };
    if (element.disabled && action.action !== 'HOVER') return { ok: false, error: `Element [${action.id}] "${element.label}" is disabled.` };
  }
  if (NEEDS_TEXT.has(action.action) && !action.text) {
    return { ok: false, error: `${action.action} needs "text".` };
  }
  switch (action.action) {
    case 'NAVIGATE':
    case 'OPEN_TAB': {
      const url = normalizeUrl(action.url ?? action.text, page?.url);
      if (!url) return { ok: false, error: `${action.action} needs a full http(s) "url".` };
      return { ok: true, action: { ...action, url } };
    }
    case 'TYPE':
    case 'CLEAR':
      if (element && !['input', 'textarea', 'editable'].includes(element.kind)) {
        return { ok: false, error: `Element [${element.id}] is a ${element.kind}, not a text field.` };
      }
      if (element?.password) {
        return { ok: false, error: 'Ghostclick never types passwords. Use ASK_USER so the person can type it.' };
      }
      break;
    case 'SELECT':
      if (element?.kind !== 'select') {
        const wanted = action.option ?? action.text;
        return {
          ok: false,
          error: wanted
            ? `[${action.id}] is a ${element?.kind ?? 'control'}, not a dropdown. To look for "${wanted}", TYPE it into a search box; to use [${action.id}], CLICK it.`
            : `[${action.id}] is a ${element?.kind ?? 'control'}, not a dropdown. CLICK it instead.`,
        };
      }
      if (!action.option && !action.text) return { ok: false, error: 'SELECT needs "option".' };
      return { ok: true, action: { ...action, option: action.option ?? action.text }, element };
    case 'DOWNLOAD':
      if (!element?.href) return { ok: false, error: `Element [${action.id}] is not a link to a file.` };
      break;
    case 'SWITCH_TAB':
      if (!action.tab || action.tab < 1 || action.tab > tabCount) return { ok: false, error: `SWITCH_TAB needs "tab" between 1 and ${tabCount}.` };
      break;
    case 'CLOSE_TAB':
      if (tabCount < 2) return { ok: false, error: 'This is the only tab, so it cannot be closed.' };
      if (action.tab !== undefined && (action.tab < 1 || action.tab > tabCount)) {
        return { ok: false, error: `CLOSE_TAB "tab" must be between 1 and ${tabCount}.` };
      }
      break;
    case 'WAIT':
      return { ok: true, action: { ...action, ms: Math.min(5000, Math.max(500, action.ms ?? 1500)) } };
    case 'READ':
    case 'EXTRACT':
    case 'VERIFY':
    case 'SCROLL':
    case 'SCREENSHOT':
      if (!page) return { ok: false, error: `${action.action} needs a web page. Use NAVIGATE or SEARCH first.` };
      break;
    default:
      break;
  }
  return { ok: true, action, element };
}

// Words on a button or link that commit the person to something. Kept narrow on purpose: asking
// about every filter "Apply" or product named "…Book" would teach people to approve without reading.
const CONSEQUENTIAL =
  /\b(buy|purchase|pay|payment|place (an |the |my )?order|order now|send|submit|apply (now|for)|delete|remove|erase|publish|post|tweet|transfer|donate|subscribe|unsubscribe|sign up|register|book (now|it|this|a|the)|reserve|save changes|deactivate|close (my )?account|cancel (my |the )?(subscription|account|order|booking))\b/i;
// Buttons that move within a page or a multi-step form rather than send it anywhere.
const STEP_LABEL = /^(next|continue|back|previous|apply( filters?)?|search|filter|go|update|refresh|show|load more)\b/i;

/** Return why this action needs the person's approval first, or null when it can run on its own. */
export function needsApproval(action: AgentAction, element?: ObservedElement): string | null {
  if (!element) return null;
  const label = `"${element.label}"`;
  const bigForm = (element.formFields ?? 0) >= 2;
  if (action.action === 'SUBMIT') {
    if (CONSEQUENTIAL.test(element.label)) return `Submit the form containing ${label}.`;
    return (element.formFields ?? 0) <= 1 || STEP_LABEL.test(element.label) ? null : `Submit the form containing ${label}.`;
  }
  // Ticking a box such as "I agree" only changes the page; the button that sends it is what asks.
  if (action.action === 'CLICK' && !['checkbox', 'radio', 'input', 'textarea', 'select'].includes(element.kind)) {
    if (CONSEQUENTIAL.test(element.label)) return `Click ${label}, which may have real consequences.`;
    if (element.submit && bigForm && !STEP_LABEL.test(element.label)) return `Click ${label}, which submits a form.`;
  }
  const searchBox = element.type === 'search' || /search/i.test(element.label);
  if (action.action === 'TYPE' && action.submit && bigForm && !searchBox) return `Type into ${label} and press Enter, which submits a form.`;
  return null;
}

/** A key that identifies "the same action again", used to catch loops. */
export function actionKey(action: AgentAction, element?: ObservedElement) {
  return [action.action, element ? `${element.kind}:${element.label}` : '', action.url ?? '', action.text ?? '', action.option ?? '', action.direction ?? '', action.tab ?? ''].join('|');
}

export function describeAction(action: AgentAction, element?: ObservedElement) {
  const target = element ? ` [${element.id}] "${element.label}"` : '';
  switch (action.action) {
    case 'NAVIGATE':
    case 'OPEN_TAB':
      return `${action.action} ${action.url}`;
    case 'TYPE':
      return `TYPE "${action.text}" into${target}${action.submit ? ' + Enter' : ''}`;
    case 'SELECT':
      return `SELECT "${action.option}" in${target}`;
    case 'SEARCH':
      return `SEARCH "${action.text}"`;
    case 'SWITCH_TAB':
      return `SWITCH_TAB ${action.tab}`;
    case 'SCROLL':
      return `SCROLL ${element ? `to${target}` : (action.direction ?? 'down')}`;
    case 'READ':
    case 'VERIFY':
    case 'NOTE':
    case 'ASK_USER':
      return `${action.action}${action.text ? ` "${action.text.slice(0, 80)}"` : ''}`;
    case 'FINISH':
      return `FINISH (${action.success === false ? 'not possible' : 'done'})`;
    default:
      return `${action.action}${target}`;
  }
}
