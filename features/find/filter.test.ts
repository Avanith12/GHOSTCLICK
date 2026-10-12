import { describe, expect, it } from 'vitest';
import { bestKeywordMatches, filterPhrase, keywordFilter, parseVotes, rowTitle } from './filter';

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

  it('finds longer words inside compound words', () => {
    const products = [{ title: 'Garmin vívoactive 6 GPS Smartwatch' }, { title: 'Owala water bottle' }, { title: 'Bracelet Watch' }];
    expect(keywordFilter('watches', products)).toEqual([0, 2]);
  });

  it('keeps only the items that match the most words', () => {
    const products = [
      { title: 'Owala FreeSip Stainless Steel Water Bottle 24 oz' },
      { title: 'Galaxy Tab, IP68 Water-Resistant' },
      { title: 'Coffee machine for hot or cold foam drinks' },
      { title: 'Owala FreeSip Sway Water Bottle 30 oz' },
    ];
    expect(bestKeywordMatches('water bottle for drinking', products)).toEqual([0, 3]);
    expect(bestKeywordMatches('kettle', products)).toEqual([]);
  });

  it('ignores urls and keeps everything for an empty filter', () => {
    expect(keywordFilter('github', repos)).toEqual([]);
    expect(keywordFilter('', repos)).toEqual([0, 1, 2]);
  });
});

describe('parseVotes', () => {
  it('keeps yes votes and drops ones that are out of range', () => {
    expect(parseVotes('1: yes\n2: no\n3. Yes\n9: yes', 3)).toEqual([0, 2]);
    expect(parseVotes('no votes here', 3)).toEqual([]);
  });
});

describe('keywordFilter with every word', () => {
  it('needs all the words to appear', () => {
    expect(keywordFilter('diagram design', repos, true)).toEqual([]);
    expect(keywordFilter('design systems', repos, true)).toEqual([2]);
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
