// @vitest-environment jsdom
import { readFileSync, existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { captchaPending, inferExtract, pageMarkdown, runExtract } from './extract';

beforeAll(() => {
  if (!globalThis.CSS?.escape) {
    globalThis.CSS = { escape: (value: string) => value.replace(/([^\w-])/g, '\\$1') } as typeof CSS;
  }
});

function load(html: string) {
  document.open();
  document.write(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
  document.close();
}

describe('inferExtract', () => {
  it('turns one clicked card into every matching card', () => {
    load(`
      <ul class="products">
        ${['Alpha', 'Beta', 'Gamma', 'Delta']
          .map(
            (name, index) => `
          <li class="card">
            <h3><a href="/item/${index}" title="${name} full title">${name}</a></h3>
            <p class="price_color">£${10 + index}.00</p>
          </li>`,
          )
          .join('')}
      </ul>`);
    const clicked = document.querySelectorAll('li.card a')[1]!;
    const { spec } = inferExtract(clicked);
    const rows = runExtract(spec);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ title: 'Alpha full title', price: '£10.00' });
    expect(rows[0]?.['title url']).toContain('/item/0');
  });

  it('reads a table using its header row', () => {
    load(`<table><tr><th>Name</th><th>Score</th></tr><tr><td>Ada</td><td>9</td></tr><tr><td>Grace</td><td>10</td></tr></table>`);
    const { spec } = inferExtract(document.querySelectorAll('td')[0]!);
    expect(runExtract(spec)).toEqual([
      { Name: 'Ada', Score: '9' },
      { Name: 'Grace', Score: '10' },
    ]);
  });

  const books = '/tmp/books.html';
  it.skipIf(!existsSync(books))('scrapes books.toscrape.com from one title', () => {
    load(readFileSync(books, 'utf8'));
    const { spec } = inferExtract(document.querySelector('article.product_pod h3 a')!);
    const rows = runExtract(spec);
    expect(rows).toHaveLength(20);
    expect(rows[0]?.title).toBe('A Light in the Attic');
    expect(Object.values(rows[0] ?? {})).toContain('£51.77');
  });

  it.skipIf(!existsSync(books))('saves the whole book grid, not just the first card', () => {
    load(readFileSync(books, 'utf8'));
    const { markdown } = pageMarkdown();
    expect(markdown).toContain('A Light in the');
    expect(markdown).toContain('Tipping the Velvet');
  });
});

describe('pageMarkdown', () => {
  it('keeps headings, paragraphs, and lists from the main article', () => {
    load(`<nav>Menu</nav><article><h1>Hold policy</h1><p>Students must meet an <a href="https://x.edu/a">advisor</a>.</p><ul><li>Book a slot</li><li>Attend</li></ul></article>`);
    const { markdown } = pageMarkdown();
    expect(markdown).toContain('# Hold policy');
    expect(markdown).toContain('[advisor](https://x.edu/a)');
    expect(markdown).toContain('- Book a slot');
    expect(markdown).not.toContain('Menu');
  });
});

describe('captchaPending', () => {
  it('is false on a normal page', () => {
    load('<form><button>Go</button></form>');
    expect(captchaPending()).toBe(false);
  });
});
