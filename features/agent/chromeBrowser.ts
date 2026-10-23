import { chatWithTimeout, interruptModel } from '@/features/local-ai/localModel';
import { reachTab } from '@/shared/tabConnection';
import { AgentRunner, type AgentBrowser, type SavedRun } from './agentLoop';
import type { ActResult, PageObservation } from './types';

// The side panel's implementation of the agent's browser: Chrome tabs, scripting, and the content script.

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

// Session storage survives the side panel closing but not the browser quitting, which is the
// lifetime an interrupted task should have.
const SAVED_RUN = 'agentSavedRun';
const RESUME_WINDOW_MS = 30 * 60 * 1000;

/** A task interrupted by the side panel closing, if one is recent enough to resume. */
export async function interruptedRun(): Promise<SavedRun | null> {
  const stored = (await chrome.storage.session.get(SAVED_RUN))[SAVED_RUN] as SavedRun | undefined;
  return stored && Date.now() - stored.at < RESUME_WINDOW_MS ? stored : null;
}

export async function forgetInterruptedRun() {
  await chrome.storage.session.remove(SAVED_RUN);
}

async function waitForLoad(tabId: number, limit = 15_000) {
  const end = Date.now() + limit;
  while (Date.now() < end) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') break;
    } catch {
      return;
    }
    await sleep(200);
  }
  await reachTab(tabId).catch(() => false);
}

async function send<T>(message: Record<string, unknown>) {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return null;
  }
}

export const chromeBrowser: AgentBrowser = {
  async activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab?.id ? { tabId: tab.id, url: tab.url ?? '' } : null;
  },

  async tabs() {
    const own = chrome.runtime.getURL('');
    const all = await chrome.tabs.query({});
    return all
      .filter((tab) => tab.id !== undefined && !(tab.url ?? '').startsWith(own))
      .map((tab) => ({ tabId: tab.id!, title: tab.title ?? '', url: tab.url ?? tab.pendingUrl ?? '' }));
  },

  async tabUrl(tabId) {
    const tab = await chrome.tabs.get(tabId);
    return tab.url || tab.pendingUrl || '';
  },

  async observe(tabId, goal) {
    const tab = await chrome.tabs.get(tabId);
    if (!/^https?:/.test(tab.url ?? '')) return null;
    if (tab.status !== 'complete') await waitForLoad(tabId);
    if (!(await reachTab(tabId))) return null;
    return (await chrome.tabs.sendMessage(tabId, { type: 'AGENT_OBSERVE', goal }, { frameId: 0 })) as PageObservation | null;
  },

  async act(tabId, action) {
    const opened: number[] = [];
    const onCreated = (tab: chrome.tabs.Tab) => {
      if (tab.id !== undefined && tab.openerTabId === tabId) opened.push(tab.id);
    };
    chrome.tabs.onCreated.addListener(onCreated);
    try {
      if (!(await reachTab(tabId))) return { ok: false, message: 'Ghostclick cannot reach this page. It may be a browser page or still loading.' };
      let result: ActResult | null = null;
      try {
        result = (await chrome.tabs.sendMessage(tabId, { type: 'AGENT_ACT', action }, { frameId: 0 })) as ActResult | null;
      } catch {
        result = null;
      }
      if (!result) return { ok: false, message: 'The page did not answer. It may have reloaded; look at it again.' };
      if (!['READ', 'VERIFY', 'EXTRACT', 'DOWNLOAD'].includes(action.action)) {
        await sleep(700);
        await waitForLoad(tabId);
      }
      const newTabId = opened.at(-1);
      if (newTabId !== undefined) {
        await chrome.tabs.update(newTabId, { active: true }).catch(() => undefined);
        await waitForLoad(newTabId);
        return { ...result, newTabId };
      }
      return result;
    } finally {
      chrome.tabs.onCreated.removeListener(onCreated);
    }
  },

  async navigate(tabId, url) {
    await chrome.tabs.update(tabId, { url });
    await sleep(500);
    await waitForLoad(tabId);
  },

  async history(tabId, direction) {
    await (direction === 'back' ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId));
    await sleep(500);
    await waitForLoad(tabId);
  },

  async openTab(url) {
    const tab = await chrome.tabs.create({ url, active: true });
    if (tab.id === undefined) throw new Error('Chrome did not open the tab.');
    await sleep(500);
    await waitForLoad(tab.id);
    return tab.id;
  },

  async switchTab(tabId) {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    await waitForLoad(tabId);
  },

  async closeTab(tabId) {
    await chrome.tabs.remove(tabId);
    await sleep(300);
  },

  async download(url) {
    try {
      await chrome.downloads.download({ url, conflictAction: 'uniquify' });
      return true;
    } catch {
      return false;
    }
  },

  async screenshot(tabId) {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active) return null;
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
  },

  async saveRows(rows, source, append) {
    await send({ type: append ? 'APPEND_RESULTS' : 'SET_RESULTS', rows, source });
  },

  async allowSite(host) {
    await send({ type: 'ALLOW_SITE', host });
  },

  async saveRun(saved) {
    if (saved) await chrome.storage.session.set({ [SAVED_RUN]: saved });
    else await chrome.storage.session.remove(SAVED_RUN);
  },

  async status(tabId, text) {
    await send({ type: 'AGENT_STATUS', tabId, text });
  },

  async stopRequested() {
    return Boolean((await send<{ stop?: boolean }>({ type: 'AGENT_STOP_REQUESTED' }))?.stop);
  },

  sleep,
};

/** The one agent for this side panel. It lives outside React so switching screens never loses a run. */
export const agent = new AgentRunner(chromeBrowser, (system, user, maxTokens, schema, temperature) => chatWithTimeout(system, user, maxTokens, schema, temperature), interruptModel);
