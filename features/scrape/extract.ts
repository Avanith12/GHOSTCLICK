import { cleanText } from '@/shared/format';
import type { ExtractField, ExtractSpec, Row } from '@/shared/types';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT']);
const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);

function stableId(id: string) {
  return Boolean(id) && id.length <= 40 && !/[:.]/.test(id) && !/\d{4,}/.test(id);
}

export function absolutePath(element: Element): string {
  if (element.id && stableId(element.id)) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current !== document.documentElement) {
    if (current.id && stableId(current.id)) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const same = [...parent.children].filter((child) => child.tagName === current?.tagName);
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(current) + 1})` : tag);
    current = parent;
  }
  return parts.join(' > ');
}

function firstClass(element: Element) {
  return [...element.classList].find((name) => /^[a-z][\w-]*$/i.test(name) && !/^(active|selected|is-|has-)/.test(name));
}

function keyOf(element: Element) {
  const tag = element.tagName.toLowerCase();
  const cls = firstClass(element);
  if (cls) return `${tag}.${CSS.escape(cls)}`;
  const testId = element.getAttribute('data-testid');
  if (testId && !/\d{3,}/.test(testId)) return `${tag}[data-testid="${CSS.escape(testId)}"]`;
  return tag;
}

function outermost(elements: Element[]) {
  const set = new Set(elements);
  return elements.filter((element) => {
    for (let node = element.parentElement; node; node = node.parentElement) {
      if (set.has(node)) return false;
    }
    return true;
  });
}

function matchItems(itemSelector: string, requires?: string) {
  let found: Element[];
  try {
    found = [...document.querySelectorAll(itemSelector)];
    if (requires) found = found.filter((item) => item.querySelector(requires));
  } catch {
    return [];
  }
  return outermost(found.filter((item) => !item.closest('[data-ghostclick]')));
}

function findItems(clicked: Element) {
  let best: { item: Element; selector: string; requires: string; count: number } | null = null;
  const path = [keyOf(clicked)];
  for (let node = clicked.parentElement; node && node !== document.body; node = node.parentElement) {
    const selector = node.parentElement ? `${keyOf(node.parentElement)} > ${keyOf(node)}` : keyOf(node);
    const requires = `:scope > ${path.join(' > ')}`;
    const count = matchItems(selector, requires).length;
    if (count >= 3 && count <= 1000 && (!best || count >= best.count)) best = { item: node, selector, requires, count };
    path.unshift(keyOf(node));
    if (path.length > 12) break;
  }
  return best;
}

function partnerOf(items: Element[]) {
  const sample = items.slice(0, 5).map((item) => item.nextElementSibling);
  const first = sample[0];
  if (!first || sample.some((element) => !element || items.includes(element))) return null;
  const key = keyOf(first);
  return sample.every((element) => element && keyOf(element) === key) ? first : null;
}

function classKey(element: Element) {
  const cls = firstClass(element);
  return cls ? `${element.tagName.toLowerCase()}.${CSS.escape(cls)}` : '';
}

function relativePath(root: Element, target: Element) {
  if (root === target) return '';
  const key = classKey(target);
  if (key && root.querySelectorAll(key).length === 1) return key;
  const steps: string[] = [];
  for (let node: Element | null = target; node && node !== root; node = node.parentElement) {
    steps.unshift(classKey(node) || node.tagName.toLowerCase());
  }
  const chain = `:scope > ${steps.join(' > ')}`;
  try {
    if (root.querySelector(chain) === target) return chain;
  } catch {
    // fall through to positions
  }
  const parts: string[] = [];
  let current: Element | null = target;
  while (current && current !== root) {
    const parent: Element | null = current.parentElement;
    if (!parent) break;
    const tag = current.tagName.toLowerCase();
    const same = [...parent.children].filter((child) => child.tagName === current?.tagName);
    parts.unshift(`${tag}:nth-of-type(${same.indexOf(current) + 1})`);
    current = parent;
  }
  return `:scope > ${parts.join(' > ')}`;
}

function ownText(element: Element) {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return cleanText(text);
}

const NOISE = new Set([
  'styles', 'styled', 'style', 'wrapper', 'container', 'inner', 'outer', 'text', 'color', 'sc', 'css', 'js',
  'item', 'block', 'box', 'component', 'root', 'base', 'col', 'row', 'size', 'small', 'medium', 'large',
  'normal', 'link', 'section', 'flex', 'grid', 'mb', 'mt', 'px', 'py', 'pl', 'pr', 'visible', 'sr',
  'tmp', 'mr', 'ml', 'fg', 'muted', 'inline', 'float', 'right', 'left', 'center', 'bold', 'wrap', 'nowrap',
  'lg', 'md', 'sm', 'xs', 'xl', 'no', 'outline', 'hover', 'underline', 'secondary', 'tertiary', 'primary',
  'aok', 'offscreen', 'declarative', 'crayons', 'story', 'puis', 'puisg', 'list', 'null', 'fw', 'fs',
  'my', 'mx', 'pt', 'pb', 'm', 'p', 'd',
]);
const ACCOUNT_LINK = /\/(login|signin|sign_in|signup|sign_up|register|share)\b|^javascript:|^#/i;
const INLINE = new Set(['SPAN', 'B', 'STRONG', 'EM', 'I', 'SUP', 'SUB', 'SMALL', 'ABBR', 'TIME', 'BDI', 'MARK', 'DATA']);
const HIDDEN =
  /(^|\s)(sr-only|visually-hidden|screen-reader-text|a-offscreen|v-visible-sr|hidden)(\s|$)|voice-?over|screen-?reader|__(hidden|sr-?only|visually-?hidden)__/i;
const PRICE = /^(?:[$£€¥₹]|USD|EUR|GBP|CAD|AUD|INR|Rs\.?)\s?\d|^\d[\d,]*(?:[.,]\d+)?\s?(?:USD|EUR|€|zł|kr)$/i;

function cleanName(raw: string) {
  const module = raw.match(/^[A-Za-z][\w-]*?__([A-Za-z][\w-]*?)__[\w-]{4,8}$/);
  return (module?.[1] ?? raw)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !/\d/.test(token) && !NOISE.has(token))
    .slice(-2)
    .join(' ');
}

const ROUTE_WORDS = new Set([
  'pdf', 'abs', 'download', 'downloads', 'comments', 'comment', 'reviews', 'review', 'user', 'users', 'author',
  'authors', 'profile', 'category', 'categories', 'tag', 'tags', 'stargazers', 'forks', 'issues', 'pulls',
  'discussion', 'html', 'format', 'hide', 'from', 'vote', 'seller', 'brand', 'store', 'shop', 'video', 'videos',
]);

function hrefWord(element: Element) {
  if (!(element instanceof HTMLAnchorElement)) return '';
  try {
    const segments = new URL(element.href).pathname.toLowerCase().split('/').filter(Boolean);
    return segments.find((segment) => ROUTE_WORDS.has(segment)) ?? '';
  } catch {
    return '';
  }
}

function fieldName(element: Element, used: Map<string, number>, fallback: string, value = '') {
  const tag = element.tagName.toLowerCase();
  let base = /^\d(?:\.\d)? out of 5 stars/i.test(value) ? 'rating' : '';
  base ||= cleanName(element.getAttribute('data-testid') ?? '') || cleanName(element.getAttribute('itemprop') ?? '');
  if (!base && PRICE.test(value)) base = 'price';
  if (!base && tag === 'time') base = 'date';
  if (!base) base = hrefWord(element);
  if (!base && (fallback === 'title' || fallback === 'image') && !used.has(fallback)) base = fallback;
  if (!base) base = [...element.classList].map(cleanName).find(Boolean) ?? '';
  if (!base && /^h[1-6]$/.test(tag)) base = 'heading';
  if (!base && tag === 'p' && value.length > 30) base = 'description';
  base ||= fallback;
  const count = (used.get(base) ?? 0) + 1;
  used.set(base, count);
  return count === 1 ? base : `${base} ${count}`;
}

function hidden(element: Element) {
  return HIDDEN.test(element.getAttribute('class') ?? '') || element.hasAttribute('hidden');
}

function visibleText(element: Element) {
  let text = '';
  let boundary = false;
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const piece = node.textContent ?? '';
      if (boundary && /[a-z0-9]$/i.test(text) && /^[a-z0-9]/i.test(piece)) text += ' ';
      text += piece;
      if (piece.trim()) boundary = false;
    } else if (node instanceof Element && !SKIP_TEXT.has(node.tagName) && !hidden(node)) {
      if (node !== element && node.previousElementSibling) boundary = true;
      node.childNodes.forEach(walk);
    }
  };
  walk(element);
  return cleanText(text);
}

function atomic(element: Element, text: string) {
  if (!element.children.length || text.length > 80 || element.closest('a')) return false;
  if (element.querySelectorAll('[data-testid]').length >= 2) return false;
  return [...element.querySelectorAll('*')].every((child) => INLINE.has(child.tagName) && !hidden(child));
}

function listFields(item: Element, used = new Map<string, number>(), next = false) {
  const fields: ExtractField[] = [];
  const seen = new Set<string>();
  const add = (field: ExtractField, value: string) => {
    if (!value || seen.has(`${field.attr}:${value}`) || fields.length >= 16) return;
    seen.add(`${field.attr}:${value}`);
    const target = field.selector ? item.querySelector(field.selector) : item;
    const alt = target && target !== item && field.selector.startsWith(':scope') ? classKey(target) : '';
    const located = alt ? { ...field, alt, index: [...item.querySelectorAll(alt)].indexOf(target!) } : field;
    fields.push(next ? { ...located, next: true } : located);
  };

  const headingLink = item.querySelector('h1 a[href], h2 a[href], h3 a[href], h4 a[href], h5 a[href], h6 a[href]');
  const visit = (element: Element) => {
    if (fields.length >= 16 || SKIP.has(element.tagName) || element.closest('[data-ghostclick]') || hidden(element)) return;
    if (element instanceof HTMLAnchorElement) {
      const href = element.getAttribute('href') ?? '';
      const label = cleanText(element.getAttribute('title')) || visibleText(element);
      if (element.href && !ACCOUNT_LINK.test(href) && (label || element.querySelector('img'))) {
        const selector = relativePath(item, element);
        const titled = label && (!headingLink || headingLink === element);
        const name = fieldName(element, used, titled ? 'title' : 'link', label);
        if (label) add({ name, selector, attr: 'text' }, label);
        add({ name: label ? `${name} url` : name, selector, attr: 'href' }, element.href);
      }
      element.querySelectorAll('img').forEach((image) => visit(image));
      return;
    }
    if (element instanceof HTMLImageElement) {
      if (element.src) add({ name: fieldName(element, used, 'image'), selector: relativePath(item, element), attr: 'src' }, element.src);
      return;
    }
    const whole = visibleText(element);
    if (element !== item && atomic(element, whole)) {
      add({ name: fieldName(element, used, 'text', whole), selector: relativePath(item, element), attr: 'text' }, whole);
      return;
    }
    const own = ownText(element);
    if (own && own.length <= 240 && whole.length <= 400) {
      add({ name: fieldName(element, used, 'text', whole), selector: relativePath(item, element), attr: 'text' }, whole);
    }
    for (const child of element.children) visit(child);
  };

  visit(item);
  return fields;
}

function tableSpec(table: HTMLTableElement): ExtractSpec {
  const tablePath = absolutePath(table);
  const headerRow = table.tHead?.rows[0] ?? [...table.rows].find((row) => row.querySelector('th')) ?? table.rows[0];
  const firstData = [...table.rows].find((row) => row !== headerRow && row.querySelector('td'));
  const fields: ExtractField[] = [];
  const cells = headerRow ? [...headerRow.cells] : [];
  cells.forEach((cell, index) => {
    const name = cleanText(cell.textContent) || `column ${index + 1}`;
    const selector = `:scope > :nth-child(${index + 1})`;
    fields.push({ name, selector, attr: 'text' });
    if (firstData?.cells[index]?.querySelector('a[href]')) {
      fields.push({ name: `${name} link`, selector: `${selector} a`, attr: 'href' });
    }
  });
  return { mode: 'table', itemSelector: `${tablePath} tr`, fields };
}

function usefulFields(spec: ExtractSpec) {
  const rows = runExtract(spec);
  if (rows.length < 3) return spec.fields;
  const filled = (name: string) => rows.filter((row) => row[name]).length / rows.length;
  const kept: ExtractField[] = [];
  for (const field of spec.fields) {
    if (filled(field.name) < 0.15) continue;
    const repeat = kept.some((other) => {
      const both = rows.filter((row) => row[field.name] && row[other.name]);
      return both.length > 0 && both.filter((row) => row[field.name] === row[other.name]).length >= both.length * 0.9 && filled(other.name) >= filled(field.name);
    });
    if (!repeat) kept.push(field);
  }
  return renumber(kept.slice(0, 20));
}

function renumber(fields: ExtractField[]) {
  const seen = new Map<string, Map<string, number>>();
  return fields.map((field) => {
    const [, stem = field.name, number = '1', url = ''] = field.name.match(/^(.*?)(?: (\d+))?( url)?$/) ?? [];
    const numbers = seen.get(stem) ?? new Map<string, number>();
    seen.set(stem, numbers);
    if (!numbers.has(number)) numbers.set(number, numbers.size + 1);
    const position = numbers.get(number)!;
    return { ...field, name: `${stem}${position > 1 ? ` ${position}` : ''}${url}` };
  });
}

export function inferExtract(clicked: Element): { spec: ExtractSpec; label: string } {
  const table = clicked.closest('table');
  const hasHeader =
    table instanceof HTMLTableElement &&
    [...table.rows].slice(0, 3).some((row) => row.cells.length > 1 && [...row.cells].every((cell) => cell.tagName === 'TH'));
  if (table instanceof HTMLTableElement && hasHeader && table.rows.length > 2) {
    return { spec: tableSpec(table), label: 'table' };
  }
  const found = findItems(clicked);
  if (found) {
    const used = new Map<string, number>();
    const items = matchItems(found.selector, found.requires);
    const fields = listFields(found.item, used);
    for (const other of [items[Math.floor(items.length / 3)], items[Math.floor((items.length * 2) / 3)]]) {
      if (!other || other === found.item) continue;
      const known = new Set(fields.map((field) => `${field.attr}:${field.selector}`));
      fields.push(...listFields(other, used).filter((field) => !known.has(`${field.attr}:${field.selector}`)));
    }
    const partner = partnerOf(items);
    if (partner) fields.push(...listFields(partner, used, true));
    const wrappingLink = found.item.closest('a[href]');
    if (!fields.some((field) => field.attr === 'href') && wrappingLink) {
      fields.push({ name: 'link', selector: '', attr: 'href', closest: 'a[href]' });
    }
    const spec: ExtractSpec = { mode: 'list', itemSelector: found.selector, requires: found.requires, fields };
    return { spec: { ...spec, fields: usefulFields(spec) }, label: 'list' };
  }
  const block = clicked.closest('article, section, li, div') ?? clicked;
  return {
    spec: { mode: 'list', itemSelector: absolutePath(block), fields: listFields(block) },
    label: 'section',
  };
}

const OUTSIDE_CONTENT =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [data-ghostclick], ' +
  '.references, .reflist, .mw-references, [role="doc-endnotes"], .footnotes, #footnotes, .navbox, .comments, #comments';
const NOT_ITEMS = new Set(['P', 'BR', 'HR', 'SPAN', 'OPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'CODE', 'LINK', 'META']);

function representatives(item: Element) {
  if (item instanceof HTMLTableRowElement) return [item.cells[0] ?? item];
  const links = [...item.querySelectorAll('a[href]')].filter((link) => visibleText(link).length > 2);
  const longest = [...links].sort((left, right) => visibleText(right).length - visibleText(left).length)[0];
  const candidates = [
    item.querySelector('h1 a[href], h2 a[href], h3 a[href], h4 a[href], h5 a[href], h6 a[href]'),
    longest,
    links[0],
    item.querySelector('h1, h2, h3, h4, h5, h6'),
    item.firstElementChild,
  ].filter((element): element is Element => Boolean(element));
  return [...new Set(candidates.length ? candidates : [item])];
}

export function findMainList(): Element | null {
  return findMainCandidates()[0] ?? null;
}

function findMainCandidates(): Element[] {
  const [best] = listGroups();
  return best ? representatives(best) : [];
}

function listGroups(): Element[] {
  const scored: Array<{ item: Element; score: number }> = [];
  const parents = [...document.body.querySelectorAll('*')].slice(0, 20_000);
  for (const parent of parents) {
    if (parent.children.length < 3 || SKIP_TEXT.has(parent.tagName) || parent.closest(OUTSIDE_CONTENT)) continue;
    const groups = new Map<string, Element[]>();
    for (const child of parent.children) {
      if (NOT_ITEMS.has(child.tagName) || SKIP.has(child.tagName)) continue;
      const key = keyOf(child);
      groups.set(key, [...(groups.get(key) ?? []), child]);
    }
    for (const items of groups.values()) {
      if (items.length < 3) continue;
      const lengths = items.slice(0, 30).map((item) => visibleText(item).length);
      const average = lengths.reduce((sum, length) => sum + length, 0) / lengths.length;
      if (average < 15) continue;
      const linked = items.slice(0, 30).filter((item) => item.querySelector('a[href]')).length / Math.min(items.length, 30);
      const tableRows = items[0] instanceof HTMLTableRowElement ? 2 : 1;
      const score = items.length * Math.min(average, 250) * (linked >= 0.5 ? 1.5 : 1) * tableRows;
      scored.push({ item: items[Math.floor(items.length / 2)]!, score });
    }
  }
  return scored
    .sort((left, right) => right.score - left.score)
    .map(({ item }) => (item.tagName === 'DD' && item.previousElementSibling?.tagName === 'DT' ? item.previousElementSibling : item));
}

function extractFrom(item: Element) {
  const tries = representatives(item).map((start) => {
    const { spec, label } = inferExtract(start);
    return { spec, label, rows: runExtract(spec) };
  });
  const most = Math.max(0, ...tries.map((attempt) => attempt.rows.length));
  return tries.find((attempt) => attempt.rows.length >= most * 0.8) ?? null;
}

export function autoExtract() {
  const [best] = listGroups();
  return best ? extractFrom(best) : null;
}

export function autoExtractAll(limit = 4) {
  const lists: NonNullable<ReturnType<typeof extractFrom>>[] = [];
  const covered = new Set<Element>();
  for (const group of listGroups().slice(0, 25)) {
    if (lists.length >= limit) break;
    if ([...covered].some((item) => item.contains(group) || group.contains(item))) continue;
    const found = extractFrom(group);
    if (!found || found.rows.length < 3 || lists.some((list) => list.spec.itemSelector === found.spec.itemSelector)) continue;
    lists.push(found);
    for (const item of matchItems(found.spec.itemSelector, found.spec.requires)) covered.add(item);
  }
  return lists;
}

function read(element: Element | null, attr: ExtractField['attr']) {
  if (!element) return '';
  if (attr === 'href') return element instanceof HTMLAnchorElement ? element.href : (element.getAttribute('href') ?? '');
  if (attr === 'src') return element instanceof HTMLImageElement ? element.src : (element.getAttribute('src') ?? '');
  const title = element instanceof HTMLAnchorElement ? element.getAttribute('title') : null;
  return cleanText(title) || visibleText(element);
}

export function runExtract(spec: ExtractSpec): Row[] {
  let items: Element[] = [];
  if (spec.requires) {
    items = matchItems(spec.itemSelector, spec.requires).slice(0, 1000);
  } else {
    try {
      items = [...document.querySelectorAll(spec.itemSelector)].slice(0, 1000);
    } catch {
      return [];
    }
  }
  if (spec.mode === 'table') items = items.filter((row) => row.querySelector('td'));
  const rows: Row[] = [];
  for (const item of items) {
    const row: Row = {};
    const claimed: Element[] = [];
    const missing: Array<[ExtractField, Element]> = [];
    for (const field of spec.fields) {
      const base = field.closest ? item.closest(field.closest) : field.next ? item.nextElementSibling : item;
      let target: Element | null = base;
      if (base && field.selector) target = query(base, field.selector);
      if (base && !target && field.alt) missing.push([field, base]);
      if (target && target !== base) claimed.push(target);
      row[field.name] = read(target, field.attr);
    }
    for (const [field, base] of missing) {
      const candidate = queryAll(base, field.alt!)[field.index ?? 0];
      if (!candidate || claimed.some((other) => other.contains(candidate) || candidate.contains(other))) continue;
      claimed.push(candidate);
      row[field.name] = read(candidate, field.attr);
    }
    if (Object.values(row).some(Boolean)) rows.push(row);
  }
  return rows;
}

function query(base: Element, selector: string) {
  try {
    return base.querySelector(selector);
  } catch {
    return null;
  }
}

function queryAll(base: Element, selector: string) {
  try {
    return [...base.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element) || SKIP.has(node.tagName) || node.closest('[data-ghostclick]')) return '';
  const inner = () => [...node.childNodes].map(inline).join('');
  switch (node.tagName) {
    case 'BR':
      return ' ';
    case 'A': {
      const text = cleanText(inner());
      const href = (node as HTMLAnchorElement).href;
      return text && /^https?:/.test(href) ? `[${text}](${href})` : text;
    }
    case 'STRONG':
    case 'B': {
      const text = cleanText(inner());
      return text ? `**${text}**` : '';
    }
    case 'EM':
    case 'I': {
      const text = cleanText(inner());
      return text ? `_${text}_` : '';
    }
    case 'CODE':
      return `\`${cleanText(node.textContent)}\``;
    case 'IMG':
      return '';
    default:
      return inner();
  }
}

const BLOCK_SKIP = new Set(['NAV', 'FOOTER', 'ASIDE', 'FORM']);

function blocks(node: Element, out: string[]) {
  for (const child of node.children) {
    if (SKIP.has(child.tagName) || BLOCK_SKIP.has(child.tagName) || child.closest('[data-ghostclick]')) continue;
    if (child.getAttribute('aria-hidden') === 'true' || child.hasAttribute('hidden')) continue;
    const tag = child.tagName;
    if (/^H[1-6]$/.test(tag)) {
      const text = cleanText(inline(child));
      if (text) out.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
    } else if (tag === 'P' || tag === 'FIGCAPTION') {
      const text = cleanText(inline(child));
      if (text) out.push(text);
    } else if (tag === 'BLOCKQUOTE') {
      const text = cleanText(inline(child));
      if (text) out.push(`> ${text}`);
    } else if (tag === 'UL' || tag === 'OL') {
      const items = [...child.children].filter((item) => item.tagName === 'LI');
      const lines = items
        .map((item, index) => {
          const text = cleanText(inline(item));
          return text ? `${tag === 'OL' ? `${index + 1}.` : '-'} ${text}` : '';
        })
        .filter(Boolean);
      if (lines.length) out.push(lines.join('\n'));
    } else if (tag === 'PRE') {
      out.push(`\`\`\`\n${child.textContent?.trim() ?? ''}\n\`\`\``);
    } else if (tag === 'TABLE') {
      const rows = [...(child as HTMLTableElement).rows].map((row) =>
        [...row.cells].map((cell) => cleanText(inline(cell)).replace(/\|/g, '/')),
      );
      if (rows.length) {
        const width = Math.max(...rows.map((row) => row.length));
        const pad = (row: string[]) => `| ${[...row, ...Array(width - row.length).fill('')].join(' | ')} |`;
        out.push([pad(rows[0] ?? []), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(pad)].join('\n'));
      }
    } else if (child.children.length === 0) {
      const text = cleanText(child.textContent);
      if (text.length > 40) out.push(text);
    } else {
      const direct = [...child.childNodes]
        .filter((item) => item.nodeType === Node.TEXT_NODE)
        .map((item) => item.textContent ?? '')
        .join(' ');
      if (cleanText(direct).length > 40) out.push(cleanText(inline(child)));
      else blocks(child, out);
    }
  }
}

function mainContent() {
  const size = (element: Element) => cleanText(element.textContent).length;
  const total = size(document.body);
  const best = [...document.querySelectorAll('main, [role="main"], article')]
    .map((element) => ({ element, length: size(element) }))
    .sort((left, right) => right.length - left.length)[0];
  return best && best.length >= total * 0.3 ? best.element : document.body;
}

export function pageMarkdown() {
  const root = mainContent();
  const out: string[] = [];
  blocks(root, out);
  const title = cleanText(document.title) || 'Untitled page';
  const markdown = [`# ${title}`, `Source: ${location.href}`, ...out].join('\n\n').slice(0, 200_000);
  return { title, markdown };
}

export function captchaPending() {
  if (/just a moment|attention required/i.test(document.title) && document.querySelector('#challenge-form, #cf-challenge-running, [id^="cf-chl"]')) {
    return true;
  }
  const widgets = [
    ...document.querySelectorAll(
      'iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], .g-recaptcha, .h-captcha, .cf-turnstile',
    ),
  ].filter((element) => {
    if (element.closest('.grecaptcha-badge')) return false;
    if (element instanceof HTMLIFrameElement && /size=invisible/.test(element.src)) return false;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
  if (widgets.length === 0) return false;
  const answers = [
    ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'textarea[name="g-recaptcha-response"], textarea[name="h-captcha-response"], input[name="cf-turnstile-response"]',
    ),
  ];
  return !answers.some((answer) => answer.value.trim());
}
