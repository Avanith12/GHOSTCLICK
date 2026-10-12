import { describe, expect, it } from 'vitest';
import { mapColumns, parseCsv, toCsv } from './csv';
import { pageMatches } from './textHelpers';

describe('pageMatches', () => {
  it('treats ids in the address as the same page', () => {
    expect(pageMatches('https://shop.test/product/123', 'https://shop.test/product/987?ref=x')).toBe(true);
  });

  it('keeps different pages apart', () => {
    expect(pageMatches('https://shop.test/product/123', 'https://shop.test/cart/123')).toBe(false);
    expect(pageMatches('https://shop.test/a', 'https://other.test/a')).toBe(false);
  });
});

describe('csv', () => {
  it('reads quoted cells and maps headers to fields', () => {
    const rows = parseCsv('Student name,Email\n"Hopper, Grace",grace@navy.mil\n');
    expect(rows).toEqual([{ 'Student name': 'Hopper, Grace', Email: 'grace@navy.mil' }]);
    expect(
      mapColumns(['Student name', 'Email'], [
        { key: 'studentname', label: 'Student name' },
        { key: 'email', label: 'Email' },
      ]),
    ).toEqual({ studentname: 'Student name', email: 'Email' });
  });

  it('writes cells that contain commas', () => {
    expect(toCsv(['a'], [{ a: 'x, y' }])).toBe('a\n"x, y"');
  });
});
