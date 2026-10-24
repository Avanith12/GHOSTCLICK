/** Recently used http(s) tabs Ghostclick remembers for “open my last N tabs”. */

export type RecentTab = { url: string; title: string; at: number };

export const MAX_RECENT_TABS = 30;
export const DEFAULT_REOPEN_COUNT = 5;
export const MAX_REOPEN_COUNT = 10;

/** Canonical key so https://a.com/ and https://a.com/#x count as one. */
export function tabKey(url: string) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    parsed.hash = '';
    if (parsed.pathname === '/') parsed.pathname = '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

/** Site identity for reopen (avoid a second Gmail/YouTube tab for a different path). */
export function hostKey(url: string) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return '';
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Same site even across www / m. / inbox.google vs mail.google. */
export function siteKey(url: string) {
  const host = hostKey(url);
  if (!host) return '';
  if (host === 'm.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') return 'youtube.com';
  if (host === 'inbox.google.com' || host === 'gmail.com') return 'mail.google.com';
  return host;
}

/** chrome.tabs.query `url` patterns so we find an already-open tab without reading every tab’s URL. */
export function urlPatternsForSite(url: string) {
  const site = siteKey(url);
  if (!site) return [] as string[];
  const hosts = new Set<string>([site, hostKey(url)]);
  if (site === 'youtube.com') {
    for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']) hosts.add(host);
  }
  if (site === 'mail.google.com') {
    for (const host of ['mail.google.com', 'inbox.google.com', 'gmail.com']) hosts.add(host);
  }
  const patterns: string[] = [];
  for (const host of hosts) {
    if (!host) continue;
    patterns.push(`*://${host}/*`);
    patterns.push(`*://${host}/`);
  }
  return [...new Set(patterns)];
}

/**
 * When Chrome hides tab.url, match from the tab title for well-known sites only.
 * Do not guess from generic host labels (e.g. “example” would match every Example Domain tab).
 */
export function titleMatchesSite(title: string, site: string) {
  const t = title.toLowerCase();
  if (!t || !site) return false;
  if (site === 'youtube.com') return /\byoutube\b/.test(t);
  if (site === 'mail.google.com') return /\b(gmail|inbox)\b/.test(t);
  if (site.endsWith('wikipedia.org')) return /\bwikipedia\b/.test(t);
  return false;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseCountToken(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const word = NUMBER_WORDS[raw.toLowerCase()];
  if (word !== undefined) return word;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export function isHttpUrl(url: string | undefined): url is string {
  return Boolean(url && /^https?:\/\//i.test(url));
}

/** Put this visit at the front of the list (most recent first, one entry per site). */
export function rememberVisit(list: RecentTab[], url: string, title: string, at = Date.now()): RecentTab[] {
  if (!isHttpUrl(url)) return list;
  const site = siteKey(url) || tabKey(url);
  if (!site) return list;
  const next: RecentTab = { url, title: (title || site).slice(0, 120), at };
  return [next, ...list.filter((item) => (siteKey(item.url) || tabKey(item.url)) !== site)].slice(0, MAX_RECENT_TABS);
}

/** Parse “last 5 tabs”, “last three tabs”, “reopen my previous 3 tabs”, default 5. */
export function parseTabCount(request: string, fallback = DEFAULT_REOPEN_COUNT) {
  const token = '(?:\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
  const match =
    request.match(new RegExp(`\\b(?:last|past|previous|recent)\\s+(${token})\\s+tabs?\\b`, 'i'))
    ?? request.match(new RegExp(`\\b(${token})\\s+(?:tabs?|windows?)\\b`, 'i'))
    ?? request.match(new RegExp(`\\breopen\\s+(${token})\\b`, 'i'));
  const n = parseCountToken(match?.[1], fallback);
  return Math.min(MAX_REOPEN_COUNT, Math.max(1, Math.floor(n)));
}

export function wantsReopenTabs(request: string) {
  const text = request.toLowerCase();
  if (/\b(gmail|mail|email|inbox)\b/.test(text) && /\b(read|open|check)\b/.test(text)) return false;
  return (
    /\b(reopen|restore|bring back)\b.*\b(tabs?|windows?)\b/.test(text)
    || /\b(open|show|get|pull up)\b.*\b(my |the )?(last|past|previous|recent)\b.*\btabs?\b/.test(text)
    || /\b(last|past|previous|recent)\s+\d*\s*tabs?\b/.test(text)
    || /\btabs?\s+(i|i'?ve|i had)\s+(had|was using|used|opened)\b/.test(text)
  );
}

export function wantsTabInfo(request: string) {
  const text = request.toLowerCase();
  return (
    /\bhow many tabs?\b/.test(text)
    || /\b(tab count|number of tabs|tabs (are|do i have) open)\b/.test(text)
    || /\b(what|which) tabs?\s+(are|do i have)\s+open\b/.test(text)
    || /\blist (my |the )?open tabs\b/.test(text)
  );
}
