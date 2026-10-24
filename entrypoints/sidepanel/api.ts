import { reachTab } from '@/shared/tabConnection';
import type { Row, Snapshot } from '@/shared/types';

export type Command = (
  message: Record<string, unknown>,
) => Promise<{ ok?: boolean; snapshot?: Snapshot; id?: string; error?: string; message?: string } | null>;

/** Prefer the active http(s) tab; if the side panel stole focus, use the last normal website tab. */
export async function usableWebsiteTab() {
  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.id !== undefined && active.url && /^https?:\/\//i.test(active.url)) return active;
  const all = await chrome.tabs.query({});
  const http = all.filter((tab) => tab.id !== undefined && tab.url && /^https?:\/\//i.test(tab.url));
  return http.at(-1) ?? active ?? null;
}

export async function activeTabId() {
  const tab = await usableWebsiteTab();
  return tab?.id ?? null;
}

export async function pageMarkdown() {
  const tab = await usableWebsiteTab();
  const tabId = tab?.id;
  if (!tabId) throw new Error('Open a website first.');
  if (/\.pdf(\?|#|$)/i.test(tab.url ?? '')) {
    throw new Error('This tab is a PDF. Use “Read the PDF in this tab” on the Data tab.');
  }
  try {
    await reachTab(tabId);
    const response = (await chrome.tabs.sendMessage(tabId, { type: 'PAGE_MARKDOWN' }, { frameId: 0 })) as {
      title: string;
      markdown: string;
      url: string;
    } | null;
    if (!response?.markdown) throw new Error('empty');
    return response;
  } catch {
    throw new Error('Ghostclick cannot read this tab. Reload the page once and try again.');
  }
}

export async function findList(all = false) {
  const tabId = await activeTabId();
  if (!tabId) throw new Error('Open a website first.');
  let response: { ok: boolean; rows: Row[]; url: string; title: string } | null = null;
  try {
    await reachTab(tabId);
    response = await chrome.tabs.sendMessage(tabId, { type: 'AUTO_EXTRACT', all }, { frameId: 0 });
  } catch {
    throw new Error('Ghostclick cannot read this tab. Reload the page once and try again.');
  }
  if (!response?.ok || !response.rows.length) throw new Error('No repeated list was found on this page. Try picking it yourself.');
  return response;
}

export async function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function downloadUrls(urls: string[]) {
  let started = 0;
  for (const url of urls.slice(0, 50)) {
    try {
      await chrome.downloads.download({ url, conflictAction: 'uniquify' });
      started += 1;
    } catch {
      // Skip links Chrome refuses, such as pages that require a different session.
    }
  }
  return started;
}

export function fileName(title: string, extension: string) {
  const base = title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'ghostclick';
  return `${base}.${extension}`;
}
