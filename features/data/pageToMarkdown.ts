import { cleanText } from '@/shared/textHelpers';

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'IFRAME', 'TEMPLATE', 'BUTTON', 'SELECT', 'TEXTAREA', 'INPUT']);

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
