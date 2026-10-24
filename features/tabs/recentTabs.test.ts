import { describe, expect, it } from 'vitest';
import {
  hostKey,
  parseTabCount,
  rememberVisit,
  siteKey,
  tabKey,
  titleMatchesSite,
  urlPatternsForSite,
  wantsReopenTabs,
  wantsTabInfo,
} from './recentTabs';

describe('recentTabs helpers', () => {
  it('dedupes visits by site and keeps the newest first', () => {
    let list = rememberVisit([], 'https://a.com/x', 'A', 1);
    list = rememberVisit(list, 'https://b.com/', 'B', 2);
    list = rememberVisit(list, 'https://a.com/other', 'A again', 3);
    expect(list.map((item) => item.title)).toEqual(['A again', 'B']);
    expect(tabKey('https://a.com/x#frag')).toBe(tabKey('https://a.com/x'));
    expect(hostKey('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
    expect(siteKey('https://m.youtube.com/')).toBe('youtube.com');
    expect(urlPatternsForSite('https://www.youtube.com/').some((pattern) => pattern.includes('youtube.com'))).toBe(true);
    expect(titleMatchesSite('Inbox (611) - ada@gmail.com', 'mail.google.com')).toBe(true);
    expect(titleMatchesSite('YouTube', 'youtube.com')).toBe(true);
    expect(titleMatchesSite('GTA - Wikipedia', 'en.wikipedia.org')).toBe(true);
  });

  it('parses how many tabs to reopen, including word numbers', () => {
    expect(parseTabCount('open my last 5 tabs')).toBe(5);
    expect(parseTabCount('open the last three tabs')).toBe(3);
    expect(parseTabCount('reopen the past 3 tabs')).toBe(3);
    expect(parseTabCount('open my recent tabs')).toBe(5);
    expect(parseTabCount('open my last 99 tabs')).toBe(10);
  });

  it('detects reopen and tab-info requests', () => {
    expect(wantsReopenTabs('open my last 5 tabs')).toBe(true);
    expect(wantsReopenTabs('restore my previous tabs')).toBe(true);
    expect(wantsReopenTabs('open gmail and read my last email')).toBe(false);
    expect(wantsTabInfo('how many tabs do I have open?')).toBe(true);
    expect(wantsTabInfo('list my open tabs')).toBe(true);
    expect(wantsTabInfo('open youtube.com')).toBe(false);
  });
});
