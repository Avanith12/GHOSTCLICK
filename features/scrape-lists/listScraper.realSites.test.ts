// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { autoExtract, inferExtract, runExtract } from './listScraper';

beforeAll(() => {
  if (!globalThis.CSS?.escape) {
    globalThis.CSS = { escape: (value: string) => value.replace(/([^\w-])/g, '\\$1') } as typeof CSS;
  }
});

function load(file: string) {
  document.open();
  document.write(
    readFileSync(file, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, ''),
  );
  document.close();
}

describe('saved real pages', () => {
  it.skipIf(!existsSync('/tmp/hn.html'))('Hacker News front page', () => {
    load('/tmp/hn.html');
    const { spec } = inferExtract(document.querySelector('.titleline > a')!);
    const rows = runExtract(spec);
    console.log('HN', rows.length, JSON.stringify(rows[0]));
    expect(rows.length).toBe(30);
    expect(rows[0]?.title).toBeTruthy();
    expect(Object.keys(rows[0] ?? {})).not.toContain('1.');
  });

  const live = [
    ['countries', '.country .country-name', 250],
    ['dev', '.crayons-story__title a', 15],
    ['arxiv', 'dl dt a[title="Abstract"]', 50],
    ['bbc', '[data-testid="card-headline"]', 20],
    ['github', 'article.Box-row h2 a', 10],
    ['amazon', '[data-component-type="s-search-result"] h2', 16],
    ['algolia', '.Story_title a span', 20],
    ['amazon-store', '[data-testid="grid-item-buy-price"]', 100],
  ] as const;
  for (const [name, selector, minimum] of live) {
    const file = `/tmp/site-${name}.html`;
    it.skipIf(!existsSync(file))(`saved ${name} page`, () => {
      load(file);
      const { spec } = inferExtract(document.querySelector(selector)!);
      const rows = runExtract(spec);
      const sample = Object.fromEntries(Object.entries(rows[0] ?? {}).map(([key, value]) => [key, value.slice(0, 50)]));
      console.log(name.toUpperCase(), rows.length, spec.itemSelector, JSON.stringify(sample));
      expect(rows.length).toBeGreaterThanOrEqual(minimum);
    });
  }

  const automatic = [
    ['/tmp/site-github.html', 10, /\//],
    ['/tmp/site-countries.html', 250, /Andorra/],
    ['/tmp/site-arxiv.html', 50, /Title/],
    ['/tmp/site-algolia.html', 20, /Rust/i],
    ['/tmp/hn.html', 30, /./],
    ['/tmp/books.html', 20, /A Light in the Attic/],
    ['/tmp/wiki.html', 40, /Amazon/],
    ['/tmp/site-amazon-fall.html', 20, /\$\d/],
  ] as const;
  for (const [file, minimum, first] of automatic) {
    it.skipIf(!existsSync(file))(`finds the main list without a click: ${file}`, () => {
      load(file);
      const found = autoExtract();
      console.log('AUTO', file, found?.rows.length, found?.spec.itemSelector, JSON.stringify(found?.rows[0]).slice(0, 160));
      expect(found?.rows.length ?? 0).toBeGreaterThanOrEqual(minimum);
      expect(Object.values(found?.rows[0] ?? {}).join(' ')).toMatch(first);
    });
  }

  it.skipIf(!existsSync('/tmp/wiki.html'))('Wikipedia table', () => {
    load('/tmp/wiki.html');
    const cell = document.querySelector('table.wikitable tbody tr:nth-child(3) td')!;
    const { spec } = inferExtract(cell);
    const rows = runExtract(spec);
    console.log('WIKI', rows.length, JSON.stringify(rows[0]));
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });
});
