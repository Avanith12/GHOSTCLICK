// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pageMarkdown } from './pageToMarkdown';

function load(html: string) {
  document.open();
  document.write(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
  document.close();
}

describe('pageMarkdown', () => {
  it('keeps headings, paragraphs, and lists from the main article', () => {
    load(`<nav>Menu</nav><article><h1>Hold policy</h1><p>Students must meet an <a href="https://x.edu/a">advisor</a>.</p><ul><li>Book a slot</li><li>Attend</li></ul></article>`);
    const { markdown } = pageMarkdown();
    expect(markdown).toContain('# Hold policy');
    expect(markdown).toContain('[advisor](https://x.edu/a)');
    expect(markdown).toContain('- Book a slot');
    expect(markdown).not.toContain('Menu');
  });

  const books = '/tmp/books.html';
  it.skipIf(!existsSync(books))('saves the whole book grid, not just the first card', () => {
    load(readFileSync(books, 'utf8'));
    const { markdown } = pageMarkdown();
    expect(markdown).toContain('A Light in the');
    expect(markdown).toContain('Tipping the Velvet');
  });
});
