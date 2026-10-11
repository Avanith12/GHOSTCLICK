import { describe, expect, it } from 'vitest';
import { filterPhrase, keywordFilter, parseKeep, rowTitle } from './filter';

const repos = [
  { title: 'acme / drawflow', url: 'https://github.com/acme/drawflow', about: 'Draw diagrams and flowcharts in the browser' },
  { title: 'acme / fastjson', url: 'https://github.com/acme/fastjson', about: 'A very fast JSON parser' },
  { title: 'acme / ui-kit', url: 'https://github.com/acme/ui-kit', about: 'Design system components' },
];

describe('keywordFilter', () => {
  it('keeps rows that share words with the filter, best matches first', () => {
    expect(keywordFilter('diagram design', repos)).toEqual([0, 2]);
  });

  it('matches short words only as whole words', () => {
    const stories = [{ title: 'Grieving the loss of details' }, { title: 'A new AI model' }, { title: 'Containers explained' }];
    expect(keywordFilter('AI', stories)).toEqual([1]);
  });

  it('ignores urls and keeps everything for an empty filter', () => {
    expect(keywordFilter('github', repos)).toEqual([]);
    expect(keywordFilter('', repos)).toEqual([0, 1, 2]);
  });
});

describe('parseKeep', () => {
  it('reads item numbers and drops ones that are out of range', () => {
    expect(parseKeep('Sure: {"keep":[1, 3, 3, 9]}', 3)).toEqual([0, 2]);
    expect(parseKeep('no json here', 3)).toEqual([]);
  });
});

describe('filterPhrase and rowTitle', () => {
  it('pulls the description out of a request', () => {
    expect(filterPhrase('get every repo related to machine learning on this page')).toBe('machine learning');
    expect(filterPhrase('get every item on this page')).toBe('');
  });

  it('uses the first readable value as the title', () => {
    expect(rowTitle(repos[0]!)).toBe('acme / drawflow');
  });
});
