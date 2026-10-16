import { describe, expect, it } from 'vitest';
import { dataContext, numberOf, rankRows } from './sortRowsForQuestion';

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

  it('reads the price, not the discount, and answers cheapest and costliest together', () => {
    expect(numberOf('-14%$13.64 Typical price:$15.85')).toBe(13.64);
    const shop = [
      { title: 'Shirt', 'title url': 'https://a.com/shirt', image: 'https://a.com/1.jpg', 'buy price': '$19.90' },
      { title: 'Linen', 'title url': 'https://a.com/linen', image: 'https://a.com/2.jpg', 'buy price': '-14%$13.64 Typical price:$15.85' },
      { title: 'Socks', 'title url': 'https://a.com/socks', image: 'https://a.com/3.jpg', 'buy price': '$9.50' },
      { title: 'Boots', 'title url': 'https://a.com/boots', image: 'https://a.com/4.jpg', 'buy price': '$41.00' },
    ];
    const context = dataContext('which is the most cheapest and the most costliest? give me the links', Object.keys(shop[0]!), shop);
    expect(context).toMatch(/lowest buy price[\s\S]*Socks[\s\S]*highest buy price[\s\S]*Boots/);
    expect(context).toContain('https://a.com/socks');
    expect(context).not.toContain('1.jpg');
  });

  it('moves rows that mention the question to the top', () => {
    const decor = [
      ...Array.from({ length: 60 }, (_, index) => ({ title: `Cast iron pan number ${index}`, price: '$10.00' })),
      { title: 'Sweet Water Decor Hello Fall Reed Diffuser', price: '$24.99' },
    ];
    const context = dataContext('is there something related to sweet water decor?', ['title', 'price'], decor);
    expect(context.split('\n').slice(0, 3).join('\n')).toMatch(/Sweet Water Decor/);
  });

  it('reads counts like 1.2k', () => {
    expect(numberOf('1.2k stars')).toBe(1200);
    expect(numberOf('https://x.com/1')).toBeNaN();
  });
});
