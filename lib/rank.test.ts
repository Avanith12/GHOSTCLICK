import { describe, expect, it } from 'vitest';
import { dataContext, numberOf, rankRows } from './rank';

const books = [
  { title: 'A', price: '£51.77', link: 'https://example.com/a' },
  { title: 'B', price: '£13.99', link: 'https://example.com/b' },
  { title: 'C', price: '£1,017.50', link: 'https://example.com/c' },
];

describe('rankRows', () => {
  it('sorts by price for cheapest and most expensive questions', () => {
    expect(rankRows('Which 3 books are cheapest?', ['title', 'price', 'link'], books)?.rows.map((row) => row.title)).toEqual(['B', 'A', 'C']);
    expect(rankRows('most expensive book', ['title', 'price', 'link'], books)?.rows[0]?.title).toBe('C');
  });

  it('leaves questions without an order alone', () => {
    expect(rankRows('group these by topic', ['title', 'price'], books)).toBeNull();
    expect(dataContext('group these by topic', ['title'], books)).not.toMatch(/sorted/);
  });

  it('reads counts like 1.2k', () => {
    expect(numberOf('1.2k stars')).toBe(1200);
    expect(numberOf('https://x.com/1')).toBeNaN();
  });
});
